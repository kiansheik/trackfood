import { describe, expect, it } from "vitest"
import { duplicateFoodDraft } from "./foods"
import type { Food } from "./types"

const food: Food = {
  id: "original",
  name: "Chocolate",
  brand: "Brand",
  barcode: "789",
  nutritionBasis: { type: "mass", grams: 100 },
  nutrition: { kcal: 500 },
  servingUnits: [{ id: "unit-a", singular: "unidade", plural: "unidades", quantity: 4.75, grams: 30 }],
  source: "manual",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
}

describe("food duplication", () => {
  it("copies editable nutrition and serving data without barcode/id conflicts", () => {
    const draft = duplicateFoodDraft(food, () => "new-unit")
    expect(draft.name).toBe("Chocolate copy")
    expect(draft.barcode).toBeUndefined()
    expect(draft.nutrition).toEqual(food.nutrition)
    expect(draft.servingUnits?.[0]).toEqual({ ...food.servingUnits[0], id: "new-unit" })
  })
})
