import type { Food, Nutrition, NutritionBasis, NutritionKey, ServingUnit } from "./types"
import { parseDecimalInput } from "./number"
import { extractNutritionFromLayout, type OcrLayout } from "./ocrLayout"

export type OcrNutritionDraft = {
  confidence: "low" | "medium" | "high"
  text: string
  nutritionBasis?: NutritionBasis
  nutrition: Nutrition
  servingUnits: ServingUnit[]
  warnings: string[]
  standardization: "direct-100" | "scaled-to-100" | "unknown"
}

const nutrientPatterns: Array<[NutritionKey, RegExp]> = [
  ["kcal", /valor energ[eé]tico\s*(?:\(\s*kcal\s*\))?\s+(\d+(?:[,.]\d+)?)\s*kcal/i],
  ["carbsG", /carboidratos\s*(?:\(\s*g\s*\))?\s+(\d+(?:[,.]\d+)?)\s*g/i],
  ["sugarsG", /a[cç][uú]cares totais\s*(?:\(\s*g\s*\))?\s+(\d+(?:[,.]\d+)?)\s*g/i],
  ["addedSugarsG", /a[cç][uú]cares adicionados\s*(?:\(\s*g\s*\))?\s+(\d+(?:[,.]\d+)?)\s*g/i],
  ["proteinG", /prote[ií]nas\s*(?:\(\s*g\s*\))?\s+(\d+(?:[,.]\d+)?)\s*g/i],
  ["fatG", /gorduras totais\s*(?:\(\s*g\s*\))?\s+(\d+(?:[,.]\d+)?)\s*g/i],
  ["saturatedFatG", /gorduras saturadas\s*(?:\(\s*g\s*\))?\s+(\d+(?:[,.]\d+)?)\s*g/i],
  ["transFatG", /gorduras trans\s*(?:\(\s*g\s*\))?\s+(\d+(?:[,.]\d+)?)\s*g/i],
  ["fiberG", /fibras? alimentar(?:es)?\s*(?:\(\s*g\s*\))?\s+(\d+(?:[,.]\d+)?)\s*g/i],
  ["sodiumMg", /s[oó]dio\s*(?:\(\s*mg\s*\))?\s+(\d+(?:[,.]\d+)?)\s*mg/i]
]

const rowLabels: Array<[NutritionKey, RegExp]> = [
  ["kcal", /valor energ[eé]tico/i],
  ["carbsG", /carboidratos?/i],
  ["sugarsG", /a[cç][uú]cares totais/i],
  ["addedSugarsG", /a[cç][uú]cares adicionados/i],
  ["proteinG", /prote[ií]nas?/i],
  ["fatG", /gorduras totais/i],
  ["saturatedFatG", /gorduras saturadas/i],
  ["transFatG", /gorduras trans/i],
  ["fiberG", /fibras? alimentar(?:es)?/i],
  ["sodiumMg", /s[oó]dio/i]
]

type TextExtraction = {
  nutritionBasis?: NutritionBasis
  nutrition: Nutrition
  servingUnits: ServingUnit[]
  warnings: string[]
}

function basisAmount(basis: NutritionBasis): number {
  return basis.type === "mass" ? basis.grams : basis.ml
}

function basisFor(unit: string, amount: number): NutritionBasis {
  return unit.toLowerCase() === "g" ? { type: "mass", grams: amount } : { type: "volume", ml: amount }
}

function parseColumns(text: string): { per100Index: number; numericColumnCount: number } | undefined {
  const matches = Array.from(text.matchAll(/(?:\b\d+(?:[,.]\d+)?\s*(?:g|ml)\b|%\s*vd\b)/gi)).map((match) => match[0])
  const per100Index = matches.findIndex((value) => /^100\s*(g|ml)$/i.test(value.trim()))
  if (per100Index < 0) return
  // %VD is a visual numeric column too. Count it so a truncated OCR row cannot
  // silently make a serving value look like the 100 g value.
  return { per100Index, numericColumnCount: matches.length }
}

function numericValues(text: string): number[] {
  return Array.from(text.matchAll(/-?\d+(?:[,.]\d+)?/g)).flatMap((match) => {
    const parsed = parseDecimalInput(match[0])
    return parsed === undefined ? [] : [parsed]
  })
}

function labelsInLine(line: string) {
  return rowLabels.flatMap(([key, pattern]) => pattern.test(line) ? [{ key, pattern }] : [])
}

function parseLinearModernLabel(normalized: string, nutrition: Nutrition) {
  const positions = rowLabels.flatMap(([key, pattern]) => {
    const match = normalized.match(pattern)
    return match?.index === undefined ? [] : [{ key, index: match.index, length: match[0].length }]
  }).sort((a, b) => a.index - b.index)
  if (positions.length < 2) return
  const first = positions[0]
  const per100At = normalized.search(/\b100\s*(?:g|ml)\b/i)
  if (per100At < 0 || per100At > first.index) return
  const order = parseColumns(normalized.slice(per100At, first.index))
  if (!order) return

  for (let i = 0; i < positions.length; i++) {
    const current = positions[i]
    const next = positions[i + 1]
    const segment = normalized.slice(current.index + current.length, next?.index ?? normalized.length)
    const values = numericValues(segment)
    // Linear labels can omit %VD for nutrients where a daily value is not
    // established, so require the desired column to exist but do not require
    // every trailing column. The per-100 ordering itself is explicit in the
    // header (ANVISA IN 75/2020, Annex XIV).
    if (values.length > order.per100Index) nutrition[current.key] = values[order.per100Index]
  }
}

function parseTextNutrition(text: string): TextExtraction {
  const normalized = text.replace(/\s+/g, " ").trim()
  const nutrition: Nutrition = {}
  const warnings: string[] = []
  const servingUnits: ServingUnit[] = []

  const basisMatch = normalized.match(/\b100\s*(g|ml)\b/i)
  const servingMatch = normalized.match(/por[cç][aã]o[:\s]*(\d+(?:[,.]\d+)?)\s*(g|ml)(?:\s*\((.+?)\))?/i)
  let nutritionBasis: NutritionBasis | undefined
  if (basisMatch) nutritionBasis = basisFor(basisMatch[1], 100)
  if (!nutritionBasis && servingMatch) {
    const amount = parseDecimalInput(servingMatch[1])
    if (amount && amount > 0) nutritionBasis = basisFor(servingMatch[2], amount)
  }

  // Legacy/linear labels sometimes repeat the unit immediately after each value.
  for (const [key, pattern] of nutrientPatterns) {
    const match = normalized.match(pattern)
    const parsed = parseDecimalInput(match?.[1])
    if (parsed !== undefined) nutrition[key] = parsed
  }

  // Modern Brazilian tables usually put units in the nutrient name and leave
  // numeric cells unitless. Preserve row boundaries and select the column whose
  // heading is 100 g/100 ml rather than assuming the first number.
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const firstRow = lines.findIndex((line) => labelsInLine(line).length > 0)
  const header = lines.slice(0, Math.max(0, firstRow)).filter((line) => !/^por[cç][aã]o\s*:/i.test(line)).join(" ")
  const columnInfo = parseColumns(header)
  let ambiguous = false
  let structuredRows = 0

  for (const line of lines) {
    const labels = labelsInLine(line)
    if (labels.length !== 1) continue
    structuredRows++
    const { key, pattern } = labels[0]
    const label = line.match(pattern)
    if (label?.index === undefined) continue
    const tail = line.slice(label.index + label[0].length)
    const values = numericValues(tail)
    if (!values.length) continue
    if (columnInfo) {
      // A table row must expose all header numeric columns. Otherwise we cannot
      // know whether OCR dropped a cell before the desired 100 g column.
      if (values.length < columnInfo.numericColumnCount || values.length <= columnInfo.per100Index) {
        ambiguous = true
        delete nutrition[key]
        continue
      }
      nutrition[key] = values[columnInfo.per100Index]
    } else if (values.length === 1 && nutritionBasis && basisAmount(nutritionBasis) !== 100) {
      // Old single-value-per-serving row. It will be scaled below.
      nutrition[key] = values[0]
    } else if (!(key in nutrition)) {
      ambiguous = true
    }
  }

  // ANVISA permits a linear/run-on model too. Only invoke this parser when OCR
  // has NOT already reconstructed multiple structured nutrient rows. Otherwise
  // flattening a valid table can lose a serving column that appears before the
  // 100 g column and overwrite the geometry/row-derived values.
  // https://bvs.saude.gov.br/bvs/saudelegis/anvisa/2020/IN%2075_2020_.pdf
  if (structuredRows < 2) parseLinearModernLabel(normalized, nutrition)

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

  if (ambiguous) warnings.push("Colunas ambíguas: inclua os cabeçalhos de 100 g/100 ml, porção e %VD na imagem.")
  return { nutritionBasis, nutrition, servingUnits, warnings }
}

function scaleNutrition(nutrition: Nutrition, factor: number): Nutrition {
  const scaled: Nutrition = {}
  for (const [key, value] of Object.entries(nutrition) as Array<[NutritionKey, number | undefined]>) {
    if (value === undefined) continue
    scaled[key] = Math.round(value * factor * 1000) / 1000
  }
  return scaled
}

/**
 * Regulatory invariant used by the product, not merely an OCR heuristic:
 * RDC 429/2020 art. 8 requires declaration per 100 g for solid/semi-solid
 * foods and per 100 ml for liquids, alongside serving values (with listed
 * exceptions). ANVISA also describes the per-100 declaration as mandatory.
 * https://bvsms.saude.gov.br/bvs/saudelegis/anvisa/2020/RDC_429_2020_.pdf
 * https://www.gov.br/anvisa/pt-br/assuntos/alimentos/rotulagem/rotulagem-nutricional
 *
 * TrackFood therefore never lets a serving-basis OCR draft masquerade as the
 * canonical result. If an older/linear label only yields a known serving basis,
 * values are scaled mathematically to 100 g/100 ml before consensus. We never
 * convert 100 ml to 100 g without density data.
 */
export function standardizeNutritionTo100(nutrition: Nutrition, basis?: NutritionBasis): {
  nutrition: Nutrition
  basis?: NutritionBasis
  standardization: OcrNutritionDraft["standardization"]
} {
  if (!basis) return { nutrition, standardization: "unknown" }
  const amount = basisAmount(basis)
  if (!Number.isFinite(amount) || amount <= 0) return { nutrition, standardization: "unknown" }
  const canonical = basis.type === "mass" ? { type: "mass" as const, grams: 100 } : { type: "volume" as const, ml: 100 }
  if (Math.abs(amount - 100) < 0.001) return { nutrition, basis: canonical, standardization: "direct-100" }
  return { nutrition: scaleNutrition(nutrition, 100 / amount), basis: canonical, standardization: "scaled-to-100" }
}

export function parseBrazilianNutritionLabel(text: string, layout?: OcrLayout): OcrNutritionDraft {
  const textExtraction = parseTextNutrition(text)
  let nutritionBasis = textExtraction.nutritionBasis
  const nutrition: Nutrition = { ...textExtraction.nutrition }
  const warnings = [...textExtraction.warnings]

  if (layout?.items.length) {
    const geometric = extractNutritionFromLayout(layout)
    // Geometry wins field-by-field when it can identify the mandatory per-100
    // column. Text parsing remains useful for linear/run-on labels and serving
    // descriptions, and fills only fields geometry did not resolve.
    if (geometric.nutritionBasis) nutritionBasis = geometric.nutritionBasis
    for (const [key, value] of Object.entries(geometric.nutrition) as Array<[NutritionKey, number | undefined]>) {
      if (value !== undefined) nutrition[key] = value
    }
    if (geometric.matchedRows < 3) warnings.push(...geometric.warnings)
  }

  const standardized = standardizeNutritionTo100(nutrition, nutritionBasis)
  if (!standardized.basis) warnings.push("Base nutricional não identificada; TrackFood exige 100 g/100 ml antes da confirmação.")
  if (standardized.standardization === "scaled-to-100") warnings.push("Valores convertidos matematicamente da porção reconhecida para 100 g/100 ml.")
  const nutrientCount = Object.keys(standardized.nutrition).length
  if (nutrientCount < 3) warnings.push("Poucos nutrientes foram reconhecidos.")
  if (!textExtraction.servingUnits.length && /unidade|por[cç][aã]o/i.test(text.replace(/\s+/g, " "))) warnings.push("Medida caseira não confirmada; isso não bloqueia os valores por 100 g/100 ml.")

  const uniqueWarnings = [...new Set(warnings)]
  const confidence: OcrNutritionDraft["confidence"] = standardized.basis && nutrientCount >= 8 && uniqueWarnings.every((warning) => !/amb[ií]gu|não identificada/i.test(warning))
    ? "high"
    : nutrientCount >= 3 ? "medium" : "low"

  return {
    confidence,
    text,
    nutritionBasis: standardized.basis,
    nutrition: standardized.nutrition,
    servingUnits: textExtraction.servingUnits,
    warnings: uniqueWarnings,
    standardization: standardized.standardization
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
    sourceMetadata: { warnings: draft.warnings, confidence: draft.confidence, rawText: draft.text, standardization: draft.standardization }
  }
}
