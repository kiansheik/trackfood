import type { Food, Nutrition, NutritionBasis, ServingUnit } from "./types"
import { parseDecimalInput } from "./number"

export type OcrNutritionDraft = {
  confidence: "low" | "medium" | "high"
  text: string
  nutritionBasis?: NutritionBasis
  nutrition: Nutrition
  servingUnits: ServingUnit[]
  warnings: string[]
}

const nutrientPatterns: Array<[keyof Nutrition, RegExp]> = [
  ["kcal", /valor energ[eé]tico\s+(\d+(?:[,.]\d+)?)\s*kcal/i],
  ["carbsG", /carboidratos\s+(\d+(?:[,.]\d+)?)\s*g/i],
  ["sugarsG", /a[cç][uú]cares totais\s+(\d+(?:[,.]\d+)?)\s*g/i],
  ["addedSugarsG", /a[cç][uú]cares adicionados\s+(\d+(?:[,.]\d+)?)\s*g/i],
  ["proteinG", /prote[ií]nas\s+(\d+(?:[,.]\d+)?)\s*g/i],
  ["fatG", /gorduras totais\s+(\d+(?:[,.]\d+)?)\s*g/i],
  ["saturatedFatG", /gorduras saturadas\s+(\d+(?:[,.]\d+)?)\s*g/i],
  ["transFatG", /gorduras trans\s+(\d+(?:[,.]\d+)?)\s*g/i],
  ["fiberG", /fibra alimentar\s+(\d+(?:[,.]\d+)?)\s*g/i],
  ["sodiumMg", /s[oó]dio\s+(\d+(?:[,.]\d+)?)\s*mg/i]
]

export function parseBrazilianNutritionLabel(text: string): OcrNutritionDraft {
  const normalized = text.replace(/\s+/g, " ").trim()
  const nutrition: Nutrition = {}
  const warnings: string[] = []

  const basisMatch = normalized.match(/100\s*(g|ml)/i)
  const servingMatch = normalized.match(/por[cç][aã]o[:\s]*(\d+(?:[,.]\d+)?)\s*(g|ml)(?:\s*\((\d+(?:[,.]\d+)?)\s*([^)]+?)\))?/i)

  let nutritionBasis: NutritionBasis | undefined
  if (basisMatch?.[1]?.toLowerCase() === "g") nutritionBasis = { type: "mass", grams: 100 }
  if (basisMatch?.[1]?.toLowerCase() === "ml") nutritionBasis = { type: "volume", ml: 100 }
  if (!nutritionBasis && servingMatch) {
    const amount = parseDecimalInput(servingMatch[1])
    if (amount && servingMatch[2].toLowerCase() === "g") nutritionBasis = { type: "mass", grams: amount }
    if (amount && servingMatch[2].toLowerCase() === "ml") nutritionBasis = { type: "volume", ml: amount }
  }

  for (const [key, pattern] of nutrientPatterns) {
    const match = normalized.match(pattern)
    const parsed = parseDecimalInput(match?.[1])
    if (parsed !== undefined) nutrition[key] = parsed
  }

  const servingUnits: ServingUnit[] = []
  if (servingMatch?.[3] && servingMatch?.[4]) {
    const quantity = parseDecimalInput(servingMatch[3])
    const baseAmount = parseDecimalInput(servingMatch[1])
    if (quantity && baseAmount) {
      const raw = servingMatch[4].trim().replace(/\.$/, "")
      servingUnits.push({
        id: crypto.randomUUID(),
        singular: singularizePortuguese(raw),
        plural: raw,
        quantity,
        grams: servingMatch[2].toLowerCase() === "g" ? baseAmount : undefined,
        ml: servingMatch[2].toLowerCase() === "ml" ? baseAmount : undefined
      })
    }
  }

  if (!nutritionBasis) warnings.push("Base nutricional não identificada.")
  if (Object.keys(nutrition).length < 3) warnings.push("Poucos nutrientes foram reconhecidos.")
  if (!servingUnits.length && /unidade|por[cç][aã]o/i.test(normalized)) warnings.push("Revise manualmente a relação de porção/unidade.")

  return {
    confidence: warnings.length === 0 ? "high" : Object.keys(nutrition).length >= 3 ? "medium" : "low",
    text,
    nutritionBasis,
    nutrition,
    servingUnits,
    warnings
  }
}

function singularizePortuguese(value: string): string {
  const trimmed = value.trim()
  if (trimmed.toLowerCase().endsWith("es")) return trimmed.slice(0, -2)
  if (trimmed.toLowerCase().endsWith("s")) return trimmed.slice(0, -1)
  return trimmed
}

export function foodFromOcrDraft(name: string, draft: OcrNutritionDraft): Partial<Food> {
  return {
    name,
    nutritionBasis: draft.nutritionBasis,
    nutrition: draft.nutrition,
    servingUnits: draft.servingUnits,
    source: "label-ocr",
    sourceMetadata: { warnings: draft.warnings, confidence: draft.confidence, rawText: draft.text }
  }
}
