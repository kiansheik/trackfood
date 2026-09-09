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
    expect(draft.standardization).toBe("direct-100")
    expect(draft.nutrition).toEqual({ kcal: 540, carbsG: 63, proteinG: 6, sodiumMg: 80 })
    expect(draft.servingUnits[0].quantity).toBe(4.75)
  })

  it("does not infer columns when the heading is cropped out", () => {
    const draft = parseBrazilianNutritionLabel(`Porção: 30 g
      Carboidratos (g) 63 18,9 6
      Sódio (mg) 80 24 1`)
    expect(draft.nutrition).toEqual({})
    expect(draft.nutritionBasis).toEqual({ type: "mass", grams: 100 })
    expect(draft.standardization).toBe("scaled-to-100")
    expect(draft.warnings.some((warning) => warning.includes("Colunas ambíguas"))).toBe(true)
  })

  it("does not borrow from the next row or accept an incomplete numeric row", () => {
    const draft = parseBrazilianNutritionLabel(`100 g 30 g %VD
      Carboidratos (g)
      Proteínas (g) 6 1,8 4
      Sódio (mg) 24 1`)
    expect(draft.nutrition).toEqual({ proteinG: 6 })
    expect(draft.warnings.some((warning) => warning.includes("Colunas ambíguas"))).toBe(true)
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

  it("scales an older single-value serving label to the canonical 100 g basis", () => {
    const draft = parseBrazilianNutritionLabel(`Informação Nutricional
      Porção: 25 g
      Valor energético 100 kcal
      Carboidratos 10 g
      Proteínas 2 g
      Gorduras totais 5 g
      Sódio 50 mg`)
    expect(draft.nutritionBasis).toEqual({ type: "mass", grams: 100 })
    expect(draft.standardization).toBe("scaled-to-100")
    expect(draft.nutrition).toMatchObject({ kcal: 400, carbsG: 40, proteinG: 8, fatG: 20, sodiumMg: 200 })
  })

  it("extracts the per-100 column from ANVISA's linear/run-on ordering", () => {
    const draft = parseBrazilianNutritionLabel(`Informação Nutricional Porções por embalagem: 3 Porção: 30 g. Por 100 g (30 g, %VD*): Valor energético (kcal) 500 150 8 • Carboidratos (g) 60 18 6 • Açúcares totais (g) 20 6 • Açúcares adicionados (g) 10 3 6 • Proteínas (g) 8 2,4 5 • Gorduras totais (g) 12 3,6 7 • Gorduras saturadas (g) 4 1,2 6 • Gorduras trans (g) 0 0 • Fibras alimentares (g) 5 1,5 6 • Sódio (mg) 200 60 3`)
    expect(draft.nutritionBasis).toEqual({ type: "mass", grams: 100 })
    expect(draft.nutrition.kcal).toBe(500)
    expect(draft.nutrition.carbsG).toBe(60)
    expect(draft.nutrition.sodiumMg).toBe(200)
  })
})
