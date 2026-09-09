import type { Nutrition, NutritionBasis, NutritionKey, ServingUnit } from "./types"
import type { OcrNutritionDraft } from "./ocr"

export const NUTRIENT_KEYS: NutritionKey[] = ["kcal", "carbsG", "sugarsG", "addedSugarsG", "proteinG", "fatG", "saturatedFatG", "transFatG", "fiberG", "sodiumMg"]
export const CONSENSUS_WINDOW = 12
export const MIN_OCR_QUALITY = 45
export const MIN_SUPPORT = 3
export const AGREEMENT_TARGET = 0.85

export type OcrObservation = { id: number; quality: number; draft: OcrNutritionDraft }
export type FieldEvidence<T> = {
  value?: T
  agreement: number
  support: number
  confirmed: boolean
  candidates: Array<{ value: T; support: number; weight: number }>
}
export type OcrConsensus = {
  draft: OcrNutritionDraft
  basis: FieldEvidence<NutritionBasis>
  fields: Record<NutritionKey, FieldEvidence<number>>
  serving: FieldEvidence<ServingUnit>
  ready: boolean
  confirmedCount: number
  requiredCount: number
  observations: OcrObservation[]
}

export function basisKey(basis?: NutritionBasis): string {
  if (!basis) return ""
  const amount = basis.type === "mass" ? basis.grams : basis.ml
  return Number.isFinite(amount) && amount > 0 ? `${basis.type}:${amount}` : ""
}

function isCanonicalPer100(basis?: NutritionBasis): boolean {
  if (!basis) return false
  return basis.type === "mass" ? Math.abs(basis.grams - 100) < 0.001 : Math.abs(basis.ml - 100) < 0.001
}

function vote<T>(items: Array<{ value: T; quality: number }>, key: (value: T) => string): FieldEvidence<T> {
  const groups = new Map<string, { value: T; support: number; weight: number }>()
  for (const item of items) {
    const id = key(item.value)
    const group = groups.get(id) ?? { value: item.value, support: 0, weight: 0 }
    group.support++
    group.weight += item.quality / 100
    groups.set(id, group)
  }
  const candidates = [...groups.values()].sort((a, b) => b.weight - a.weight)
  const winner = candidates[0]
  const total = candidates.reduce((sum, item) => sum + item.weight, 0)
  const agreement = total ? winner.weight / total : 0
  // The latest two readings must support the winner: old votes cannot hide a
  // new contradiction. Values remain revisable, including previously confirmed ones.
  const recentAgree = !!winner && items.slice(-2).every((item) => key(item.value) === key(winner.value))
  return {
    value: winner?.value, agreement, support: winner?.support ?? 0, candidates,
    confirmed: !!winner && winner.support >= MIN_SUPPORT && agreement >= AGREEMENT_TARGET && recentAgree
  }
}

export function combineOcrObservations(input: OcrObservation[]): OcrConsensus {
  const seen = new Set<number>()
  const observations = input.filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  }).slice(-CONSENSUS_WINDOW)
  const usable = observations.filter((item) => Number.isFinite(item.quality) && item.quality >= MIN_OCR_QUALITY && item.quality <= 100)
  const basis = vote(usable.filter((item) => isCanonicalPer100(item.draft.nutritionBasis)).map((item) => ({ value: item.draft.nutritionBasis!, quality: item.quality })), basisKey)
  // A frame with a missing/contradictory basis cannot supply nutrition values.
  // `parseBrazilianNutritionLabel` standardizes serving-basis observations to
  // exactly 100 g/100 ml before they enter this stage, so votes are comparable.
  const matching = usable.filter((item) => isCanonicalPer100(item.draft.nutritionBasis) && basisKey(item.draft.nutritionBasis) === basisKey(basis.value))
  const nutrition: Nutrition = {}
  const fields = {} as Record<NutritionKey, FieldEvidence<number>>
  for (const key of NUTRIENT_KEYS) {
    const values = matching.flatMap((item) => {
      const value = item.draft.nutrition[key]
      return value !== undefined && Number.isFinite(value) && value >= 0 ? [{ value, quality: item.quality }] : []
    })
    fields[key] = vote(values, String)
    if (fields[key].value !== undefined) nutrition[key] = fields[key].value
  }
  const serving = vote(matching.flatMap((item) => item.draft.servingUnits.slice(0, 1).map((value) => ({ value, quality: item.quality }))), (unit) => JSON.stringify([unit.quantity, unit.grams, unit.ml, unit.plural.toLowerCase()]))
  const constraints = consistencyWarnings(nutrition, basis.value)

  // Product contract: Brazilian scans stop when the standardized per-100 basis
  // and the ten mandatory nutritional fields agree. Household serving text is
  // useful metadata, but RDC 429/2020's per-100 declaration is the stable
  // comparison/logging basis TrackFood needs, so a hard-to-read parenthetical
  // serving measure must not keep the camera running after nutrition is done.
  // https://bvsms.saude.gov.br/bvs/saudelegis/anvisa/2020/RDC_429_2020_.pdf
  const requiredCount = 1 + NUTRIENT_KEYS.length
  const confirmedCount = Number(basis.confirmed) + NUTRIENT_KEYS.filter((key) => fields[key].confirmed).length
  const latest = observations[observations.length - 1]
  const latestMatches = latest && usable.includes(latest) && basisKey(latest.draft.nutritionBasis) === basisKey(basis.value)
  const ready = !!latestMatches && isCanonicalPer100(basis.value) && matching.length >= 4 && confirmedCount === requiredCount && constraints.length === 0
  const warnings = [...constraints]
  if (!basis.confirmed) warnings.push("Base obrigatória de 100 g/100 ml ainda não confirmada entre imagens.")
  if (!ready) warnings.push("Leitura parcial: confira os campos pendentes antes de salvar.")
  const latestMatching = matching[matching.length - 1]
  if (/por[cç][aã]o/i.test(latestMatching?.draft.text ?? "") && !serving.confirmed) warnings.push("Medida caseira da porção não confirmada; os valores por 100 g/100 ml podem ser confirmados mesmo assim.")
  const standardization = matching.some((item) => item.draft.standardization === "scaled-to-100") ? "scaled-to-100" : matching.length ? "direct-100" : "unknown"
  return {
    basis, fields, serving, ready, confirmedCount, requiredCount, observations,
    draft: {
      confidence: ready ? "high" : Object.keys(nutrition).length >= 3 ? "medium" : "low",
      // Composite values have multiple sources; keep their original texts separate.
      text: matching.map((item) => `--- Frame ${item.id} ---\n${item.draft.text}`).join("\n\n"),
      nutritionBasis: basis.value, nutrition, servingUnits: serving.value ? [serving.value] : [], warnings, standardization
    }
  }
}

function consistencyWarnings(n: Nutrition, basis?: NutritionBasis): string[] {
  const warnings: string[] = []
  const check = (part: number | undefined, whole: number | undefined, label: string) => {
    if (part !== undefined && whole !== undefined && part > whole + 0.5) warnings.push(`${label}: valores incompatíveis; continue lendo ou revise.`)
  }
  check(n.addedSugarsG, n.sugarsG, "Açúcares adicionados/totais")
  check(n.sugarsG, n.carbsG, "Açúcares/carboidratos")
  check(n.saturatedFatG, n.fatG, "Gorduras saturadas/totais")
  check(n.transFatG, n.fatG, "Gorduras trans/totais")
  if (basis?.type === "mass") {
    for (const key of NUTRIENT_KEYS.filter((key) => key.endsWith("G"))) check(n[key], basis.grams, key)
    check(n.sodiumMg === undefined ? undefined : n.sodiumMg / 1000, basis.grams, "Sódio/base")
  }
  return warnings
}
