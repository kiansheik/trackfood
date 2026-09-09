export type OcrStartupStage = "selecting" | "loading-code" | "loading-model" | "fallback" | "ready" | "failed"

export type OcrStartupProgress = {
  provider: string
  stage: OcrStartupStage
  percent: number
  message: string
  etaMs?: number
  elapsedMs?: number
}

export const OCR_STARTUP_EVENT = "trackfood:ocr-startup"

/**
 * OCR initialization is intentionally observable at the app-shell level.
 *
 * The browser PP-OCR fallback may need to download and initialize tens of MB
 * on first use, while phone-native OCR can be effectively immediate. Emitting
 * one provider-neutral event lets the camera stay simple and lets the app show
 * an honest progress/ETA banner even before an OCR worker exists.
 */
export function reportOcrStartup(progress: OcrStartupProgress): void {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent<OcrStartupProgress>(OCR_STARTUP_EVENT, { detail: progress }))
}
