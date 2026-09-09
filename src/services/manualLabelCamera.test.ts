import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createManualLabelCamera } from "./manualLabelCamera"

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function setup() {
  const track = { stop: vi.fn(), addEventListener: vi.fn() }
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream
  const video = document.createElement("video")
  Object.defineProperty(video, "paused", { value: false })
  video.play = vi.fn().mockResolvedValue(undefined)
  let timestamp = 0
  Object.defineProperty(video, "currentTime", { get: () => timestamp++ })
  const worker = {
    recognize: vi.fn().mockResolvedValue({ data: { text: "100 g", confidence: 90 } }),
    terminate: vi.fn().mockResolvedValue(undefined)
  }
  let serial = 0
  const capture = vi.fn(() => ({ toDataURL: () => `manual-${serial}` }) as HTMLCanvasElement)
  const assess = vi.fn((): { guidance: "ready" | "dark" | "glare" | "blurry"; acceptable: boolean; signature: string } => ({ guidance: "ready", acceptable: true, signature: `sig-${serial++}` }))
  const callbacks = { onReading: vi.fn(() => false), onStatus: vi.fn(), onStopped: vi.fn(), onPipeline: vi.fn() }
  const deps = { getStream: vi.fn().mockResolvedValue(stream), createWorker: vi.fn().mockResolvedValue(worker), capture, assess }
  const camera = createManualLabelCamera(video, callbacks, deps)
  return { track, stream, video, worker, callbacks, deps, camera, capture }
}

function lastPipeline(callbacks: { onPipeline: ReturnType<typeof vi.fn> }) {
  const calls = callbacks.onPipeline.mock.calls
  return calls[calls.length - 1]?.[0]
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe("manual label camera", () => {
  it("never creates OCR evidence until the viewport shutter is deliberately pressed", async () => {
    const { camera, worker, callbacks, track } = setup()
    await camera.start()

    expect(worker.recognize).not.toHaveBeenCalled()
    expect(lastPipeline(callbacks).workerReady).toBe(true)

    expect(camera.capture()).toBe(true)
    await vi.advanceTimersByTimeAsync(0)

    expect(worker.recognize).toHaveBeenCalledTimes(1)
    expect(callbacks.onReading).toHaveBeenCalledTimes(1)
    expect(callbacks.onPipeline.mock.calls.some(([state]) => state.processing === true)).toBe(true)
    expect(lastPipeline(callbacks).processing).toBe(false)

    camera.stop()
    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(worker.terminate).toHaveBeenCalledTimes(1)
  })

  it("disables additional shutter presses while one deliberate photo is being processed", async () => {
    const { camera, worker, callbacks } = setup()
    const pending = deferred<{ data: { text: string; confidence: number } }>()
    worker.recognize.mockReturnValue(pending.promise)
    await camera.start()

    expect(camera.capture()).toBe(true)
    expect(camera.capture()).toBe(false)
    expect(worker.recognize).toHaveBeenCalledTimes(1)
    expect(lastPipeline(callbacks).processing).toBe(true)

    pending.resolve({ data: { text: "100 g", confidence: 92 } })
    await vi.advanceTimersByTimeAsync(0)
    expect(callbacks.onReading).toHaveBeenCalledTimes(1)
    expect(camera.capture()).toBe(true)

    camera.stop()
  })

  it("keeps the learned ROI out of the next OCR crop", async () => {
    const { camera, worker, capture } = setup()
    worker.recognize.mockResolvedValue({
      data: {
        text: "100 g Carboidratos 60 g",
        confidence: 95,
        region: [
          { x: 0.2, y: 0.2 },
          { x: 0.8, y: 0.2 },
          { x: 0.8, y: 0.8 },
          { x: 0.2, y: 0.8 }
        ]
      }
    })
    await camera.start()

    expect(camera.capture()).toBe(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(camera.capture()).toBe(true)
    await vi.advanceTimersByTimeAsync(0)

    expect(capture).toHaveBeenCalledTimes(2)
    // The dependency is invoked with only the video element. An ROI argument
    // here would mean the green HUD polygon can still blind the next OCR pass.
    expect(capture.mock.calls[0]).toHaveLength(1)
    expect(capture.mock.calls[1]).toHaveLength(1)
    camera.stop()
  })

  it("rejects a bad deliberate photo before OCR so it never enters consensus", async () => {
    const { camera, worker, callbacks, deps } = setup()
    deps.assess.mockReturnValue({ guidance: "blurry", acceptable: false, signature: "bad" })
    await camera.start()

    expect(camera.capture()).toBe(false)
    expect(worker.recognize).not.toHaveBeenCalled()
    expect(callbacks.onReading).not.toHaveBeenCalled()
    expect(lastPipeline(callbacks).rejected).toBe(1)
    expect(callbacks.onStatus).toHaveBeenLastCalledWith(expect.stringContaining("not added"))

    camera.stop()
  })

  it("rejects an effectively identical second manual frame instead of counting it twice", async () => {
    const { camera, worker, callbacks, deps } = setup()
    deps.assess.mockReturnValue({ guidance: "ready", acceptable: true, signature: "same" })
    await camera.start()

    expect(camera.capture()).toBe(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(worker.recognize).toHaveBeenCalledTimes(1)

    expect(camera.capture()).toBe(false)
    expect(worker.recognize).toHaveBeenCalledTimes(1)
    expect(lastPipeline(callbacks).guidance).toBe("frozen")
    expect(lastPipeline(callbacks).rejected).toBe(1)

    camera.stop()
  })
})