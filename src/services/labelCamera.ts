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

export type CaptureGuidance = "warming" | "ready" | "dark" | "glare" | "blurry" | "frozen"
export type CameraPipelineState = {
  guidance: CaptureGuidance
  queued: number
  captured: number
  processed: number
  dropped: number
  processing: boolean
  lastCaptureAccepted: boolean
}

type CaptureAssessment = {
  guidance: Exclude<CaptureGuidance, "warming" | "frozen">
  acceptable: boolean
  signature: string
}

type CameraCallbacks = {
  onReading: (reading: LabelReading) => boolean
  onStatus: (status: string) => void
  onStopped: () => void
  onPipeline?: (state: CameraPipelineState) => void
}
type CameraDependencies = {
  getStream: () => Promise<MediaStream>
  createWorker: () => Promise<LabelWorker>
  capture: (video: HTMLVideoElement) => HTMLCanvasElement | undefined
  assess: (image: HTMLCanvasElement) => CaptureAssessment
}

export const LABEL_CROP = { x: 0.05, y: 0.1, width: 0.9, height: 0.8 }
export const MAX_SCAN_MS = 90_000
export const MAX_SCAN_FRAMES = 30
export const CAPTURE_INTERVAL_MS = 450
export const MAX_CAPTURE_QUEUE = 3

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

/**
 * Cheap camera guidance runs on a 64x48 sample before an expensive OCR pass.
 * It is deliberately advisory: borderline frames are still allowed through so
 * a heuristic cannot make an unusual package impossible to scan.
 *
 * The focus signal is a small-image gradient measure in the same family as
 * classic Tenengrad/Laplacian autofocus measures. We use it only to tell the
 * person "hold/focus" versus "try another angle", never as nutrition evidence.
 * Pech-Pacheco et al. (ICPR 2000): https://doi.org/10.1109/ICPR.2000.903548
 *
 * The UX follows document-scanner practice: automatic capture plus immediate
 * viewfinder feedback. Google ML Kit similarly documents automatic capture,
 * edge-aware viewfinders, and the importance of focus/text pixel size for OCR:
 * https://developers.google.com/ml-kit/vision/doc-scanner
 * https://developers.google.com/ml-kit/vision/text-recognition/v2/android
 */
export function assessCaptureQuality(image: HTMLCanvasElement): CaptureAssessment {
  const sample = document.createElement("canvas")
  sample.width = 64
  sample.height = 48
  const context = sample.getContext("2d", { willReadFrequently: true })
  if (!context) return { guidance: "ready", acceptable: true, signature: image.toDataURL("image/jpeg", 0.05) }
  context.drawImage(image, 0, 0, sample.width, sample.height)
  const pixels = context.getImageData(0, 0, sample.width, sample.height).data
  const gray = new Float32Array(sample.width * sample.height)
  let sum = 0
  let veryBright = 0
  for (let i = 0; i < gray.length; i++) {
    const offset = i * 4
    const value = pixels[offset] * 0.299 + pixels[offset + 1] * 0.587 + pixels[offset + 2] * 0.114
    gray[i] = value
    sum += value
    if (value > 248) veryBright++
  }
  const mean = sum / gray.length
  let gradient = 0
  let gradientCount = 0
  for (let y = 1; y < sample.height; y++) {
    for (let x = 1; x < sample.width; x++) {
      const index = y * sample.width + x
      gradient += Math.abs(gray[index] - gray[index - 1]) + Math.abs(gray[index] - gray[index - sample.width])
      gradientCount += 2
    }
  }
  const edge = gradientCount ? gradient / gradientCount : 0
  const brightRatio = veryBright / gray.length

  let guidance: CaptureAssessment["guidance"] = "ready"
  if (mean < 60) guidance = "dark"
  else if (mean > 215 && brightRatio > 0.55 && edge < 12) guidance = "glare"
  else if (edge < 6) guidance = "blurry"

  // Only reject extreme cases. Real nutrition labels can be low-contrast or
  // mostly white, and OCR itself is the stronger judge once inference runs.
  const acceptable = mean >= 25 && mean <= 248 && edge >= 2

  // A compact perceptual signature prevents a stationary camera frame from
  // being counted repeatedly as independent consensus evidence.
  const blockWidth = 8
  const blockHeight = 6
  let signature = ""
  for (let by = 0; by < 8; by++) {
    for (let bx = 0; bx < 8; bx++) {
      let block = 0
      for (let y = 0; y < blockHeight; y++) {
        for (let x = 0; x < blockWidth; x++) {
          block += gray[(by * blockHeight + y) * sample.width + bx * blockWidth + x]
        }
      }
      signature += block / (blockWidth * blockHeight) >= mean ? "1" : "0"
    }
  }
  return { guidance, acceptable, signature }
}

function signatureDistance(a: string, b: string): number {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY
  let distance = 0
  for (let i = 0; i < a.length; i++) distance += Number(a[i] !== b[i])
  return distance
}

const defaults: CameraDependencies = {
  getStream: () => {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera requires HTTPS or localhost. You can also upload a photo.")
    return navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } } })
  },
  createWorker: createBestLabelReader,
  capture: captureLabel,
  assess: assessCaptureQuality
}

// Capture and inference are intentionally decoupled. PP-OCR itself remains
// serial (one model worker, one inference at a time), but the camera keeps
// taking a few bounded snapshots while inference is busy. This makes a slow
// model feel responsive and lets the user supply slightly different angles
// without waiting for each OCR result before the next capture.
export function createLabelCamera(video: HTMLVideoElement, callbacks: CameraCallbacks, deps = defaults) {
  type QueuedFrame = { image: HTMLCanvasElement; signature: string }
  type Run = {
    stopped: boolean
    stream?: MediaStream
    worker?: LabelWorker
    deadline?: ReturnType<typeof setTimeout>
    captureTimer?: ReturnType<typeof setInterval>
    wake?: () => void
    queue: QueuedFrame[]
    signatures: string[]
    captured: number
    processed: number
    dropped: number
    processing: boolean
    guidance: CaptureGuidance
    lastCaptureAccepted: boolean
    previousTime: number
  }
  let active: Run | undefined

  function snapshotState(run: Run): CameraPipelineState {
    return {
      guidance: run.guidance,
      queued: run.queue.length,
      captured: run.captured,
      processed: run.processed,
      dropped: run.dropped,
      processing: run.processing,
      lastCaptureAccepted: run.lastCaptureAccepted
    }
  }
  function notify(run: Run) {
    callbacks.onPipeline?.(snapshotState(run))
  }
  function release(run: Run) {
    run.stopped = true
    clearTimeout(run.deadline)
    clearInterval(run.captureTimer)
    run.wake?.()
    run.queue.length = 0
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

  function captureIntoQueue(run: Run) {
    if (run.stopped || video.paused || !run.stream) return
    if (video.currentTime === run.previousTime) return
    run.previousTime = video.currentTime
    const image = deps.capture(video)
    if (!image) return
    const assessment = deps.assess(image)
    run.guidance = assessment.guidance
    run.lastCaptureAccepted = false

    const duplicate = run.signatures.some((signature) => signatureDistance(signature, assessment.signature) <= 2)
    if (duplicate) {
      run.guidance = "frozen"
      run.dropped++
      notify(run)
      return
    }
    run.signatures.push(assessment.signature)
    if (run.signatures.length > 12) run.signatures.shift()
    if (!assessment.acceptable) {
      run.dropped++
      notify(run)
      return
    }

    // Latest-biased bounded queue. If OCR takes several seconds, stale camera
    // shots should not delay a newer angle the user has deliberately supplied.
    if (run.queue.length >= MAX_CAPTURE_QUEUE) {
      run.queue.shift()
      run.dropped++
    }
    run.queue.push({ image, signature: assessment.signature })
    run.captured++
    run.lastCaptureAccepted = true
    notify(run)
    run.wake?.()
    run.wake = undefined
  }

  async function start() {
    stop()
    const run: Run = {
      stopped: false,
      queue: [],
      signatures: [],
      captured: 0,
      processed: 0,
      dropped: 0,
      processing: false,
      guidance: "warming",
      lastCaptureAccepted: false,
      previousTime: -1
    }
    active = run
    notify(run)
    callbacks.onStatus("Requesting camera…")
    run.deadline = setTimeout(() => {
      if (active !== run) return
      callbacks.onStatus("Scan time limit reached. Review the partial reading or continue scanning.")
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

      // Start collecting a small queue immediately, even while the large OCR
      // model is still initializing/downloading. The person gets instant camera
      // feedback instead of staring at a live viewfinder that is doing nothing.
      run.guidance = "ready"
      captureIntoQueue(run)
      run.captureTimer = setInterval(() => captureIntoQueue(run), CAPTURE_INTERVAL_MS)
      callbacks.onStatus("Camera ready. Hold the label inside the guide; snapshots will queue while OCR works.")
      notify(run)

      const worker = await deps.createWorker()
      if (run.stopped) {
        await worker.terminate()
        return
      }
      run.worker = worker
      callbacks.onStatus("OCR is running. Keep supplying slightly different clear angles until the missing fields turn green.")

      while (!run.stopped && run.processed < MAX_SCAN_FRAMES) {
        if (!run.queue.length) {
          await new Promise<void>((resolve) => { run.wake = resolve })
          run.wake = undefined
          if (run.stopped) return
          continue
        }
        const frame = run.queue.shift()!
        run.processing = true
        run.lastCaptureAccepted = false
        notify(run)
        const result = await worker.recognize(frame.image)
        if (run.stopped) return
        run.processing = false
        run.processed++
        notify(run)
        if (callbacks.onReading(result.data)) {
          callbacks.onStatus("Repeated 100 g/100 ml readings agree. Review the composite before saving.")
          release(run)
          return
        }
      }
      if (!run.stopped) {
        callbacks.onStatus("Frame limit reached. Review the partial reading or continue scanning.")
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
