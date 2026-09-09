import type { Nutrition, NutritionBasis, NutritionKey } from "./types"

export type PlausibleRange = { min: number; max: number }
export type CandidateAssessment = {
  allowed: boolean
  range: PlausibleRange
  reasons: string[]
}

const MASS_ROUNDING_SLACK_G = 2.1
const RELATION_SLACK_G = 0.6

/**
 * Deterministic plausibility constraints for OCR candidates.
 *
 * These rules intentionally use physiology / label mathematics before any
 * empirical "most foods look like X" prior. A category-free statistical prior
 * can incorrectly penalize perfectly valid edge foods such as oil, salt or
 * sugar. We only want a value to disappear automatically when it conflicts
 * with the physical 100 g mass budget, regulated subset relationships, or a
 * confirmed energy value.
 *
 * Regulatory/scientific basis:
 * - RDC 429/2020 requires energy to be calculated from declared rounded
 *   nutrients and defines the nutrition quantities on a 100 g / 100 ml basis:
 *   https://bvsms.saude.gov.br/bvs/saudelegis/anvisa/2020/RDC_429_2020_.pdf
 * - ANVISA's Q&A clarifies that dietary fiber is outside total carbohydrate,
 *   so carbohydrate + protein + fat + fiber are non-overlapping mass buckets
 *   for the mass-budget check:
 *   https://www.gov.br/anvisa/pt-br/centraisdeconteudo/publicacoes/alimentos/perguntas-e-respostas-arquivos/rotulagem-nutricional_2a-edicao.pdf
 * - IN 75/2020 Annex XXII gives the energy factors (4 kcal/g protein,
 *   9 kcal/g fat, carbohydrate/polyol factors, etc.):
 *   https://bvsms.saude.gov.br/bvs/saudelegis/anvisa/2020/IN%2075_2020_.pdf
 * - USDA FoodData Central independently uses Atwater 4/9/4 factors for its
 *   general metabolizable-energy calculation:
 *   https://fdc.nal.usda.gov/faq/
 *
 * The deliberately generous slacks below account for the label rounding rules
 * and avoid turning a plausibility filter into a nutrition calculator.
 */

function maxForBasis(key: NutritionKey, basis?: NutritionBasis): number {
  if (!basis) return Number.POSITIVE_INFINITY
  if (basis.type === "mass") {
    if (key === "kcal") return 1000
    if (key === "sodiumMg") return 100_000
    return 100 + MASS_ROUNDING_SLACK_G
  }
  // A 100 ml serving is a volume, not a 100 g mass budget. Dense syrups and
  // concentrates can exceed 100 g of material per 100 ml, so use only a very
  // conservative impossibility ceiling until density is known.
  if (key === "kcal") return 1800
  if (key === "sodiumMg") return 200_000
  return 200
}

function nonOverlappingMass(n: Nutrition, except?: NutritionKey): number {
  const keys: NutritionKey[] = ["carbsG", "proteinG", "fatG", "fiberG"]
  return keys.reduce((sum, key) => key === except ? sum : sum + (n[key] ?? 0), 0)
}

function minimumEnergyKcal(n: Nutrition): number {
  // Total carbohydrate can include polyols with lower factors, so using 4 kcal
  // for all carbohydrate would be an unsafe hard lower bound. Sugars, however,
  // are non-polyol mono/disaccharides and contribute 4 kcal/g. Protein and fat
  // have fixed 4 and 9 kcal/g factors. If total fat is missing, saturated/trans
  // fat still establish a minimum amount of energetic fat.
  const sugarFloor = n.sugarsG ?? n.addedSugarsG ?? 0
  const fatFloor = n.fatG ?? ((n.saturatedFatG ?? 0) + (n.transFatG ?? 0))
  return sugarFloor * 4 + (n.proteinG ?? 0) * 4 + fatFloor * 9
}

function energySlack(kcal: number): number {
  // RDC 429/2020 art. 33 uses a 20% regulatory tolerance for several declared
  // nutrients. That rule concerns enforcement rather than OCR, but 20% plus a
  // small absolute floor is a suitably conservative guardrail for rejecting an
  // impossible candidate from rounded label values.
  return Math.max(5, Math.abs(kcal) * 0.2)
}

export function plausibleRangeForNutrient(key: NutritionKey, confirmed: Nutrition, basis?: NutritionBasis): PlausibleRange {
  let min = 0
  let max = maxForBasis(key, basis)

  if (basis?.type === "mass" && ["carbsG", "proteinG", "fatG", "fiberG"].includes(key)) {
    max = Math.min(max, Math.max(0, basis.grams + MASS_ROUNDING_SLACK_G - nonOverlappingMass(confirmed, key)))
  }

  if (key === "carbsG") min = Math.max(min, confirmed.sugarsG ?? 0, confirmed.addedSugarsG ?? 0)
  if (key === "sugarsG") {
    min = Math.max(min, confirmed.addedSugarsG ?? 0)
    if (confirmed.carbsG !== undefined) max = Math.min(max, confirmed.carbsG + RELATION_SLACK_G)
  }
  if (key === "addedSugarsG") {
    if (confirmed.sugarsG !== undefined) max = Math.min(max, confirmed.sugarsG + RELATION_SLACK_G)
    if (confirmed.carbsG !== undefined) max = Math.min(max, confirmed.carbsG + RELATION_SLACK_G)
  }
  if (key === "fatG") {
    min = Math.max(min, (confirmed.saturatedFatG ?? 0) + (confirmed.transFatG ?? 0))
  }
  if (key === "saturatedFatG" && confirmed.fatG !== undefined) {
    max = Math.min(max, Math.max(0, confirmed.fatG - (confirmed.transFatG ?? 0) + RELATION_SLACK_G))
  }
  if (key === "transFatG" && confirmed.fatG !== undefined) {
    max = Math.min(max, Math.max(0, confirmed.fatG - (confirmed.saturatedFatG ?? 0) + RELATION_SLACK_G))
  }

  return { min, max: Math.max(min, max) }
}

export function assessNutrientCandidate(key: NutritionKey, value: number, confirmed: Nutrition, basis?: NutritionBasis): CandidateAssessment {
  const range = plausibleRangeForNutrient(key, confirmed, basis)
  const reasons: string[] = []
  if (!Number.isFinite(value) || value < range.min - RELATION_SLACK_G || value > range.max + RELATION_SLACK_G) {
    reasons.push(`fora da faixa fisicamente compatível ${range.min.toFixed(1)}–${Number.isFinite(range.max) ? range.max.toFixed(1) : "∞"}`)
  }

  const withCandidate: Nutrition = { ...confirmed, [key]: value }
  const kcal = key === "kcal" ? value : confirmed.kcal
  if (kcal !== undefined && Number.isFinite(kcal)) {
    const minimum = minimumEnergyKcal(withCandidate)
    if (minimum > kcal + energySlack(kcal)) {
      reasons.push(`implicaria pelo menos ${Math.round(minimum)} kcal, incompatível com ${Math.round(kcal)} kcal confirmadas`)
    }
  }

  return { allowed: reasons.length === 0, range, reasons }
}

export function nutritionConstraintWarnings(n: Nutrition, basis?: NutritionBasis): string[] {
  const warnings: string[] = []
  for (const [key, value] of Object.entries(n) as Array<[NutritionKey, number | undefined]>) {
    if (value === undefined) continue
    const context = { ...n }
    delete context[key]
    const assessment = assessNutrientCandidate(key, value, context, basis)
    if (!assessment.allowed) warnings.push(`${key}: ${assessment.reasons.join("; ")}.`)
  }
  return [...new Set(warnings)]
}
