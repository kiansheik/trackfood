import { describe, expect, it } from "vitest"
import { shouldClearRefreshCache } from "./appRefresh"

describe("forced PWA refresh cache policy", () => {
  it("removes TrackFood shell/runtime caches but keeps the expensive OCR model cache", () => {
    expect(shouldClearRefreshCache("trackfood-precache-v2-https://example.test/trackfood/")).toBe(true)
    expect(shouldClearRefreshCache("trackfood-runtime-https://example.test/trackfood/")).toBe(true)
    expect(shouldClearRefreshCache("trackfood-ocr-runtime-v1")).toBe(true)
    expect(shouldClearRefreshCache("trackfood-ocr-models-v1")).toBe(false)
    expect(shouldClearRefreshCache("some-other-pwa-precache")).toBe(false)
  })
})
