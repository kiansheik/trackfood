import { describe, expect, it } from "vitest"
import { combineOcrObservations, type OcrObservation } from "./ocrConsensus"
import type { Nutrition } from "./types"

const nutrition: Nutrition = { kcal: 400, carbsG: 60, sugarsG: 10, addedSugarsG: 8, proteinG: 10, fatG: 12, saturatedFatG: 4, transFatG: 0, fiberG: 5, sodiumMg: 100 }
function frame(id: number, values: Nutrition = nutrition, quality = 90): OcrObservation {
  return { id, quality, draft: { text: "100 g", nutritionBasis: { type: "mass", grams: 100 }, nutrition: values, servingUnits: [], confidence: "high", warnings: [], standardization: "direct-100" } }
}

describe("multi-frame label consensus", () => {
  it("requires repeat evidence and full coverage; zero is a value, missing is not zero", () => {
    expect(combineOcrObservations([frame(1)]).ready).toBe(false)
    expect(combineOcrObservations([frame(1), frame(2), frame(3)]).ready).toBe(false)
    const result = combineOcrObservations([frame(1), frame(2), frame(3), frame(4)])
    expect(result.ready).toBe(true)
    expect(result.draft.nutrition.transFatG).toBe(0)
    const partial = combineOcrObservations([1, 2, 3, 4].map((id) => frame(id, { kcal: 400 })))
    expect(partial.ready).toBe(false)
    expect(partial.draft.nutrition.transFatG).toBeUndefined()
  })

  it("combines complementary fields without averaging conflicting numbers", () => {
    const frames = [1, 2, 3].map((id) => frame(id, { kcal: 400, proteinG: 10 }))
    frames.push(...[4, 5, 6].map((id) => frame(id, { carbsG: 60, fatG: 12 })))
    frames.push(frame(7, { kcal: 40 }))
    const result = combineOcrObservations(frames)
    expect(result.draft.nutrition).toEqual({ kcal: 400, proteinG: 10, carbsG: 60, fatG: 12 })
    expect(result.fields.kcal.confirmed).toBe(false)
    expect(result.fields.kcal.candidates.map((item) => item.value)).toEqual([400, 40])
  })

  it("does not let a long majority conceal a recent contradiction", () => {
    const frames = Array.from({ length: 10 }, (_, i) => frame(i))
    frames.push(frame(11, { ...nutrition, kcal: 40 }))
    const result = combineOcrObservations(frames)
    expect(result.fields.kcal.agreement).toBeGreaterThan(0.85)
    expect(result.fields.kcal.confirmed).toBe(false)
    expect(result.ready).toBe(false)
    const corrected = combineOcrObservations([...frames, ...Array.from({ length: 12 }, (_, i) => frame(12 + i, { ...nutrition, kcal: 40 }))])
    expect(corrected.fields.kcal.value).toBe(40)
    expect(corrected.fields.kcal.confirmed).toBe(true)
    expect(corrected.observations).toHaveLength(12)
  })

  it("never pools an unstandardized serving basis with per-100 values or an absent basis", () => {
    const frames = [1, 2, 3, 4].map((id) => frame(id, { kcal: 400 }))
    const other = frame(5, { proteinG: 3 })
    other.draft.nutritionBasis = { type: "mass", grams: 30 }
    other.draft.standardization = "unknown"
    const unknown = frame(6, { fatG: 4 })
    unknown.draft.nutritionBasis = undefined
    unknown.draft.standardization = "unknown"
    const result = combineOcrObservations([...frames, other, unknown])
    expect(result.draft.nutrition).toEqual({ kcal: 400 })
    expect(result.basis.confirmed).toBe(false)
    expect(result.ready).toBe(false)
  })

  it("ignores low-quality OCR and duplicate frame IDs", () => {
    const result = combineOcrObservations([frame(1), frame(1), frame(1), frame(2, nutrition, 20)])
    expect(result.fields.kcal.support).toBe(1)
    expect(result.ready).toBe(false)
  })

  it("blocks automatic acceptance of inconsistent sugar or fat readings", () => {
    const result = combineOcrObservations([1, 2, 3, 4].map((id) => frame(id, { ...nutrition, addedSugarsG: 80 })))
    expect(result.ready).toBe(false)
    expect(result.draft.warnings.some((warning) => warning.includes("incompatíveis"))).toBe(true)
  })

  it("does not block per-100 completion on a difficult household-serving parenthetical", () => {
    const frames = [1, 2, 3, 4].map((id) => {
      const item = frame(id)
      item.draft.text = "Porção: 30 g (4,75 unidades)\n100 g"
      item.draft.servingUnits = [{ id: String(id), quantity: 4.75, grams: 30, singular: "unidade", plural: "unidades" }]
      return item
    })
    expect(combineOcrObservations(frames).ready).toBe(true)
    frames.slice(1).forEach((item) => { item.draft.servingUnits = [] })
    const result = combineOcrObservations(frames)
    expect(result.ready).toBe(true)
    expect(result.draft.warnings.some((warning) => warning.includes("Medida caseira"))).toBe(true)
  })
})
