import type { DiaryEntry, Food, Nutrition, NutritionKey, ServingUnit } from "./types"

export const nutritionKeys: NutritionKey[] = [
  "kcal",
  "carbsG",
  "sugarsG",
  "addedSugarsG",
  "proteinG",
  "fatG",
  "saturatedFatG",
  "transFatG",
  "fiberG",
  "sodiumMg"
]

export const nutritionLabels: Record<NutritionKey, string> = {
  kcal: "Calorias",
  carbsG: "Carboidratos",
  sugarsG: "Açúcares",
  addedSugarsG: "Açúcares adicionados",
  proteinG: "Proteínas",
  fatG: "Gorduras totais",
  saturatedFatG: "Gorduras saturadas",
  transFatG: "Gorduras trans",
  fiberG: "Fibra",
  sodiumMg: "Sódio"
}

export function scaleNutrition(nutrition: Nutrition, factor: number): Nutrition {
  const scaled: Nutrition = {}
  for (const key of nutritionKeys) {
    const value = nutrition[key]
    if (value !== undefined) scaled[key] = value * factor
  }
  return scaled
}

export function sumNutrition(items: Nutrition[]): Nutrition {
  const total: Nutrition = {}
  for (const item of items) {
    for (const key of nutritionKeys) {
      const value = item[key]
      if (value !== undefined) total[key] = (total[key] ?? 0) + value
    }
  }
  return total
}

export function gramsPerUnit(unit: ServingUnit): number | undefined {
  if (unit.grams === undefined) return undefined
  return unit.grams / unit.quantity
}

export function mlPerUnit(unit: ServingUnit): number | undefined {
  if (unit.ml === undefined) return undefined
  return unit.ml / unit.quantity
}

export function unitLabel(unit: ServingUnit, amount: number): string {
  return Math.abs(amount) === 1 ? unit.singular : unit.plural
}

export function availableUnits(food: Food): Array<{ id: string; label: string }> {
  const base = food.nutritionBasis.type === "mass" ? [{ id: "g", label: "g" }] : [{ id: "ml", label: "ml" }]
  return [...base, ...food.servingUnits.map((unit) => ({ id: unit.id, label: unit.plural }))]
}

export function resolvePortion(food: Food, amount: number, unitId: string): { grams?: number; ml?: number; label: string } {
  if (food.nutritionBasis.type === "mass" && unitId === "g") return { grams: amount, label: "g" }
  if (food.nutritionBasis.type === "volume" && unitId === "ml") return { ml: amount, label: "ml" }

  const unit = food.servingUnits.find((candidate) => candidate.id === unitId)
  if (!unit) throw new Error("Unidade não encontrada para este alimento.")
  if (unit.grams !== undefined) return { grams: amount * (unit.grams / unit.quantity), label: unitLabel(unit, amount) }
  if (unit.ml !== undefined) return { ml: amount * (unit.ml / unit.quantity), label: unitLabel(unit, amount) }
  throw new Error("A unidade precisa ter uma relação com gramas ou mililitros.")
}

export function nutritionForPortion(food: Food, amount: number, unitId: string): { nutrition: Nutrition; grams?: number; ml?: number; unitLabel: string } {
  const portion = resolvePortion(food, amount, unitId)
  const basisAmount = food.nutritionBasis.type === "mass" ? food.nutritionBasis.grams : food.nutritionBasis.ml
  const consumedAmount = food.nutritionBasis.type === "mass" ? portion.grams : portion.ml
  if (consumedAmount === undefined) throw new Error("A porção informada não combina com a base nutricional do alimento.")
  return {
    nutrition: scaleNutrition(food.nutrition, consumedAmount / basisAmount),
    grams: portion.grams,
    ml: portion.ml,
    unitLabel: portion.label
  }
}

export function buildDiarySnapshot(args: {
  id: string
  date: string
  meal: string
  food: Food
  amount: number
  unitId: string
  createdAt: string
}): DiaryEntry {
  const result = nutritionForPortion(args.food, args.amount, args.unitId)
  return {
    id: args.id,
    date: args.date,
    meal: args.meal,
    foodId: args.food.id,
    foodName: args.food.name,
    amount: args.amount,
    unitId: args.unitId,
    unitLabel: result.unitLabel,
    grams: result.grams,
    ml: result.ml,
    nutritionSnapshot: result.nutrition,
    createdAt: args.createdAt
  }
}

export function quickCaloriesEntry(args: {
  id: string
  date: string
  meal: string
  label: string
  kcal: number
  createdAt: string
}): DiaryEntry {
  return {
    id: args.id,
    date: args.date,
    meal: args.meal,
    foodName: args.label,
    amount: args.kcal,
    unitId: "kcal",
    unitLabel: "kcal",
    nutritionSnapshot: { kcal: args.kcal },
    createdAt: args.createdAt
  }
}
