import { describe, expect, it } from "vitest"
import { buildDiarySnapshot, gramsPerUnit, nutritionForPortion } from "./nutrition"
import type { Food } from "./types"

const chocolate: Food = {
  id: "chocolate",
  name: "Chocolate test",
  nutritionBasis: { type: "mass", grams: 100 },
  nutrition: {
    carbsG: 63,
    sugarsG: 47,
    proteinG: 6,
    fatG: 27,
    saturatedFatG: 14,
    transFatG: 0.3
  },
  servingUnits: [
    {
      id: "unidade",
      singular: "unidade",
      plural: "unidades",
      quantity: 4.75,
      grams: 30
    }
  ],
  source: "manual",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
}

describe("flexible serving unit model", () => {
  it("derives grams per human unit from 30 g = 4.75 unidades", () => {
    expect(gramsPerUnit(chocolate.servingUnits[0])).toBeCloseTo(30 / 4.75, 12)
  })

  it("logs one unidade without fake fraction-of-serving arithmetic", () => {
    const portion = nutritionForPortion(chocolate, 1, "unidade")
    const grams = 30 / 4.75
    expect(portion.grams).toBeCloseTo(grams, 12)
    expect(portion.nutrition.carbsG).toBeCloseTo(63 * (grams / 100), 12)
    expect(portion.nutrition.sugarsG).toBeCloseTo(47 * (grams / 100), 12)
    expect(portion.nutrition.proteinG).toBeCloseTo(6 * (grams / 100), 12)
    expect(portion.nutrition.fatG).toBeCloseTo(27 * (grams / 100), 12)
    expect(portion.nutrition.saturatedFatG).toBeCloseTo(14 * (grams / 100), 12)
    expect(portion.nutrition.transFatG).toBeCloseTo(0.3 * (grams / 100), 12)
  })

  it("logs two unidades as 12.631578947... g and scales every nutrient", () => {
    const portion = nutritionForPortion(chocolate, 2, "unidade")
    const grams = 2 * (30 / 4.75)
    expect(portion.grams).toBeCloseTo(12.631578947, 9)
    expect(portion.grams).toBeCloseTo(grams, 12)
    for (const [key, value] of Object.entries(chocolate.nutrition)) {
      expect(portion.nutrition[key as keyof typeof portion.nutrition]).toBeCloseTo(value! * (grams / 100), 12)
    }
  })

  it("snapshots nutrition when a diary entry is created", () => {
    const entry = buildDiarySnapshot({
      id: "entry",
      date: "2026-08-20",
      meal: "Lanches",
      food: chocolate,
      amount: 2,
      unitId: "unidade",
      createdAt: "2026-08-20T12:00:00.000Z"
    })
    chocolate.nutrition.carbsG = 1
    expect(entry.nutritionSnapshot.carbsG).toBeCloseTo(63 * ((2 * 30) / 4.75 / 100), 12)
  })
})
