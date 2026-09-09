import { layoutItemsToText, type OcrLayout, type OcrLayoutItem, type OcrPoint } from "@/domain/ocrLayout"
import {
  deriveNutritionRegionEvidence,
  updateNutritionRegionMemory,
  type NutritionRegionMemory
} from "./nutritionRegionModel"
import type { LabelReading, LabelWorker } from "./labelCamera"
import { reportOcrStartup } from "./ocrStartup"

type PointLike = { x: number; y: number }
type RectLike = { left?: number; top?: number; right?: number; bottom?: number; width?: number; height?: number; x?: number; y?: number }

export type NativeTextDetection = {
  rawValue: string
  boundingBox: RectLike
  cornerPoints?: PointLike[]
}

type TextDetectorInstance = {
  detect(image: HTMLCanvasElement): Promise<NativeTextDetection[]>
}

type TextDetectorConstructor = {
  new(): TextDetectorInstance
  create?: () => Promise<TextDetectorInstance>
}

type MlKitCornerPoints = {
  topLeft: PointLike
  topRight: PointLike
  bottomRight: PointLike
  bottomLeft: PointLike
}

type MlKitLine = {
  text: string
  boundingBox: { left: number; top: number; right: number; bottom: number }
  cornerPoints: MlKitCornerPoints | null
}

type MlKitResult = {
  text: string
  blocks: Array<{ lines: MlKitLine[] }>
}

function rectPoly(box: RectLike): OcrPoint[] {
  const left = Number(box.left ?? box.x ?? 0)
  const top = Number(box.top ?? box.y ?? 0)
  const right = Number(box.right ?? (left + Number(box.width ?? 0)))
  const bottom = Number(box.bottom ?? (top + Number(box.height ?? 0)))
  return [[left, top], [right, top], [right, bottom], [left, bottom]]
}

function pointsPoly(points?: PointLike[]): OcrPoint[] {
  if (!points || points.length < 4) return []
  return points.slice(0, 4).map((point) => [Number(point.x), Number(point.y)] as OcrPoint)
}

export function layoutFromTextDetections(detections: NativeTextDetection[], width: number, height: number): OcrLayout {
  const items: OcrLayoutItem[] = detections.flatMap((detection) => {
    const text = detection.rawValue?.trim()
    if (!text) return []
    const corners = pointsPoly(detection.cornerPoints)
    return [{ text, score: 0.92, poly: corners.length >= 4 ? corners : rectPoly(detection.boundingBox) }]
  })
  return { width, height, items }
}

function layoutFromMlKit(result: MlKitResult, width: number, height: number): OcrLayout {
  const items: OcrLayoutItem[] = result.blocks.flatMap((block) => block.lines.flatMap((line) => {
    const text = line.text?.trim()
    if (!text) return []
    const corners = line.cornerPoints
      ? [corners.topLeft, corners.topRight, corners.bottomRight, corners.bottomLeft].map((point) => [point.x, point.y] as OcrPoint)
      : rectPoly(line.boundingBox)
    return [{ text, score: 0.92, poly: corners }]
  }))
  return { width, height, items }
}

function readingFromLayout(layout: OcrLayout, engine: string, inferenceMs: number, memory?: NutritionRegionMemory): LabelReading {
  const region = memory?.quad ?? deriveNutritionRegionEvidence(layout).quad
  return {
    text: layoutItemsToText(layout),
    // ML Kit and the Shape Detection TextDetector do not expose a comparable
    // per-line confidence value. Use a stable provider weight instead of
    // inventing field-level certainty; TrackFood's multi-photo consensus,
    // physical constraints and final editable review still decide acceptance.
    confidence: 92,
    layout,
    region,
    engine,
    inferenceMs
  }
}

async function createCapacitorMlKitWorker(): Promise<LabelWorker | undefined> {
  try {
    const { Capacitor } = await import("@capacitor/core")
    if (!Capacitor.isNativePlatform()) return

    reportOcrStartup({
      provider: "Google ML Kit",
      stage: "loading-code",
      percent: 35,
      message: "Starting the phone's native OCR…"
    })

    const { CapacitorPluginMlKitTextRecognition } = await import("@pantrist/capacitor-plugin-ml-kit-text-recognition")
    let memory: NutritionRegionMemory | undefined
    return {
      async recognize(image) {
        const start = performance.now()
        const encoded = image.toDataURL("image/jpeg", 0.95)
        const comma = encoded.indexOf(",")
        const base64Image = comma >= 0 ? encoded.slice(comma + 1) : encoded
        const result = await CapacitorPluginMlKitTextRecognition.detectText({ base64Image, rotation: 0 }) as MlKitResult
        const layout = layoutFromMlKit(result, image.width, image.height)
        memory = updateNutritionRegionMemory(memory, deriveNutritionRegionEvidence(layout))
        return { data: readingFromLayout(layout, "Google ML Kit (native)", performance.now() - start, memory) }
      },
      async terminate() {
        memory = undefined
      }
    }
  } catch (error) {
    console.warn("Native Capacitor ML Kit OCR is not available; trying browser-native OCR.", error)
    return
  }
}

async function createBrowserTextDetectorWorker(): Promise<LabelWorker | undefined> {
  const ctor = (globalThis as typeof globalThis & { TextDetector?: TextDetectorConstructor }).TextDetector
  if (!ctor) return

  try {
    reportOcrStartup({
      provider: "Browser TextDetector",
      stage: "loading-code",
      percent: 30,
      message: "Starting the browser's phone-native text recognizer…"
    })
    const detector = ctor.create ? await ctor.create() : new ctor()
    let memory: NutritionRegionMemory | undefined
    return {
      async recognize(image) {
        const start = performance.now()
        const detections = await detector.detect(image)
        const layout = layoutFromTextDetections(detections, image.width, image.height)
        memory = updateNutritionRegionMemory(memory, deriveNutritionRegionEvidence(layout))
        return { data: readingFromLayout(layout, "Browser native TextDetector", performance.now() - start, memory) }
      },
      async terminate() {
        memory = undefined
      }
    }
  } catch (error) {
    console.warn("Browser TextDetector exists but could not initialize; using the browser OCR fallback.", error)
    return
  }
}

/**
 * Fast provider layer before PP-OCR.
 *
 * 1. A Capacitor build can call Google ML Kit directly on Android/iOS. The
 *    selected plugin accepts a base64 camera canvas and returns line geometry,
 *    so the existing Brazilian label parser can reuse it without changing its
 *    data contract.
 * 2. A normal web/PWA install opportunistically uses the Shape Detection API's
 *    TextDetector when the browser exposes it. The API returns recognized text
 *    plus bounding boxes/corner points backed by platform facilities.
 * 3. If neither exists, callers fall through to PP-OCRv6.
 *
 * References:
 * https://wicg.github.io/shape-detection-api/text.html
 * https://developers.google.com/ml-kit/vision/text-recognition/v2/android
 * https://github.com/Pantrist-dev/capacitor-plugin-ml-kit-text-recognition
 */
export async function tryCreateNativeLabelReader(): Promise<LabelWorker | undefined> {
  reportOcrStartup({
    provider: "Phone OCR",
    stage: "selecting",
    percent: 5,
    message: "Checking whether this phone exposes native OCR…"
  })

  const capacitor = await createCapacitorMlKitWorker()
  if (capacitor) return capacitor
  return createBrowserTextDetectorWorker()
}
