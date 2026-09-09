import { createBestLabelReader } from "./paddleLabelReader"
import {
  blendQuads,
  captureTrackingFrame,
  detectTextCandidate,
  type NormalizedQuad,
  type TrackingFrame
} from "./labelRegionTracker"
import { mapRegionBetweenQuads } from "./nutritionRegionModel"
import { trackRegionRobust } from "./robustRegionTracker"
import { LABEL_CROP, assessCaptureQuality, captureLabel, type CaptureGuidance, type LabelReading, type LabelWorker, type RegionSource } from "./labelCamera"

export type ManualCameraPipelineState = {
  guidance: CaptureGuidance
  captured: number
  processed: number
  rejected: number
  processing: boolean
  workerReady: boolean
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
  onPipeline?: (state: ManualCameraPipelineState) => void
}

type CameraDependencies = {
  getStream: () => Promise<MediaStream>
  createWorker: () => Promise<LabelWorker>
  capture: (video: HTMLVideoElement, region?: NormalizedQuad) => HTMLCanvasElement | undefined
  assess: (image: HTMLCanvasElement) => CaptureAssessment
  trackFrame?: (video: HTMLVideoElement) => TrackingFrame | undefined
}

export const MANUAL_SCAN_TIMEOUT_MS = 5 * 60_000
export const MANUAL_MAX_FRAMES = 30
export const MANUAL_TRACK_INTERVAL_MS = 120

const defaults: CameraDependencies = {
  getStream: () => {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera requires HTTPS or localhost. You can also upload a photo.")
    return navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } } })
  },
  createWorker: createBestLabelReader,
  // The semantic green polygon is deliberately NOT the OCR crop in manual
  // mode. Every shutter press reads the whole dashed guide. This breaks the
  // dangerous feedback loop where an imperfect ROI could hide the very field
  // (for example Açúcares) that the next photo is supposed to recover.
  capture: (video) => captureLabel(video),
  assess: assessCaptureQuality,
  trackFrame: captureTrackingFrame
}

type CaptureViewport = { x: number; y: number; width: number; height: number }
type LabelCanvas = HTMLCanvasElement & { trackfoodViewport?: CaptureViewport }

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

function cloneQuad(quad?: NormalizedQuad): NormalizedQuad | undefined {
  return quad?.map((point) => ({ ...point })) as NormalizedQuad | undefined
}

function signatureDistance(a: string, b: string): number {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY
  let distance = 0
  for (let i = 0; i < a.length; i++) distance += Number(a[i] !== b[i])
  return distance
}

function rejectionMessage(guidance: CaptureGuidance): string {
  if (guidance === "dark") return "That photo was not added because it is too dark. Add light and tap again."
  if (guidance === "glare") return "That photo was not added because glare hides too much text. Tilt the package and tap again."
  if (guidance === "blurry") return "That photo was not added because it is too blurry. Hold still and tap again."
  if (guidance === "frozen") return "That photo was not added because it is effectively the same frame. Move slightly and tap again."
  return "That photo was not added. Reframe the nutrition label and try again."
}

/**
 * Deliberate shutter-driven camera controller.
 *
 * Unlike the legacy streaming collector, this controller never turns ordinary
 * preview frames into OCR evidence. The camera and lightweight tracker remain
 * live, but an OCR observation only exists after the person taps the viewport.
 * The exact tapped frame then passes the cheap quality gate and near-identical
 * frame guard before PP-OCR is allowed to see it.
 *
 * The ROI shown to the person is feedback, not a gate. Manual captures always
 * read the complete dashed guide. PP-OCR refines the semantic region after each
 * photo, while robust feature tracking follows that region between photos.
 */
export function createManualLabelCamera(video: HTMLVideoElement, callbacks: CameraCallbacks, deps: CameraDependencies = defaults) {
  type Run = {
    stopped: boolean
    stream?: MediaStream
    worker?: LabelWorker
    deadline?: ReturnType<typeof setTimeout>
    trackTimer?: ReturnType<typeof setInterval>
    signatures: string[]
    captured: number
    processed: number
    rejected: number
    processing: boolean
    workerReady: boolean
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

  function snapshotState(run: Run): ManualCameraPipelineState {
    return {
      guidance: run.guidance,
      captured: run.captured,
      processed: run.processed,
      rejected: run.rejected,
      processing: run.processing,
      workerReady: run.workerReady,
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
    clearInterval(run.trackTimer)
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
      // Strong texture features + bidirectional matching + robust affine
      // fitting are materially less drift-prone than the old fixed 3x3 patch
      // grid, especially on labels with blank table cells or repeated rules.
      const tracked = trackRegionRobust(run.trackerFrame, nextFrame, run.region)
      if (tracked) {
        run.region = tracked.quad
        run.trackingConfidence = tracked.confidence
        run.regionSource = run.regionSource === "candidate" ? "candidate" : "flow"
        run.lostTracking = 0
      } else {
        run.lostTracking++
        run.trackingConfidence *= 0.72
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

  async function processCapture(run: Run, image: HTMLCanvasElement, anchorAtCapture?: NormalizedQuad) {
    if (!run.worker || run.stopped) return
    run.processing = true
    run.lastCaptureAccepted = true
    run.captured++
    callbacks.onStatus(`Photo ${run.captured} captured. Reading the full guide locally…`)
    notify(run)

    try {
      const result = await run.worker.recognize(image)
      if (run.stopped) return
      run.processed++

      if (result.data.region) {
        const observedAtCapture = regionFromOcrInput(result.data.region, image)
        // OCR returns several seconds after the shutter press. The package may
        // have moved meanwhile, so never paste the old-photo coordinates onto
        // the current video. If the live tracker stayed locked, transport the
        // refined semantic ROI from the shutter-time pose into the current pose.
        const transported = anchorAtCapture && run.region && run.lostTracking === 0
          ? mapRegionBetweenQuads(anchorAtCapture, run.region, observedAtCapture)
          : undefined
        const observedNow = transported ?? (run.region ? undefined : observedAtCapture)
        if (observedNow) {
          run.region = blendQuads(run.regionSource === "candidate" ? undefined : run.region, observedNow, 0.84)
          run.regionSource = "ocr"
          run.trackingConfidence = Math.max(0.62, Math.min(1, result.data.confidence / 100))
          run.lostTracking = 0
        }
      }

      run.processing = false
      notify(run)

      if (callbacks.onReading(result.data)) {
        callbacks.onStatus("The deliberate photos agree on all required 100 g/100 ml fields. Review the result before saving.")
        release(run)
        return
      }

      callbacks.onStatus(`Photo ${run.processed} added. The green polygon is learned guidance only; the next tap will still read the entire dashed guide.`)
    } catch (error) {
      if (run.stopped) return
      run.processing = false
      notify(run)
      callbacks.onStatus(error instanceof Error ? error.message : "Camera reading failed. Try another photo or pasted text.")
    }
  }

  function capture(): boolean {
    const run = active
    if (!run || run.stopped || !run.stream || !run.workerReady || !run.worker || run.processing || video.paused) return false
    if (run.processed >= MANUAL_MAX_FRAMES) {
      callbacks.onStatus("Photo limit reached. Review the partial reading or finish the remaining fields manually.")
      release(run)
      return false
    }
    if (video.currentTime === run.previousTime) return false
    run.previousTime = video.currentTime

    // Manual OCR always receives the fixed, generous guide. The live semantic
    // ROI is intentionally not passed to captureLabel and therefore cannot
    // make a missing nutrient invisible on the next attempt.
    const image = deps.capture(video)
    if (!image) return false
    const assessment = deps.assess(image)
    run.guidance = assessment.guidance
    run.lastCaptureAccepted = false

    // Manual shutter presses are already intentional independent observations,
    // so only an effectively identical perceptual frame is rejected. This is
    // less aggressive than the streaming collector's near-duplicate filter.
    const duplicate = run.signatures.some((signature) => signatureDistance(signature, assessment.signature) === 0)
    if (duplicate) {
      run.guidance = "frozen"
      run.rejected++
      notify(run)
      callbacks.onStatus(rejectionMessage(run.guidance))
      return false
    }

    if (!assessment.acceptable) {
      run.rejected++
      notify(run)
      callbacks.onStatus(rejectionMessage(run.guidance))
      return false
    }

    run.signatures.push(assessment.signature)
    if (run.signatures.length > 12) run.signatures.shift()
    void processCapture(run, image, cloneQuad(run.region))
    return true
  }

  async function start() {
    stop()
    const run: Run = {
      stopped: false,
      signatures: [],
      captured: 0,
      processed: 0,
      rejected: 0,
      processing: false,
      workerReady: false,
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
      callbacks.onStatus("Camera time limit reached. Review the partial reading or finish the remaining fields manually.")
      release(run)
    }, MANUAL_SCAN_TIMEOUT_MS)

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

      run.guidance = "ready"
      updateTrackedRegion(run)
      if (deps.trackFrame) run.trackTimer = setInterval(() => updateTrackedRegion(run), MANUAL_TRACK_INTERVAL_MS)
      callbacks.onStatus("Camera ready. Loading OCR; no photo is counted until you tap the viewport.")
      notify(run)

      const worker = await deps.createWorker()
      if (run.stopped) {
        await worker.terminate()
        return
      }
      run.worker = worker
      run.workerReady = true
      callbacks.onStatus("Ready. Tap the viewport when the label is clear. Every tap reads the full dashed guide; the green polygon is tracking feedback, not an OCR crop.")
      notify(run)
    } catch (error) {
      if (run.stopped) return
      callbacks.onStatus(error instanceof Error ? error.message : "Camera failed. Try a photo upload or pasted text.")
      release(run)
    }
  }

  return { start, stop, capture }
}
