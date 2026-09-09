import type { Nutrition, NutritionBasis, NutritionKey } from "./types"
import { parseDecimalInput } from "./number"

/**
 * Geometry-preserving OCR is intentional here.
 *
 * Methodology references:
 * - Open Food Facts' nutrition extractor uses OCR tokens together with 2D
 *   coordinates (LayoutLMv3), rather than flattening a label to plain text:
 *   https://huggingface.co/openfoodfacts/nutrition-extractor
 * - Its public nutrient-layout dataset explicitly contains ordinary tables,
 *   USDA-like tables and nutrition information expressed as text rather than a
 *   table, which is the same variation TrackFood has to tolerate:
 *   https://huggingface.co/datasets/openfoodfacts/nutrient-detection-layout
 * - ANVISA IN 75/2020 defines vertical, broken, horizontal, aggregate and
 *   linear forms. In particular, broken layouts can contain two independent
 *   100 g columns on the same visual row:
 *   https://bvsms.saude.gov.br/bvs/saudelegis/anvisa/2020/IN%2075_2020_.pdf
 *
 * We therefore keep OCR polygons and reconstruct visual rows/blocks. Plain
 * text remains a fallback for linear/run-on labels.
 */

export type OcrPoint = [number, number]
export type OcrLayoutItem = {
  text: string
  score: number
  poly: OcrPoint[]
}

export type OcrLayout = {
  width: number
  height: number
  items: OcrLayoutItem[]
}

export type LayoutNutritionExtraction = {
  text: string
  nutritionBasis?: NutritionBasis
  nutrition: Nutrition
  matchedRows: number
  warnings: string[]
}

type Box = { left: number; top: number; right: number; bottom: number; cx: number; cy: number; width: number; height: number }
type Located = OcrLayoutItem & { box: Box }
type VisualRow = { cells: Located[]; cy: number; height: number }

type NutrientDefinition = {
  key: NutritionKey
  aliases: string[]
}

export const NUTRIENT_DEFINITIONS: NutrientDefinition[] = [
  { key: "kcal", aliases: ["valor energetico", "energia"] },
  { key: "carbsG", aliases: ["carboidratos", "carboidrato"] },
  { key: "sugarsG", aliases: ["acucares totais", "acucar total", "acucares total"] },
  { key: "addedSugarsG", aliases: ["acucares adicionados", "acucar adicionado", "acucares adicionadas"] },
  { key: "proteinG", aliases: ["proteinas", "proteina"] },
  { key: "fatG", aliases: ["gorduras totais", "gordura total"] },
  { key: "saturatedFatG", aliases: ["gorduras saturadas", "gordura saturada"] },
  { key: "transFatG", aliases: ["gorduras trans", "gordura trans"] },
  { key: "fiberG", aliases: ["fibras alimentares", "fibra alimentar"] },
  { key: "sodiumMg", aliases: ["sodio"] }
]

function boxFor(item: OcrLayoutItem): Box | undefined {
  const points = item.poly.filter((point) => point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1]))
  if (!points.length) return
  const xs = points.map((point) => point[0])
  const ys = points.map((point) => point[1])
  const left = Math.min(...xs)
  const right = Math.max(...xs)
  const top = Math.min(...ys)
  const bottom = Math.max(...ys)
  return {
    left, top, right, bottom,
    cx: (left + right) / 2,
    cy: (top + bottom) / 2,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top)
  }
}

export function foldOcrText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[|•·]/g, " ")
    .replace(/[^a-z0-9%.,/\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

export function clusterOcrRows(layout: OcrLayout): VisualRow[] {
  const located = layout.items
    .filter((item) => item.text.trim())
    .flatMap((item) => {
      const box = boxFor(item)
      return box ? [{ ...item, box }] : []
    })
    .sort((a, b) => a.box.cy - b.box.cy || a.box.left - b.box.left)
  const typicalHeight = median(located.map((item) => item.box.height)) || 12
  const rows: VisualRow[] = []
  for (const item of located) {
    const threshold = Math.max(5, Math.min(typicalHeight, item.box.height) * 0.7)
    let best: VisualRow | undefined
    let bestDistance = Number.POSITIVE_INFINITY
    for (const row of rows.slice(-4)) {
      const distance = Math.abs(row.cy - item.box.cy)
      if (distance <= threshold && distance < bestDistance) {
        best = row
        bestDistance = distance
      }
    }
    if (!best) {
      rows.push({ cells: [item], cy: item.box.cy, height: item.box.height })
      continue
    }
    best.cells.push(item)
    best.cells.sort((a, b) => a.box.left - b.box.left)
    best.cy = best.cells.reduce((sum, cell) => sum + cell.box.cy, 0) / best.cells.length
    best.height = median(best.cells.map((cell) => cell.box.height))
  }
  return rows.sort((a, b) => a.cy - b.cy)
}

export function layoutItemsToText(layout: OcrLayout): string {
  return clusterOcrRows(layout)
    .map((row) => row.cells.map((cell) => cell.text.trim()).join("  "))
    .join("\n")
}

function levenshtein(a: string, b: string): number {
  if (!a.length) return b.length
  if (!b.length) return a.length
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i++) {
    let diagonal = previous[0]
    previous[0] = i
    for (let j = 1; j <= b.length; j++) {
      const old = previous[j]
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + Number(a[i - 1] !== b[j - 1]))
      diagonal = old
    }
  }
  return previous[b.length]
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length)
}

function stripLabelNoise(text: string): string {
  return foldOcrText(text)
    .replace(/\b(kcal|kj|mg|g|ml|vd)\b/g, " ")
    .replace(/[0-9%.,/()-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export function matchNutrientLabel(text: string): NutritionKey | undefined {
  const candidate = stripLabelNoise(text)
  if (!candidate) return
  let winner: { key: NutritionKey; score: number } | undefined
  for (const definition of NUTRIENT_DEFINITIONS) {
    for (const alias of definition.aliases) {
      if (candidate.includes(alias) || alias.includes(candidate) && candidate.length >= Math.min(6, alias.length)) {
        const score = candidate.includes(alias) ? 1 : candidate.length / alias.length
        if (!winner || score > winner.score) winner = { key: definition.key, score }
        continue
      }
      const words = candidate.split(" ")
      const aliasWords = alias.split(" ")
      const sizes = new Set([aliasWords.length, aliasWords.length + 1, Math.max(1, aliasWords.length - 1)])
      for (const size of sizes) {
        for (let start = 0; start + size <= words.length; start++) {
          const window = words.slice(start, start + size).join(" ")
          const score = similarity(window, alias)
          if ((!winner || score > winner.score) && score >= 0.72) winner = { key: definition.key, score }
        }
      }
    }
  }
  return winner?.key
}

type NumberCandidate = { value: number; x: number; percent: boolean; source: Located; order: number }

function numberCandidates(cells: Located[]): NumberCandidate[] {
  const result: NumberCandidate[] = []
  let order = 0
  for (const cell of cells) {
    const text = foldOcrText(cell.text)
    const matches = Array.from(text.matchAll(/-?\d+(?:[,.]\d+)?/g))
    for (const match of matches) {
      const value = parseDecimalInput(match[0])
      if (value === undefined) continue
      const after = text.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 4)
      result.push({ value, x: cell.box.cx, percent: /^\s*%/.test(after) || /%\s*vd/.test(text), source: cell, order: order++ })
    }
  }
  return result
}

function basisFromHeader(text: string): NutritionBasis | undefined {
  const match = foldOcrText(text).match(/\b100\s*(g|ml)\b/)
  if (!match) return
  return match[1] === "g" ? { type: "mass", grams: 100 } : { type: "volume", ml: 100 }
}

function exactPer100Cell(cell: Located): boolean {
  const folded = foldOcrText(cell.text)
  return /^100\s*(g|ml)$/.test(folded) || /\b100\s*(g|ml)\b/.test(folded) && folded.length <= 12
}

function headerOrder(text: string): { per100Index: number; columnCount: number } | undefined {
  const folded = foldOcrText(text)
  const tokens = Array.from(folded.matchAll(/(?:\b\d+(?:[,.]\d+)?\s*(?:g|ml)\b|%\s*vd\b)/g)).map((match) => match[0])
  const per100Index = tokens.findIndex((token) => /^100\s*(g|ml)$/.test(token.trim()))
  if (per100Index < 0) return
  return { per100Index, columnCount: tokens.length }
}

function choosePer100Value(block: Located[], labelCell: Located, per100Xs: number[], orderInfo?: { per100Index: number; columnCount: number }): number | undefined {
  const candidates = numberCandidates(block).filter((candidate) => {
    // Ignore the 100 in a header accidentally grouped with the row and numbers
    // embedded in the nutrient label itself.
    return candidate.source !== labelCell && !matchNutrientLabel(candidate.source.text)
  })
  if (!candidates.length) return

  if (per100Xs.length) {
    const target = per100Xs.reduce((best, x) => Math.abs(x - labelCell.box.cx) < Math.abs(best - labelCell.box.cx) ? x : best, per100Xs[0])
    const geometric = [...candidates]
      .filter((candidate) => !candidate.percent)
      .sort((a, b) => Math.abs(a.x - target) - Math.abs(b.x - target))[0]
    if (geometric) {
      const tolerance = Math.max(labelCell.box.height * 8, 80)
      if (Math.abs(geometric.x - target) <= tolerance || candidates.length <= 3) return geometric.value
    }
  }

  const nonPercent = candidates.filter((candidate) => !candidate.percent)
  if (orderInfo && nonPercent.length >= Math.min(orderInfo.columnCount, orderInfo.per100Index + 1)) return nonPercent[orderInfo.per100Index]?.value
  if (nonPercent.length === 1) return nonPercent[0].value
  return
}

export function extractNutritionFromLayout(layout: OcrLayout): LayoutNutritionExtraction {
  const rows = clusterOcrRows(layout)
  const text = rows.map((row) => row.cells.map((cell) => cell.text.trim()).join("  ")).join("\n")
  const nutritionBasis = basisFromHeader(text)
  const nutrition: Nutrition = {}
  const warnings: string[] = []

  const allCells = rows.flatMap((row) => row.cells)
  // Broken/side-by-side ANVISA layouts can expose two independent 100 g/100 ml
  // column x positions. Keep all of them and choose the one nearest each label.
  const per100Xs = allCells.filter(exactPer100Cell).map((cell) => cell.box.cx)
  const firstNutrientRow = rows.findIndex((row) => row.cells.some((cell) => matchNutrientLabel(cell.text)))
  const headerText = rows.slice(0, firstNutrientRow < 0 ? rows.length : firstNutrientRow).map((row) => row.cells.map((cell) => cell.text).join(" ")).join(" ")
  const orderInfo = headerOrder(headerText)

  let matchedRows = 0
  for (const row of rows) {
    const labels = row.cells
      .map((cell, index) => ({ cell, index, key: matchNutrientLabel(cell.text) }))
      .filter((entry): entry is { cell: Located; index: number; key: NutritionKey } => !!entry.key)
    if (!labels.length) continue

    for (let labelIndex = 0; labelIndex < labels.length; labelIndex++) {
      const label = labels[labelIndex]
      const next = labels[labelIndex + 1]
      const block = row.cells.slice(label.index, next?.index ?? row.cells.length)
      const value = choosePer100Value(block, label.cell, per100Xs, orderInfo)
      if (value === undefined || !Number.isFinite(value) || value < 0) continue
      nutrition[label.key] = value
      matchedRows++
    }
  }

  if (!nutritionBasis) warnings.push("A coluna obrigatória de 100 g/100 ml não foi localizada pela geometria.")
  if (matchedRows < 3) warnings.push("Poucas linhas nutricionais puderam ser associadas à coluna de 100 g/100 ml.")
  return { text, nutritionBasis, nutrition, matchedRows, warnings }
}
