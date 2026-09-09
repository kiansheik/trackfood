import { describe, expect, it } from "vitest"
import { assessNutrientCandidate, plausibleRangeForNutrient } from "./nutritionPlausibility"
import type { Nutrition } from "./types"

const mass100 = { type: "mass" as const, grams: 100 }

describe("nutrition OCR plausibility", () => {
  it("rejects values that cannot physically fit in a 100 g basis", () => {
    const result = assessNutrientCandidate("proteinG", 23_400, {}, mass100)
    expect(result.allowed).toBe(false)
    expect(result.range.max).toBeLessThan(103)
  })

  it("uses already-confirmed non-overlapping macros to tighten the remaining mass budget", () => {
    const confirmed: Nutrition = { carbsG: 60, proteinG: 10, fiberG: 5 }
    const range = plausibleRangeForNutrient("fatG", confirmed, mass100)
    expect(range.max).toBeCloseTo(27.1, 4)
    expect(assessNutrientCandidate("fatG", 90, confirmed, mass100).allowed).toBe(false)
    expect(assessNutrientCandidate("fatG", 9, confirmed, mass100).allowed).toBe(true)
  })

  it("uses subset relationships to constrain sugars and fats", () => {
    expect(plausibleRangeForNutrient("sugarsG", { carbsG: 12, addedSugarsG: 4 }, mass100)).toMatchObject({ min: 4 })
    expect(assessNutrientCandidate("sugarsG", 40, { carbsG: 12 }, mass100).allowed).toBe(false)
    expect(assessNutrientCandidate("transFatG", 5, { fatG: 4, saturatedFatG: 1 }, mass100).allowed).toBe(false)
  })

  it("rejects a macro candidate whose minimum energy already exceeds confirmed kcal", () => {
    const confirmed: Nutrition = { kcal: 100, proteinG: 5, sugarsG: 5 }
    expect(assessNutrientCandidate("fatG", 20, confirmed, mass100).allowed).toBe(false)
    expect(assessNutrientCandidate("fatG", 5, confirmed, mass100).allowed).toBe(true)
  })

  it("does not apply a 100 g mass ceiling to 100 ml liquids without density", () => {
    const volume100 = { type: "volume" as const, ml: 100 }
    expect(assessNutrientCandidate("carbsG", 115, {}, volume100).allowed).toBe(true)
    expect(assessNutrientCandidate("carbsG", 23_400, {}, volume100).allowed).toBe(false)
  })
})
