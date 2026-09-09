import { describe, expect, it } from "vitest"
import type { OcrLayout, OcrLayoutItem } from "@/domain/ocrLayout"
import { deriveNutritionRegion, quadBounds, trackRegion, type NormalizedQuad, type TrackingFrame } from "./labelRegionTracker"

function item(text: string, left: number, top: number, right: number, bottom: number): OcrLayoutItem {
  return { text, score: 0.95, poly: [[left, top], [right, top], [right, bottom], [left, bottom]] }
}

function patternedFrame(width = 96, height = 72): TrackingFrame {
  const gray = new Uint8Array(width * height)
  let seed = 123456789
  for (let i = 0; i < gray.length; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0
    gray[i] = 30 + (seed % 200)
  }
  return { width, height, gray }
}

function translated(frame: TrackingFrame, dx: number, dy: number): TrackingFrame {
  const gray = new Uint8Array(frame.gray.length)
  for (let y = 0; y < frame.height; y++) {
    for (let x = 0; x < frame.width; x++) {
      const nx = x + dx
      const ny = y + dy
      if (nx >= 0 && nx < frame.width && ny >= 0 && ny < frame.height) {
        gray[ny * frame.width + nx] = frame.gray[y * frame.width + x]
      }
    }
  }
  return { width: frame.width, height: frame.height, gray }
}

describe("nutrition label region tracking", () => {
  it("derives the visible nutrition block from OCR polygons instead of assuming the fixed camera guide", () => {
    const layout: OcrLayout = {
      width: 1000,
      height: 800,
      items: [
        item("INFORMAÇÃO NUTRICIONAL", 210, 120, 650, 160),
        item("100 g", 650, 175, 730, 205),
        item("Valor energético", 220, 220, 470, 250),
        item("400", 660, 220, 720, 250),
        item("Carboidratos", 225, 280, 430, 310),
        item("60", 665, 280, 710, 310),
        item("Proteínas", 230, 340, 390, 370),
        item("10", 665, 340, 710, 370),
        item("Ingredientes: farinha, açúcar...", 100, 600, 850, 640)
      ]
    }

    const region = deriveNutritionRegion(layout)
    expect(region).toBeDefined()
    const bounds = quadBounds(region!)
    expect(bounds.left).toBeGreaterThan(0.15)
    expect(bounds.right).toBeLessThan(0.8)
    expect(bounds.top).toBeLessThan(0.2)
    expect(bounds.bottom).toBeLessThan(0.55)
  })

  it("follows the same label through small frame-to-frame motion", () => {
    const previous = patternedFrame()
    const next = translated(previous, 3, 2)
    const quad: NormalizedQuad = [
      { x: 0.25, y: 0.25 },
      { x: 0.7, y: 0.25 },
      { x: 0.7, y: 0.72 },
      { x: 0.25, y: 0.72 }
    ]

    const tracked = trackRegion(previous, next, quad)
    expect(tracked).toBeDefined()
    expect(tracked!.source).toBe("flow")
    expect(tracked!.confidence).toBeGreaterThan(0.2)
    expect(tracked!.quad[0].x - quad[0].x).toBeCloseTo(3 / 95, 2)
    expect(tracked!.quad[0].y - quad[0].y).toBeCloseTo(2 / 71, 2)
  })
})
