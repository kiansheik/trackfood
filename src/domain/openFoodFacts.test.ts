import { describe, expect, it } from "vitest"
import { normalizeOpenFoodFactsIdentity, normalizeOpenFoodFactsProduct } from "./openFoodFacts"

describe("Open Food Facts normalization", () => {
  it("keeps product identity even when nutrition is completely absent", () => {
    const draft = normalizeOpenFoodFactsProduct({
      product_name_pt: "Biscoito recheado",
      product_name: "Filled biscuit",
      brands: "Marca Exemplo"
    }, "789123")

    expect(draft.name).toBe("Biscoito recheado")
    expect(draft.brand).toBe("Marca Exemplo")
    expect(draft.barcode).toBe("789123")
    expect(draft.nutrition).toEqual({
      kcal: undefined,
      carbsG: undefined,
      sugarsG: undefined,
      addedSugarsG: undefined,
      proteinG: undefined,
      fatG: undefined,
      saturatedFatG: undefined,
      transFatG: undefined,
      fiberG: undefined,
      sodiumMg: undefined
    })
  })

  it("prefers the Portuguese identity without depending on health fields", () => {
    expect(normalizeOpenFoodFactsIdentity({
      product_name_pt: "Iogurte natural",
      product_name: "Natural yogurt",
      brands: "Laticínios"
    }, "789")).toEqual({
      barcode: "789",
      name: "Iogurte natural",
      brand: "Laticínios",
      provider: "Open Food Facts"
    })
  })
})
