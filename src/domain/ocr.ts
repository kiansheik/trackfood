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

// Keep row boundaries: flattening a table can associate a nutrient with a
// neighbouring row or the %VD column. Modern labels put units in the row name.
const rowLabels: Array<[keyof Nutrition, RegExp]> = [
  ["kcal", /valor energ[eé]tico/i],
  ["carbsG", /carboidratos/i],
  ["sugarsG", /a[cç][uú]cares totais/i],
  ["addedSugarsG", /a[cç][uú]cares adicionados/i],
  ["proteinG", /prote[ií]nas/i],
  ["fatG", /gorduras totais/i],
  ["saturatedFatG", /gorduras saturadas/i],
  ["transFatG", /gorduras trans/i],
  ["fiberG", /fibras? alimentar(?:es)?/i],
  ["sodiumMg", /s[oó]dio/i]
]

export function parseBrazilianNutritionLabel(text: string): OcrNutritionDraft {
  const normalized = text.replace(/\s+/g, " ").trim()
  const nutrition: Nutrition = {}
  const warnings: string[] = []

  const basisMatch = normalized.match(/100\s*(g|ml)/i)
  const servingMatch = normalized.match(/por[cç][aã]o[:\s]*(\d+(?:[,.]\d+)?)\s*(g|ml)(?:\s*\((.+?)\))?/i)

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

  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const firstRow = lines.findIndex((line) => rowLabels.some(([, pattern]) => pattern.test(line)))
  const header = lines.slice(0, Math.max(0, firstRow)).filter((line) => !/por[cç][aã]o/i.test(line)).join(" ")
  const columns = Array.from(header.matchAll(/\b(\d+(?:[,.]\d+)?)\s*(g|ml)\b/gi))
  const column = columns.findIndex((match) => Number(match[1].replace(",", ".")) === 100)
  const selectedColumn = column >= 0 ? column : 0
  if (columns.length) {
    const match = columns[selectedColumn]
    const amount = parseDecimalInput(match[1])!
    nutritionBasis = match[2].toLowerCase() === "g" ? { type: "mass", grams: amount } : { type: "volume", ml: amount }
  }
  let ambiguous = false
  for (const line of lines) {
    const labels = rowLabels.filter(([, pattern]) => pattern.test(line))
    if (labels.length !== 1) continue // Legacy inline text uses the explicit-unit parser above.
    const [key, pattern] = labels[0]
    const label = line.match(pattern)!
    const tail = line.slice(label.index! + label[0].length)
    const expectedUnit = key === "kcal" ? "kcal" : key === "sodiumMg" ? "mg" : "g"
    const tokens = Array.from(tail.matchAll(/(\d+(?:[,.]\d+)?)\s*(kcal|mg|g|%)?/gi))
    const hasUnit = new RegExp(`\\b${expectedUnit}\\b`, "i").test(tail)
    delete nutrition[key]
    if (!hasUnit || !tokens.length) continue
    // Multiple numeric columns require an explicit header; never assume the
    // first one is per 100 g merely because 100 g occurs elsewhere in the text.
    if (tokens.length > 1 && !columns.length) {
      ambiguous = true
      continue
    }
    if (columns.length && tokens.length < columns.length + Number(/%\s*vd/i.test(header))) {
      ambiguous = true
      continue
    }
    const token = tokens[selectedColumn]
    if (!token || token[2] === "%" || (token[2] && token[2].toLowerCase() !== expectedUnit)) continue
    const parsed = parseDecimalInput(token[1])
    if (parsed !== undefined) nutrition[key] = parsed
  }
  if (ambiguous) warnings.push("Colunas ambíguas: inclua os cabeçalhos da tabela na imagem.")

  const servingUnits: ServingUnit[] = []
  const unitMatch = servingMatch?.[3]?.match(/^([\d\s.,/¼-¾⅐-⅞+-]+?)\s+([^\d\s].*)$/)
  if (unitMatch && servingMatch) {
    const quantity = parseDecimalInput(unitMatch[1])
    const baseAmount = parseDecimalInput(servingMatch[1])
    if (quantity && baseAmount) {
      const raw = unitMatch[2].trim().replace(/\.$/, "")
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
