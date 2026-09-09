import { describe, expect, it } from "vitest"
import { extractNutritionFromLayout, matchNutrientLabel, type OcrLayout, type OcrLayoutItem } from "./ocrLayout"

function cell(text: string, x: number, y: number, width = 90, height = 20, score = 0.95): OcrLayoutItem {
  return { text, score, poly: [[x, y], [x + width, y], [x + width, y + height], [x, y + height]] }
}

function layout(items: OcrLayoutItem[]): OcrLayout {
  return { width: 900, height: 700, items }
}

describe("geometry-aware nutrition extraction", () => {
  it("selects the actual 100 g column from fragmented OCR boxes", () => {
    const result = extractNutritionFromLayout(layout([
      cell("100 g", 260, 60, 55), cell("30 g", 360, 60, 55), cell("%VD*", 455, 60, 55),
      cell("Valor energético (kcal)", 20, 110, 190), cell("540", 260, 110, 55), cell("162", 360, 110, 55), cell("8", 455, 110, 30),
      cell("Carboidratos (g)", 20, 145, 150), cell("63", 260, 145, 55), cell("18,9", 360, 145, 55), cell("6", 455, 145, 30),
      cell("Proteínas (g)", 20, 180, 120), cell("6", 260, 180, 55), cell("1,8", 360, 180, 55), cell("4", 455, 180, 30),
      cell("Sódio (mg)", 20, 215, 100), cell("80", 260, 215, 55), cell("24", 360, 215, 55), cell("1", 455, 215, 30)
    ]))
    expect(result.nutritionBasis).toEqual({ type: "mass", grams: 100 })
    expect(result.nutrition).toMatchObject({ kcal: 540, carbsG: 63, proteinG: 6, sodiumMg: 80 })
  })

  it("handles ANVISA broken layouts with two independent 100 g columns on one row", () => {
    const result = extractNutritionFromLayout(layout([
      cell("100 g", 170, 60, 55), cell("30 g", 255, 60, 55), cell("%VD", 335, 60, 50),
      cell("100 g", 590, 60, 55), cell("30 g", 675, 60, 55), cell("%VD", 755, 60, 50),
      cell("Carboidratos (g)", 20, 120, 130), cell("60", 170, 120, 45), cell("18", 255, 120, 45), cell("6", 335, 120, 35),
      cell("Gorduras totais (g)", 430, 120, 135), cell("12", 590, 120, 45), cell("3,6", 675, 120, 45), cell("5", 755, 120, 35),
      cell("Proteínas (g)", 20, 160, 110), cell("10", 170, 160, 45), cell("3", 255, 160, 45), cell("6", 335, 160, 35),
      cell("Sódio (mg)", 430, 160, 90), cell("100", 590, 160, 45), cell("30", 675, 160, 45), cell("2", 755, 160, 35)
    ]))
    expect(result.nutrition).toMatchObject({ carbsG: 60, fatG: 12, proteinG: 10, sodiumMg: 100 })
  })

  it("uses fuzzy Portuguese nutrient matching for small OCR spelling errors", () => {
    expect(matchNutrientLabel("Gorduras saturadus (g)")).toBe("saturatedFatG")
    expect(matchNutrientLabel("Acúcares adicionados (g)")).toBe("addedSugarsG")
    expect(matchNutrientLabel("Fibra alimentar")).toBe("fiberG")
  })
})
