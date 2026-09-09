import type { OcrLayout } from "@/domain/ocrLayout"
import { createBestLabelReader } from "./paddleLabelReader"
import {
  blendQuads,
  captureTrackingFrame,
  detectTextCandidate,
  quadBounds,
  trackRegion,
  type NormalizedQuad,
  type TrackingFrame
} from "./labelRegionTracker"

export type LabelReading = {
  text: string
  confidence: number
  layout?: OcrLayout
  /** Normalized nutrition-block quad inside this OCR input image. */
  region?: NormalizedQuad
  engine?: string
  inferenceMs?: number
}
export type LabelWorker = {
  recognize(image: HTMLCanvasElement): Promise<{ data: LabelReading }>
  terminate(): Promise<unknown>
}

export type CaptureGuidance = "warming" | "ready" | "dark" | "glare" | "blurry" | "frozen"
export type RegionSource = "searching" | "candidate" | "ocr" | "flow"
export type CameraPipelineState = {
  guidance: CaptureGuidance
  queued: number
  captured: number
  processed: number
  dropped: number
  processing: boolean
  lastCaptureAccepted: boolean
  region?: NormalizedQuad
  regionSource: RegionSource
  trackingConfidence: number
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
  capture: (video: HTMLVideoElement, region?: NormalizedQuad) => HTMLCanvasElement | undefined
  assess: (image: HTMLCanvasElement) => CaptureAssessment
  /** Optional so lifecycle tests can opt out of real canvas/video tracking. */
  trackFrame?: (video: HTMLVideoElement) => TrackingFrame | undefined
}

export const LABEL_CROP = { x: 0.05, y: 0.1, width: 0.9, height: 0.8 }
export const MAX_SCAN_MS = 90_000
export const MAX_SCAN_FRAMES = 30
export const CAPTURE_INTERVAL_MS = 450
export const MAX_CAPTURE_QUEUE = 3
export const TRACK_INTERVAL_MS = 120

type CaptureViewport = { x: number; y: number; width: number; height: number }
type LabelCanvas = HTMLCanvasElement & { trackfoodViewport?: CaptureViewport }

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function viewportForRegion(region?: NormalizedQuad): CaptureViewport {
  if (!region) return { ...LABEL_CROP }
  const bounds = quadBounds(region)
  // The tracked quad is an ROI estimate, not a license to crop tightly. Keep
  // generous context so OCR can rediscover a heading/row that was missed in
  // the previous pass and expand its understanding on the next observation.
  const padX = Math.max(0.035, bounds.width * 0.16)
  const padY = Math.max(0.035, bounds.height * 0.12)
  const left = clamp(bounds.left - padX, 0, 1)
  const right = clamp(bounds.right + padX, 0, 1)
  const top = clamp(bounds.top - padY, 0, 1)
  const bottom = clamp(bounds.bottom + padY, 0, 1)
  if (right - left < 0.12 || bottom - top < 0.1) return { ...LABEL_CROP }
  return { x: left, y: top, width: right - left, height: bottom - top }
}

export function captureLabel(video: HTMLVideoElement, region?: NormalizedQuad): HTMLCanvasElement | undefined {
  if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return
  const viewport = viewportForRegion(region)
  const canvas = document.createElement("canvas") as LabelCanvas
  const width = video.videoWidth * viewport.width
  const height = video.videoHeight * viewport.height
  const scale = Math.min(2, 1600 / Math.max(width, height))
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)
  canvas.trackfoodViewport = viewport
  const context = canvas.getContext("2d")
  if (!context) throw new Error("Could not capture a camera frame. Try uploading a photo.")
  context.drawImage(
    video,
    video.videoWidth * viewport.x,
    video.videoHeight * viewport.y,
    width,
    height,
    0,
    0,
    canvas.width,
    canvas.height
  )
  return canvas
}

const defaults: CameraDependencies = {
  getStream: () => {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera requires HTTPS or localhost. You can also upload a photo.")
    return navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } } })
  },
  createWorker: createBestLabelReader,
  capture: captureLabel,
  assess: assessCaptureQuality,
  trackFrame: captureTrackingFrame
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

function captureViewport(image: HTMLCanvasElement): CaptureViewport {
  return (image as LabelCanvas).trackfoodViewport ?? { ...LABEL_CROP }
}

function regionFromOcrInput(region: NormalizedQuad, image: HTMLCanvasElement): NormalizedQuad {
  const viewport = captureViewport(image)
  return region.map((point) => ({
    x: viewport.x + point.x * viewport.width,
    y: viewport.y + point.y * viewport.height
  })) as NormalizedQuad
}

// Capture and inference are intentionally decoupled. PP-OCR itself remains
// serial (one model worker, one inference at a time), but the camera keeps
// taking a few bounded snapshots while inference is busy. In parallel, a much
// cheaper low-resolution visual tracker follows the last detected nutrition
// quad between OCR results. That tracker changes the HUD and crop only; it does
// not create nutritional evidence or consensus votes.
export function createLabelCamera(video: HTMLVideoElement, callbacks: CameraCallbacks, deps: CameraDependencies = defaults) {
  type QueuedFrame = { image: HTMLCanvasElement; signature: string }
  type Run = {
    stopped: boolean
    stream?: MediaStream
    worker?: LabelWorker
    deadline?: ReturnType<typeof setTimeout>
    captureTimer?: ReturnType<typeof setInterval>
    trackTimer?: ReturnType<typeof setInterval>
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
    region?: NormalizedQuad
    regionSource: RegionSource
    trackingConfidence: number
    trackerFrame?: TrackingFrame
    lostTracking: number
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
      lastCaptureAccepted: run.lastCaptureAccepted,
      region: run.region,
      regionSource: run.regionSource,
      trackingConfidence: run.trackingConfidence
    }
  }
  function notify(run: Run) {
    callbacks.onPipeline?.(snapshotState(run))
  }
  function release(run: Run) {
    run.stopped = true
    clearTimeout(run.deadline)
    clearInterval(run.captureTimer)
    clearInterval(run.trackTimer)
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

  function updateTrackedRegion(run: Run) {
    if (run.stopped || !run.stream || video.paused || !deps.trackFrame) return
    const nextFrame = deps.trackFrame(video)
    if (!nextFrame) return

    if (!run.trackerFrame) {
      run.trackerFrame = nextFrame
      if (!run.region) {
        const candidate = detectTextCandidate(nextFrame)
        if (candidate) {
          run.region = candidate.quad
          run.regionSource = "candidate"
          run.trackingConfidence = candidate.confidence
        }
      }
      notify(run)
      return
    }

    if (run.region) {
      const tracked = trackRegion(run.trackerFrame, nextFrame, run.region)
      if (tracked) {
        run.region = tracked.quad
        run.trackingConfidence = tracked.confidence
        run.regionSource = run.regionSource === "candidate" ? "candidate" : "flow"
        run.lostTracking = 0
      } else {
        run.lostTracking++
        run.trackingConfidence *= 0.72
        // Tentative pre-OCR boxes should disappear quickly when they do not
        // follow the image. A PP-OCR anchored box gets more grace because the
        // next OCR result can re-anchor it after a brief blur/occlusion.
        if ((run.regionSource === "candidate" && run.lostTracking >= 2) || run.lostTracking >= 7) {
          run.region = undefined
          run.regionSource = "searching"
          run.trackingConfidence = 0
        }
      }
    }

    if (!run.region) {
      const candidate = detectTextCandidate(nextFrame)
      if (candidate) {
        run.region = candidate.quad
        run.regionSource = "candidate"
        run.trackingConfidence = candidate.confidence
        run.lostTracking = 0
      }
    }
    run.trackerFrame = nextFrame
    notify(run)
  }

  function captureIntoQueue(run: Run) {
    if (run.stopped || video.paused || !run.stream) return
    if (video.currentTime === run.previousTime) return
    run.previousTime = video.currentTime
    // Only OCR-confirmed/flow-tracked regions change the actual crop. The fast
    // pre-OCR candidate is shown to the user but is too weak to hide parts of a
    // label from the recognizer.
    const cropRegion = run.regionSource === "ocr" || run.regionSource === "flow" ? run.region : undefined
    const image = deps.capture(video, cropRegion)
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
      previousTime: -1,
      regionSource: "searching",
      trackingConfidence: 0,
      lostTracking: 0
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

      // The lightweight tracker begins before PP-OCR is ready. A tentative
      // text-dense box gives immediate, calm feedback; PP-OCR later upgrades it
      // to the nutrition-specific region and dynamic crop.
      run.guidance = "ready"
      updateTrackedRegion(run)
      if (deps.trackFrame) run.trackTimer = setInterval(() => updateTrackedRegion(run), TRACK_INTERVAL_MS)
      captureIntoQueue(run)
      run.captureTimer = setInterval(() => captureIntoQueue(run), CAPTURE_INTERVAL_MS)
      callbacks.onStatus("Camera ready. Center the label; TrackFood will show the area it is following.")
      notify(run)

      const worker = await deps.createWorker()
      if (run.stopped) {
        await worker.terminate()
        return
      }
      run.worker = worker
      callbacks.onStatus("OCR is running. Follow the solid viewfinder cue; confirmed fields can be reviewed at any time.")

      while (!run.stopped && run.processed < MAX_SCAN_FRAMES) {
        if (!run.queue.length) {
          await new Promise<void>((resolve) => { run.wake = resolve })
          run.wake = undefined
          if (run.stopped) return
          continue
        }
        const frame = run.queue.shift()!
        run.processing = true
        notify(run)
        const result = await worker.recognize(frame.image)
        if (run.stopped) return
        run.processing = false
        run.processed++

        if (result.data.region) {
          const observed = regionFromOcrInput(result.data.region, frame.image)
          run.region = blendQuads(run.regionSource === "candidate" ? undefined : run.region, observed)
          run.regionSource = "ocr"
          run.trackingConfidence = Math.max(0.55, Math.min(1, result.data.confidence / 100))
          run.lostTracking = 0
        }
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
