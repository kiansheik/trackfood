import type { Nutrition, NutritionBasis, NutritionKey, ServingUnit } from "./types"
import type { OcrNutritionDraft } from "./ocr"
import { assessNutrientCandidate, nutritionConstraintWarnings, plausibleRangeForNutrient } from "./nutritionPlausibility"

export const NUTRIENT_KEYS: NutritionKey[] = ["kcal", "carbsG", "sugarsG", "addedSugarsG", "proteinG", "fatG", "saturatedFatG", "transFatG", "fiberG", "sodiumMg"]
export const CONSENSUS_WINDOW = 12
export const MIN_OCR_QUALITY = 45
export const MIN_SUPPORT = 3
export const FAST_MIN_SUPPORT = 2
export const AGREEMENT_TARGET = 0.85

export type OcrObservation = { id: number; quality: number; draft: OcrNutritionDraft }
export type FieldEvidence<T> = {
  value?: T
  agreement: number
  support: number
  confirmed: boolean
  candidates: Array<{ value: T; support: number; weight: number }>
  rejectedCandidates?: Array<{ value: T; support: number; reasons: string[] }>
  plausibleRange?: { min: number; max: number }
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

function vote<T>(items: Array<{ value: T; quality: number }>, key: (value: T) => string, minSupport = MIN_SUPPORT): FieldEvidence<T> {
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
  // The latest two *plausible* readings must support the winner. A physically
  // impossible OCR hallucination (e.g. 23400 g per 100 g) is discarded before
  // this check, while a plausible new contradiction still revokes confirmation.
  const recentAgree = !!winner && items.slice(-2).every((item) => key(item.value) === key(winner.value))
  return {
    value: winner?.value, agreement, support: winner?.support ?? 0, candidates,
    confirmed: !!winner && winner.support >= minSupport && agreement >= AGREEMENT_TARGET && recentAgree
  }
}

function rawValues(matching: OcrObservation[], key: NutritionKey) {
  return matching.flatMap((item) => {
    const value = item.draft.nutrition[key]
    return value !== undefined && Number.isFinite(value) && value >= 0 ? [{ value, quality: item.quality }] : []
  })
}

function confirmedNutrition(fields: Record<NutritionKey, FieldEvidence<number>>, except?: NutritionKey): Nutrition {
  const nutrition: Nutrition = {}
  for (const key of NUTRIENT_KEYS) {
    if (key === except) continue
    const field = fields[key]
    if (field?.confirmed && field.value !== undefined) nutrition[key] = field.value
  }
  return nutrition
}

function rejectedGroups(items: Array<{ value: number; reasons: string[] }>) {
  const groups = new Map<string, { value: number; support: number; reasons: Set<string> }>()
  for (const item of items) {
    const id = String(item.value)
    const group = groups.get(id) ?? { value: item.value, support: 0, reasons: new Set<string>() }
    group.support++
    item.reasons.forEach((reason) => group.reasons.add(reason))
    groups.set(id, group)
  }
  return [...groups.values()].map((group) => ({ value: group.value, support: group.support, reasons: [...group.reasons] }))
}

/**
 * Re-score nutrient votes against values that are already confirmed.
 *
 * This is deliberately iterative: once carbohydrate/protein/fat/fiber become
 * stable, their 100 g mass budget can make an OCR outlier for the last field
 * impossible. Likewise confirmed sugars/fat/energy narrow subset fields. We do
 * not manufacture a missing number; constraints only remove impossible
 * candidates and can reduce the repeat requirement from 3 to 2 when the rest
 * of the label supplies strong independent context.
 */
function constrainedFields(matching: OcrObservation[], basis?: NutritionBasis): Record<NutritionKey, FieldEvidence<number>> {
  let fields = {} as Record<NutritionKey, FieldEvidence<number>>
  for (const key of NUTRIENT_KEYS) fields[key] = vote(rawValues(matching, key), String)

  for (let pass = 0; pass < 3; pass++) {
    const trustedCount = NUTRIENT_KEYS.filter((key) => fields[key]?.confirmed).length
    const next = {} as Record<NutritionKey, FieldEvidence<number>>
    for (const key of NUTRIENT_KEYS) {
      const context = confirmedNutrition(fields, key)
      const accepted: Array<{ value: number; quality: number }> = []
      const rejected: Array<{ value: number; reasons: string[] }> = []
      for (const item of rawValues(matching, key)) {
        const assessment = assessNutrientCandidate(key, item.value, context, basis)
        if (assessment.allowed) accepted.push(item)
        else rejected.push({ value: item.value, reasons: assessment.reasons })
      }
      const rejectedCandidates = rejectedGroups(rejected)
      // Two independent readings can settle a field when a competing OCR value
      // was ruled out physically, or when most of the rest of the label is
      // already confirmed. Full automatic completion still requires >=3 good
      // camera observations below, so no scan can finish from only two images.
      const minSupport = rejectedCandidates.length > 0 || trustedCount >= 7 ? FAST_MIN_SUPPORT : MIN_SUPPORT
      const evidence = vote(accepted, String, minSupport)
      evidence.rejectedCandidates = rejectedCandidates
      evidence.plausibleRange = plausibleRangeForNutrient(key, context, basis)
      next[key] = evidence
    }
    fields = next
  }
  return fields
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
  const fields = constrainedFields(matching, basis.value)
  const nutrition: Nutrition = {}
  for (const key of NUTRIENT_KEYS) if (fields[key].value !== undefined) nutrition[key] = fields[key].value

  const serving = vote(matching.flatMap((item) => item.draft.servingUnits.slice(0, 1).map((value) => ({ value, quality: item.quality }))), (unit) => JSON.stringify([unit.quantity, unit.grams, unit.ml, unit.plural.toLowerCase()]))
  const constraints = nutritionConstraintWarnings(nutrition, basis.value)
  const rejectedWarnings = NUTRIENT_KEYS.flatMap((key) => (fields[key].rejectedCandidates ?? []).map((candidate) =>
    `${key}: OCR descartou ${candidate.value} como incompatível (${candidate.reasons.join("; ")}).`))

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

  // Three independent, high-quality, fully consistent observations are enough
  // to stop. This removes one expensive PP-OCR pass from the clean path. Lower
  // quality or unresolved/contradictory scans retain the older four-frame floor.
  const averageQuality = matching.length ? matching.reduce((sum, item) => sum + item.quality, 0) / matching.length : 0
  const cleanHighQuality = averageQuality >= 80 && NUTRIENT_KEYS.every((key) => fields[key].confirmed && fields[key].candidates.length === 1) && constraints.length === 0
  const minimumCompleteFrames = cleanHighQuality ? 3 : 4
  const ready = !!latestMatches && isCanonicalPer100(basis.value) && matching.length >= minimumCompleteFrames && confirmedCount === requiredCount && constraints.length === 0

  const warnings = [...constraints, ...rejectedWarnings]
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
