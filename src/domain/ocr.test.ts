import { describe, expect, it } from "vitest"
import { parseBrazilianNutritionLabel } from "./ocr"

describe("Brazilian nutrition label parser", () => {
  it("handles decimal commas and human units in a serving relationship", () => {
    const draft = parseBrazilianNutritionLabel(`
      Informação Nutricional
      Porção: 30 g (4,75 unidades)
      100 g
      Valor energético 540 kcal
      Carboidratos 63 g
      Açúcares totais 47 g
      Proteínas 6 g
      Gorduras totais 27 g
      Gorduras saturadas 14 g
      Gorduras trans 0,3 g
      Fibra alimentar 4 g
      Sódio 80 mg
    `)
    expect(draft.nutritionBasis).toEqual({ type: "mass", grams: 100 })
    expect(draft.nutrition.transFatG).toBe(0.3)
    expect(draft.servingUnits[0].quantity).toBe(4.75)
    expect(draft.servingUnits[0].grams).toBe(30)
  })
})
