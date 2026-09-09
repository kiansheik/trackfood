import { layoutItemsToText, type OcrLayout, type OcrLayoutItem, type OcrPoint } from "@/domain/ocrLayout"
import type { LabelReading, LabelWorker } from "./labelCamera"

/**
 * TrackFood's primary OCR backend is PP-OCRv6_small through PaddleOCR's
 * official browser SDK.
 *
 * Why this backend:
 * - PaddleOCR's browser SDK runs the full detector + recognizer in-browser and
 *   returns text polygons, which lets us use layout instead of flattening a
 *   nutrition table to one string:
 *   https://www.paddleocr.ai/latest/en/version3.x/inference_deployment/cross_platform/browser.html
 * - `ocrVersion: "PP-OCRv6"` maps to the PP-OCRv6_small pair in that SDK:
 *   https://github.com/PaddlePaddle/PaddleOCR/blob/main/paddleocr-js/packages/core/README.md
 * - PP-OCRv6 supports Portuguese (`pt`) and the small tier is intended for
 *   mobile/desktop deployment. Paddle's published end-to-end benchmark puts
 *   small between tiny and medium on latency while retaining substantially
 *   more recognition capacity than tiny:
 *   https://www.paddleocr.ai/latest/en/version3.x/algorithm/PP-OCRv6/PP-OCRv6.html
 * - We run it in a dedicated worker so model inference does not freeze the
 *   camera/UI. On static hosting without COOP/COEP we intentionally stay on
 *   single-threaded WASM; a future host with cross-origin isolation can allow
 *   the SDK's auto backend to use stronger acceleration.
 *
 * Tesseract remains only a fallback for model/network/runtime failure. We do
 * not mix Paddle and Tesseract readings in one consensus session because the
 * engines have correlated-but-different error patterns and the consensus
 * support count should represent repeated observations from one method.
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
  // GitHub Pages cannot set COOP/COEP response headers. Keep its worker path
  // deterministic and responsive with WASM. If TrackFood moves to a host that
  // can provide cross-origin isolation, `auto` lets PaddleOCR/ORT select the
  // accelerated backend supported by that browser.
  return globalThis.crossOriginIsolated ? "auto" : "wasm"
}

function toReading(result: PaddleResult, fallbackWidth: number, fallbackHeight: number): LabelReading {
  const items: OcrLayoutItem[] = (result.items ?? []).flatMap((item) => {
    const text = item.text?.trim()
    const poly = normalizePoly(item.poly)
    if (!text || poly.length < 4) return []
    return [{ text, score: Number.isFinite(item.score) ? item.score : 0, poly }]
  })
  const layout: OcrLayout = {
    width: Number(result.image?.width) || fallbackWidth,
    height: Number(result.image?.height) || fallbackHeight,
    items
  }
  return {
    text: layoutItemsToText(layout),
    confidence: weightedConfidence(items),
    layout,
    engine: "PP-OCRv6-small",
    inferenceMs: Number.isFinite(result.metrics?.totalMs) ? result.metrics?.totalMs : undefined
  }
}

async function createPaddle(): Promise<PaddleInstance> {
  const { PaddleOCR } = await import("@paddleocr/paddleocr-js")
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
  return instance as unknown as PaddleInstance
}

export async function createPaddleLabelReader(): Promise<LabelWorker> {
  const paddle = await createPaddle()
  return {
    async recognize(image) {
      const [result] = await paddle.predict(image, {
        // Nutrition labels contain small type; retain enough resolution for the
        // detector while capping pathological phone-camera dimensions.
        textDetMaxSideLimit: 2200,
        textDetBoxThresh: 0.45,
        textRecScoreThresh: 0.35
      })
      if (!result) throw new Error("PP-OCRv6 returned no image result.")
      return { data: toReading(result, image.width, image.height) }
    },
    async terminate() {
      await paddle.dispose()
    }
  }
}

async function createTesseractFallback(): Promise<LabelWorker> {
  const { createWorker, PSM } = await import("tesseract.js")
  const worker = await createWorker("por+eng")
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, preserve_interword_spaces: "1" })
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

export async function createBestLabelReader(): Promise<LabelWorker> {
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
  } finally {
    if (paddle) await paddle.dispose()
  }
}
