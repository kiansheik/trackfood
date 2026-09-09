import { layoutItemsToText, type OcrLayout, type OcrLayoutItem, type OcrPoint } from "@/domain/ocrLayout"
import {
  deriveNutritionRegionEvidence,
  updateNutritionRegionMemory,
  type NutritionRegionMemory
} from "./nutritionRegionModel"
import type { LabelReading, LabelWorker } from "./labelCamera"
import { reportOcrStartup } from "./ocrStartup"

/**
 * TrackFood's browser OCR fallback is PP-OCRv6_small through PaddleOCR's
 * official browser SDK. Phone-native providers are tried first by
 * `createBestLabelReader()` because they can avoid the large first-use WASM /
 * model startup entirely.
 *
 * Why this fallback:
 * - PaddleOCR's browser SDK runs the full detector + recognizer in-browser and
 *   returns text polygons, which lets us use layout instead of flattening a
 *   nutrition table to one string:
 *   https://www.paddleocr.ai/latest/en/version3.x/inference_deployment/cross_platform/browser.html
 * - `ocrVersion: "PP-OCRv6"` maps to the PP-OCRv6_small pair in that SDK:
 *   https://github.com/PaddlePaddle/PaddleOCR/blob/main/paddleocr-js/packages/core/README.md
 * - PP-OCRv6 supports Portuguese (`pt`) and the small tier is intended for
 *   mobile/desktop deployment.
 * - We run it in a dedicated worker so model inference does not freeze the
 *   camera/UI. On static hosting without COOP/COEP we intentionally stay on
 *   single-threaded WASM.
 *
 * PaddleOCR.js currently does not expose byte-level progress from worker-mode
 * model loading: custom `fetch` is explicitly unsupported in worker mode. The
 * startup progress below is therefore labeled as an ETA, not fake download
 * bytes. It learns from successful startup time on this device and uses the
 * Network Information API only as a first-run estimate when available.
 *
 * SDK implementation reference:
 * https://github.com/PaddlePaddle/PaddleOCR/blob/main/paddleocr-js/packages/core/src/pipelines/ocr/index.ts
 *
 * Region methodology:
 * Each pass produces a semantic nutrition-region observation from OCR polygons.
 * The reused worker keeps region memory across deliberate photos. This region
 * is HUD feedback only; manual capture still reads the whole dashed guide.
 */

type PaddleItem = { text: string; score: number; poly: unknown }
type PaddleResult = {
  image?: { width?: number; height?: number }
  items?: PaddleItem[]
  metrics?: { totalMs?: number; detMs?: number; recMs?: number }
  runtime?: unknown
}
type PaddleInstance = {
  predict(input: Blob | HTMLCanvasElement, options?: Record<string, unknown>): Promise<PaddleResult[]>
  dispose(): void | Promise<void>
}

type NavigatorWithConnection = Navigator & { connection?: { downlink?: number } }

const STARTUP_KEY = "trackfood:ppocr-startup-ms"
const FALLBACK_STARTUP_MS = 45_000

function asPoint(value: unknown): OcrPoint | undefined {
  if (!Array.isArray(value) || value.length < 2) return
  const x = Number(value[0])
  const y = Number(value[1])
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : undefined
}

function normalizePoly(value: unknown): OcrPoint[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((point) => {
    const normalized = asPoint(point)
    return normalized ? [normalized] : []
  })
}

function weightedConfidence(items: OcrLayoutItem[]): number {
  let weight = 0
  let score = 0
  for (const item of items) {
    const itemWeight = Math.max(1, item.text.trim().length)
    weight += itemWeight
    score += Math.max(0, Math.min(1, item.score)) * itemWeight
  }
  return weight ? Math.round(score / weight * 100) : 0
}

function chooseBackend(): "auto" | "wasm" {
  return globalThis.crossOriginIsolated ? "auto" : "wasm"
}

function storedStartupEstimate(): number | undefined {
  try {
    const value = Number(localStorage.getItem(STARTUP_KEY))
    return Number.isFinite(value) && value >= 2_000 && value <= 180_000 ? value : undefined
  } catch {
    return
  }
}

function firstRunEstimate(): number {
  const downlink = Number((navigator as NavigatorWithConnection).connection?.downlink)
  if (!Number.isFinite(downlink) || downlink <= 0) return FALLBACK_STARTUP_MS
  // Detection + recognition models are roughly 30 MB together; runtime/session
  // setup adds a fixed allowance. Clamp because browser-reported downlink is a
  // coarse hint, not a promise about the Paddle model host.
  const transferMs = 30 * 8 / downlink * 1_000
  return Math.max(18_000, Math.min(90_000, transferMs + 12_000))
}

function rememberStartup(durationMs: number): void {
  try {
    const previous = storedStartupEstimate()
    const next = previous ? previous * 0.65 + durationMs * 0.35 : durationMs
    localStorage.setItem(STARTUP_KEY, String(Math.round(next)))
  } catch {
    // Private browsing and hardened storage modes may reject localStorage.
  }
}

function layoutFromResult(result: PaddleResult, fallbackWidth: number, fallbackHeight: number): OcrLayout {
  const items: OcrLayoutItem[] = (result.items ?? []).flatMap((item) => {
    const text = item.text?.trim()
    const poly = normalizePoly(item.poly)
    if (!text || poly.length < 4) return []
    return [{ text, score: Number.isFinite(item.score) ? item.score : 0, poly }]
  })
  return {
    width: Number(result.image?.width) || fallbackWidth,
    height: Number(result.image?.height) || fallbackHeight,
    items
  }
}

function toReading(result: PaddleResult, fallbackWidth: number, fallbackHeight: number, regionMemory?: NutritionRegionMemory): LabelReading {
  const layout = layoutFromResult(result, fallbackWidth, fallbackHeight)
  return {
    text: layoutItemsToText(layout),
    confidence: weightedConfidence(layout.items),
    layout,
    region: regionMemory?.quad ?? deriveNutritionRegionEvidence(layout).quad,
    engine: "PP-OCRv6-small",
    inferenceMs: Number.isFinite(result.metrics?.totalMs) ? result.metrics?.totalMs : undefined
  }
}

async function createPaddle(): Promise<PaddleInstance> {
  const started = performance.now()
  const estimate = storedStartupEstimate() ?? firstRunEstimate()
  reportOcrStartup({
    provider: "PP-OCRv6-small",
    stage: "loading-code",
    percent: 8,
    message: "Loading the browser OCR runtime…",
    etaMs: estimate
  })

  const { PaddleOCR } = await import("@paddleocr/paddleocr-js")
  let lastPercent = 12
  const timer = setInterval(() => {
    const elapsedMs = performance.now() - started
    const expectedMs = Math.max(estimate, elapsedMs + 5_000)
    const target = 12 + 82 * Math.min(1, elapsedMs / expectedMs)
    lastPercent = Math.max(lastPercent, Math.min(94, target))
    reportOcrStartup({
      provider: "PP-OCRv6-small",
      stage: "loading-model",
      percent: Math.round(lastPercent),
      message: "Preparing the ~30 MB browser OCR model and local runtime…",
      etaMs: Math.max(1_000, expectedMs - elapsedMs),
      elapsedMs
    })
  }, 350)

  try {
    const instance = await PaddleOCR.create({
      lang: "pt",
      ocrVersion: "PP-OCRv6",
      worker: true,
      textRecognitionBatchSize: 8,
      ortOptions: {
        backend: chooseBackend(),
        numThreads: globalThis.crossOriginIsolated ? Math.min(2, navigator.hardwareConcurrency || 2) : 1,
        simd: true
      }
    })
    const elapsedMs = performance.now() - started
    rememberStartup(elapsedMs)
    reportOcrStartup({
      provider: "PP-OCRv6-small",
      stage: "ready",
      percent: 100,
      message: "Browser OCR ready.",
      etaMs: 0,
      elapsedMs
    })
    return instance as unknown as PaddleInstance
  } finally {
    clearInterval(timer)
  }
}

export async function createPaddleLabelReader(): Promise<LabelWorker> {
  const paddle = await createPaddle()
  let regionMemory: NutritionRegionMemory | undefined
  return {
    async recognize(image) {
      const [result] = await paddle.predict(image, {
        textDetMaxSideLimit: 2200,
        textDetBoxThresh: 0.45,
        textRecScoreThresh: 0.35
      })
      if (!result) throw new Error("PP-OCRv6 returned no image result.")
      const layout = layoutFromResult(result, image.width, image.height)
      regionMemory = updateNutritionRegionMemory(regionMemory, deriveNutritionRegionEvidence(layout))
      const reading = toReading(result, image.width, image.height, regionMemory)
      reading.layout = layout
      reading.text = layoutItemsToText(layout)
      reading.confidence = weightedConfidence(layout.items)
      return { data: reading }
    },
    async terminate() {
      regionMemory = undefined
      await paddle.dispose()
    }
  }
}

async function createTesseractFallback(): Promise<LabelWorker> {
  reportOcrStartup({
    provider: "Tesseract",
    stage: "fallback",
    percent: 15,
    message: "Primary OCR could not start. Loading the smaller compatibility OCR…"
  })
  const { createWorker, PSM } = await import("tesseract.js")
  const worker = await createWorker("por+eng")
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, preserve_interword_spaces: "1" })
  reportOcrStartup({ provider: "Tesseract", stage: "ready", percent: 100, message: "Compatibility OCR ready.", etaMs: 0 })
  return {
    async recognize(image) {
      const result = await worker.recognize(image)
      return {
        data: {
          text: result.data.text,
          confidence: result.data.confidence,
          engine: "Tesseract-fallback"
        }
      }
    },
    terminate: () => worker.terminate()
  }
}

async function recognizeBlobWithTesseract(blob: Blob): Promise<LabelReading> {
  const { createWorker, PSM } = await import("tesseract.js")
  const worker = await createWorker("por+eng")
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, preserve_interword_spaces: "1" })
    const result = await worker.recognize(blob)
    return {
      text: result.data.text,
      confidence: result.data.confidence,
      engine: "Tesseract-fallback"
    }
  } finally {
    await worker.terminate()
  }
}

export async function createBestLabelReader(): Promise<LabelWorker> {
  try {
    const { tryCreateNativeLabelReader } = await import("./nativeLabelReader")
    const native = await tryCreateNativeLabelReader()
    if (native) {
      reportOcrStartup({
        provider: "Phone OCR",
        stage: "ready",
        percent: 100,
        message: "Phone-native OCR ready. No large browser model download needed.",
        etaMs: 0
      })
      return native
    }
  } catch (error) {
    console.warn("Phone-native OCR selection failed; trying PP-OCRv6.", error)
  }

  try {
    return await createPaddleLabelReader()
  } catch (error) {
    console.warn("PP-OCRv6 initialization failed; falling back to Tesseract for this scan.", error)
    return createTesseractFallback()
  }
}

export async function recognizeLabelBlob(blob: Blob): Promise<LabelReading> {
  let paddle: PaddleInstance | undefined
  try {
    paddle = await createPaddle()
    const [result] = await paddle.predict(blob, {
      textDetMaxSideLimit: 2600,
      textDetBoxThresh: 0.45,
      textRecScoreThresh: 0.35
    })
    if (!result) throw new Error("PP-OCRv6 returned no image result.")
    return toReading(result, Number(result.image?.width) || 1, Number(result.image?.height) || 1)
  } catch (error) {
    console.warn("PP-OCRv6 photo recognition failed; falling back to Tesseract.", error)
    return recognizeBlobWithTesseract(blob)
  } finally {
    if (paddle) await paddle.dispose()
  }
}
