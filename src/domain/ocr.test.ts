import { describe, expect, it } from "vitest"
import { parseBrazilianNutritionLabel } from "./ocr"

describe("Brazilian nutrition label parser", () => {
  it("selects the 100 g column by its header position, with row-name units", () => {
    const draft = parseBrazilianNutritionLabel(`Porção: 30 g (4 3/4 unidades)
      30 g   100 g   %VD
      Valor energético (kcal) 162 540 8
      Carboidratos (g) 18,9 63 6
      Proteínas (g) 1,8 6 4
      Sódio (mg) 24 80 1`)
    expect(draft.nutritionBasis).toEqual({ type: "mass", grams: 100 })
    expect(draft.nutrition).toEqual({ kcal: 540, carbsG: 63, proteinG: 6, sodiumMg: 80 })
    expect(draft.servingUnits[0].quantity).toBe(4.75)
  })

  it("does not infer columns when the heading is cropped out", () => {
    const draft = parseBrazilianNutritionLabel(`Porção: 30 g
      Carboidratos (g) 63 18,9 6
      Sódio (mg) 80 24 1`)
    expect(draft.nutrition).toEqual({})
    expect(draft.warnings.some((warning) => warning.includes("Colunas ambíguas"))).toBe(true)
  })

  it("does not borrow numbers from the next row or from incomplete columns", () => {
    const draft = parseBrazilianNutritionLabel(`100 g 30 g %VD
      Carboidratos (g)
      Proteínas (g) 6 1,8 4
      Sódio (mg) 24 1`)
    expect(draft.nutrition).toEqual({ proteinG: 6 })
  })

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
