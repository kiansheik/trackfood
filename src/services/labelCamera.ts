import type { OcrLayout } from "@/domain/ocrLayout"
import { createBestLabelReader } from "./paddleLabelReader"

export type LabelReading = {
  text: string
  confidence: number
  layout?: OcrLayout
  engine?: string
  inferenceMs?: number
}
export type LabelWorker = {
  recognize(image: HTMLCanvasElement): Promise<{ data: LabelReading }>
  terminate(): Promise<unknown>
}

type CameraCallbacks = {
  onReading: (reading: LabelReading) => boolean
  onStatus: (status: string) => void
  onStopped: () => void
}
type CameraDependencies = {
  getStream: () => Promise<MediaStream>
  createWorker: () => Promise<LabelWorker>
  capture: (video: HTMLVideoElement) => HTMLCanvasElement | undefined
}

export const LABEL_CROP = { x: 0.05, y: 0.1, width: 0.9, height: 0.8 }
export const MAX_SCAN_MS = 90_000
export const MAX_SCAN_FRAMES = 30
export const FRAME_SETTLE_MS = 120

export function captureLabel(video: HTMLVideoElement): HTMLCanvasElement | undefined {
  if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return
  const canvas = document.createElement("canvas")
  const width = video.videoWidth * LABEL_CROP.width
  const height = video.videoHeight * LABEL_CROP.height
  const scale = Math.min(2, 1600 / Math.max(width, height))
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)
  const context = canvas.getContext("2d")
  if (!context) throw new Error("Could not capture a camera frame. Try uploading a photo.")
  context.drawImage(video, video.videoWidth * LABEL_CROP.x, video.videoHeight * LABEL_CROP.y, width, height, 0, 0, canvas.width, canvas.height)
  return canvas
}

const defaults: CameraDependencies = {
  getStream: () => {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera requires HTTPS or localhost. You can also upload a photo.")
    return navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } } })
  },
  createWorker: createBestLabelReader,
  capture: captureLabel
}

// Each run owns its resources. Permission/model promises can finish after stop
// or restart; they must then dispose their own resources without touching a new
// run. This is especially important now that PP-OCRv6 initializes an ONNX
// runtime and model worker asynchronously.
export function createLabelCamera(video: HTMLVideoElement, callbacks: CameraCallbacks, deps = defaults) {
  type Run = {
    stopped: boolean
    stream?: MediaStream
    worker?: LabelWorker
    deadline?: ReturnType<typeof setTimeout>
    timer?: ReturnType<typeof setTimeout>
    wake?: () => void
  }
  let active: Run | undefined
  function release(run: Run) {
    run.stopped = true
    clearTimeout(run.deadline)
    clearTimeout(run.timer)
    run.wake?.()
    run.stream?.getTracks().forEach((track) => track.stop())
    if (run.worker) void run.worker.terminate().catch(() => undefined)
    if (active === run) {
      video.srcObject = null
      active = undefined
      callbacks.onStopped()
    }
  }
  function stop() {
    if (active) release(active)
  }
  async function start() {
    stop()
    const run: Run = { stopped: false }
    active = run
    callbacks.onStatus("Requesting camera…")
    run.deadline = setTimeout(() => {
      if (active !== run) return
      callbacks.onStatus("Scan time limit reached. Review the partial reading or start again.")
      release(run)
    }, MAX_SCAN_MS)
    try {
      const stream = await deps.getStream()
      if (run.stopped) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      run.stream = stream
      stream.getVideoTracks().forEach((track) => track.addEventListener("ended", () => {
        if (run.stopped) return
        callbacks.onStatus("Camera disconnected. Review the partial reading or try again.")
        release(run)
      }, { once: true }))
      video.srcObject = stream
      await video.play()
      if (run.stopped) return
      callbacks.onStatus("Preparing PP-OCRv6… first use may download the local OCR model.")
      const worker = await deps.createWorker()
      if (run.stopped) {
        await worker.terminate()
        return
      }
      run.worker = worker
      callbacks.onStatus("Reading… keep the whole nutrition block and its 100 g/100 ml heading inside the frame.")
      let count = 0
      let previousTime = -1
      const signatures = new Set<string>()
      while (!run.stopped && count < MAX_SCAN_FRAMES) {
        // Sample only new video frames. Never queue multiple OCR jobs or count
        // repeated processing of the same pixels as additional evidence.
        if (!video.paused && video.currentTime !== previousTime) {
          previousTime = video.currentTime
          const image = deps.capture(video)
          if (image) {
            const signature = image.toDataURL("image/jpeg", 0.3)
            if (!signatures.has(signature)) {
              signatures.add(signature)
              if (signatures.size > 12) signatures.delete(signatures.values().next().value!)
              const result = await worker.recognize(image)
              if (run.stopped) return
              count++
              if (callbacks.onReading(result.data)) {
                callbacks.onStatus("Repeated 100 g/100 ml readings agree. Review the composite before saving.")
                release(run)
                return
              }
            }
          }
        }
        // PP-OCR runs sequentially. A short settle delay lets the camera advance
        // without adding the old 600 ms latency after every expensive inference.
        await new Promise<void>((resolve) => {
          run.wake = resolve
          run.timer = setTimeout(resolve, FRAME_SETTLE_MS)
        })
      }
      if (!run.stopped) {
        callbacks.onStatus("Frame limit reached. Review the partial reading or start again.")
        release(run)
      }
    } catch (error) {
      if (run.stopped) return
      callbacks.onStatus(error instanceof Error ? error.message : "Camera reading failed. Try a photo or pasted text.")
      release(run)
    }
  }
  return { start, stop }
}
