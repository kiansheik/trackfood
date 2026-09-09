import { describe, expect, it } from "vitest"
import type { OcrLayout, OcrLayoutItem } from "@/domain/ocrLayout"
import { quadBounds, type NormalizedQuad } from "./labelRegionTracker"
import {
  deriveNutritionRegionEvidence,
  mapRegionBetweenQuads,
  updateNutritionRegionMemory,
  type NutritionRegionEvidence
} from "./nutritionRegionModel"

function item(text: string, left: number, top: number, right: number, bottom: number): OcrLayoutItem {
  return { text, score: 0.96, poly: [[left, top], [right, top], [right, bottom], [left, bottom]] }
}

function transformPoint(x: number, y: number) {
  return { x: x * 0.94 + y * 0.04 + 0.05, y: x * -0.02 + y * 1.02 + 0.03 }
}

describe("semantic nutrition region model", () => {
  it("envelopes the whole nutrition span even when one nutrient label is missing", () => {
    const layout: OcrLayout = {
      width: 1000,
      height: 800,
      items: [
        item("INFORMAÇÃO NUTRICIONAL", 205, 90, 665, 125),
        item("100 g", 690, 145, 770, 175),
        item("Valor energético", 210, 205, 455, 235),
        item("410 kcal", 705, 202, 790, 235),
        item("Carboidratos", 216, 260, 430, 290),
        item("63 g", 700, 257, 770, 290),
        // Simulate the exact failure the user cares about: OCR sees the value
        // on the Açúcares row but drops the nutrient name itself.
        item("18 g", 702, 312, 770, 345),
        item("Proteínas", 226, 365, 400, 395),
        item("8 g", 690, 362, 750, 395),
        item("Gorduras totais", 230, 420, 470, 450),
        item("11 g", 680, 417, 750, 450),
        item("Sódio", 240, 475, 335, 505),
        item("95 mg", 670, 472, 755, 505),
        item("Ingredientes: farinha, açúcar, cacau e aromatizantes", 90, 650, 900, 690)
      ]
    }

    const evidence = deriveNutritionRegionEvidence(layout)
    expect(evidence.quad).toBeDefined()
    expect(evidence.nutrientKeys).toContain("carbsG")
    expect(evidence.nutrientKeys).toContain("sodiumMg")
    const bounds = quadBounds(evidence.quad!)
    expect(bounds.top).toBeLessThan(0.18)
    expect(bounds.bottom).toBeGreaterThan(0.62)
    expect(bounds.bottom).toBeLessThan(0.75)
    expect(bounds.right).toBeGreaterThan(0.76)
    // The ingredients paragraph must not drag the ROI down to the page bottom.
    expect(bounds.bottom).toBeLessThan(0.8)
  })

  it("uses row geometry to produce a perspective-aware quadrilateral", () => {
    const layout: OcrLayout = {
      width: 1000,
      height: 800,
      items: [
        item("100 g", 700, 120, 775, 150),
        item("Carboidratos", 180, 190, 405, 220),
        item("60 g", 710, 188, 780, 220),
        item("Proteínas", 200, 300, 375, 330),
        item("10 g", 680, 298, 745, 330),
        item("Gorduras totais", 220, 410, 445, 440),
        item("12 g", 650, 408, 715, 440),
        item("Sódio", 240, 520, 335, 550),
        item("100 mg", 620, 518, 710, 550)
      ]
    }

    const quad = deriveNutritionRegionEvidence(layout).quad!
    expect(quad).toBeDefined()
    // Left and right edges should follow the converging table rather than being
    // forced into the old PCA rectangle.
    expect(quad[3].x).toBeGreaterThan(quad[0].x)
    expect(quad[2].x).toBeLessThan(quad[1].x)
  })

  it("registers named nutrient landmarks across photos and carries learned extent forward", () => {
    const first: NutritionRegionEvidence = {
      quad: [
        { x: 0.18, y: 0.18 }, { x: 0.78, y: 0.18 }, { x: 0.75, y: 0.78 }, { x: 0.2, y: 0.78 }
      ],
      features: [
        { id: "nutrient:carbsG", point: { x: 0.3, y: 0.35 }, score: 0.95 },
        { id: "nutrient:proteinG", point: { x: 0.32, y: 0.5 }, score: 0.95 },
        { id: "nutrient:fatG", point: { x: 0.34, y: 0.65 }, score: 0.95 }
      ],
      nutrientKeys: ["carbsG", "proteinG", "fatG"],
      supportRows: 3
    }
    const firstMemory = updateNutritionRegionMemory(undefined, first)!
    const transformedFeatures = first.features.map((feature) => ({ ...feature, point: transformPoint(feature.point.x, feature.point.y) }))
    const second: NutritionRegionEvidence = {
      // Current OCR sees a narrower part of the same label but discovers sugar.
      quad: [
        transformPoint(0.24, 0.22), transformPoint(0.72, 0.22), transformPoint(0.7, 0.72), transformPoint(0.25, 0.72)
      ] as NormalizedQuad,
      features: [
        ...transformedFeatures,
        { id: "nutrient:sugarsG", point: transformPoint(0.31, 0.42), score: 0.93 }
      ],
      nutrientKeys: ["carbsG", "sugarsG", "proteinG", "fatG"],
      supportRows: 4
    }

    const memory = updateNutritionRegionMemory(firstMemory, second)!
    expect(memory.observations).toBe(2)
    expect(memory.nutrientKeys).toContain("sugarsG")
    const narrowBounds = quadBounds(second.quad!)
    const learnedBounds = quadBounds(memory.quad)
    expect(learnedBounds.width).toBeGreaterThan(narrowBounds.width)
    expect(learnedBounds.height).toBeGreaterThan(narrowBounds.height)
  })

  it("transports an OCR refinement from shutter-time pose into the current tracked pose", () => {
    const source: NormalizedQuad = [
      { x: 0.2, y: 0.2 }, { x: 0.7, y: 0.2 }, { x: 0.7, y: 0.7 }, { x: 0.2, y: 0.7 }
    ]
    const destination = source.map((point) => ({ x: point.x + 0.08, y: point.y + 0.04 })) as NormalizedQuad
    const observed: NormalizedQuad = [
      { x: 0.25, y: 0.25 }, { x: 0.66, y: 0.25 }, { x: 0.66, y: 0.66 }, { x: 0.25, y: 0.66 }
    ]
    const moved = mapRegionBetweenQuads(source, destination, observed)!
    expect(moved[0].x).toBeCloseTo(0.33, 4)
    expect(moved[0].y).toBeCloseTo(0.29, 4)
  })
})
