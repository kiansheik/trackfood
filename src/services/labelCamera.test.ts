import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { captureLabel, createLabelCamera, MAX_SCAN_MS } from "./labelCamera"

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
  const worker = { recognize: vi.fn().mockResolvedValue({ data: { text: "100 g", confidence: 90 } }), terminate: vi.fn().mockResolvedValue(undefined) }
  let serial = 0
  const capture = vi.fn(() => ({ toDataURL: () => `frame-${serial++}` }) as HTMLCanvasElement)
  const callbacks = { onReading: vi.fn(() => false), onStatus: vi.fn(), onStopped: vi.fn() }
  const deps = { getStream: vi.fn().mockResolvedValue(stream), createWorker: vi.fn().mockResolvedValue(worker), capture }
  const camera = createLabelCamera(video, callbacks, deps)
  return { track, stream, video, worker, callbacks, deps, camera }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe("live label camera lifecycle", () => {
  it("reuses one worker, runs OCR sequentially, and releases resources at consensus", async () => {
    const { camera, callbacks, worker, track, deps, video } = setup()
    callbacks.onReading.mockReturnValueOnce(false).mockReturnValueOnce(true)
    const scan = camera.start()
    await vi.advanceTimersByTimeAsync(601)
    await scan
    expect(worker.recognize).toHaveBeenCalledTimes(2)
    expect(deps.createWorker).toHaveBeenCalledTimes(1)
    expect(worker.terminate).toHaveBeenCalledTimes(1)
    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(video.srcObject).toBeNull()
    expect(callbacks.onStopped).toHaveBeenCalledTimes(1)
  })

  it("ignores in-flight OCR after stop and never queues a second job", async () => {
    const { camera, callbacks, worker } = setup()
    const pending = deferred<{ data: { text: string; confidence: number } }>()
    worker.recognize.mockReturnValue(pending.promise)
    const scan = camera.start()
    await vi.advanceTimersByTimeAsync(5000)
    expect(worker.recognize).toHaveBeenCalledTimes(1)
    camera.stop()
    pending.resolve({ data: { text: "late result", confidence: 99 } })
    await scan
    expect(callbacks.onReading).not.toHaveBeenCalled()
    expect(worker.terminate).toHaveBeenCalledTimes(1)
  })

  it("stops a camera whose permission was granted after cancellation", async () => {
    const { camera, callbacks, deps, stream, track } = setup()
    const pending = deferred<MediaStream>()
    deps.getStream.mockReturnValue(pending.promise)
    const scan = camera.start()
    camera.stop()
    pending.resolve(stream)
    await scan
    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(deps.createWorker).not.toHaveBeenCalled()
    expect(callbacks.onReading).not.toHaveBeenCalled()
  })

  it("terminates a worker that finishes initializing after cancellation", async () => {
    const { camera, deps, worker, track } = setup()
    const pending = deferred<typeof worker>()
    deps.createWorker.mockReturnValue(pending.promise)
    const scan = camera.start()
    await vi.advanceTimersByTimeAsync(1)
    camera.stop()
    pending.resolve(worker)
    await scan
    expect(worker.terminate).toHaveBeenCalledTimes(1)
    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(worker.recognize).not.toHaveBeenCalled()
  })

  it("releases camera resources after OCR failure", async () => {
    const { camera, worker, callbacks, track } = setup()
    worker.recognize.mockRejectedValue(new Error("OCR unavailable"))
    await camera.start()
    expect(callbacks.onStatus).toHaveBeenLastCalledWith("OCR unavailable")
    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(worker.terminate).toHaveBeenCalledTimes(1)
  })

  it("does not repeatedly vote for frozen pixels, and times out with a partial result", async () => {
    const { camera, deps, worker, callbacks } = setup()
    deps.capture.mockReturnValue({ toDataURL: () => "frozen" } as HTMLCanvasElement)
    const scan = camera.start()
    await vi.advanceTimersByTimeAsync(MAX_SCAN_MS)
    await scan
    expect(worker.recognize).toHaveBeenCalledTimes(1)
    expect(callbacks.onStatus).toHaveBeenLastCalledWith(expect.stringContaining("time limit"))
    expect(worker.terminate).toHaveBeenCalledTimes(1)
  })

  it("bounds a session at 30 readings when no agreement is reached", async () => {
    const { camera, callbacks, worker } = setup()
    const scan = camera.start()
    await vi.advanceTimersByTimeAsync(18_001)
    await scan
    expect(worker.recognize).toHaveBeenCalledTimes(30)
    expect(callbacks.onStatus).toHaveBeenLastCalledWith(expect.stringContaining("Frame limit"))
  })

  it("handles camera denial without loading an OCR worker", async () => {
    const { camera, callbacks, deps } = setup()
    deps.getStream.mockRejectedValue(new Error("Permission denied"))
    await camera.start()
    expect(deps.createWorker).not.toHaveBeenCalled()
    expect(callbacks.onStatus).toHaveBeenLastCalledWith("Permission denied")
    expect(callbacks.onStopped).toHaveBeenCalledTimes(1)
  })

  it("captures exactly the visible guide, preserving aspect ratio with bounded upscaling", () => {
    const video = document.createElement("video")
    Object.defineProperties(video, { readyState: { value: 2 }, videoWidth: { value: 1000 }, videoHeight: { value: 500 } })
    const drawImage = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D)
    const canvas = captureLabel(video)!
    expect(canvas.width).toBe(1600)
    expect(canvas.height).toBe(711)
    expect(drawImage).toHaveBeenCalledWith(video, 50, 50, 900, 400, 0, 0, 1600, 711)
  })
})
