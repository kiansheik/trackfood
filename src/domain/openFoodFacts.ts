import type { Food, Nutrition, NutritionBasis } from "./types"

type OpenFoodFactsProduct = {
  product_name?: string
  brands?: string
  code?: string
  serving_quantity?: string | number
  serving_quantity_unit?: string
  nutriments?: Record<string, number | string | undefined>
}

export async function lookupOpenFoodFacts(barcode: string): Promise<Partial<Food> | undefined> {
  const response = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json`)
  if (!response.ok) throw new Error("Open Food Facts indisponível.")
  const payload = (await response.json()) as { status?: number; product?: OpenFoodFactsProduct }
  if (payload.status !== 1 || !payload.product) return undefined
  return normalizeOpenFoodFactsProduct(payload.product, barcode)
}

export function normalizeOpenFoodFactsProduct(product: OpenFoodFactsProduct, barcode: string): Partial<Food> {
  const nutriments = product.nutriments ?? {}
  const nutrition: Nutrition = {
    kcal: numberValue(nutriments["energy-kcal_100g"]),
    carbsG: numberValue(nutriments.carbohydrates_100g),
    sugarsG: numberValue(nutriments.sugars_100g),
    addedSugarsG: numberValue(nutriments["added-sugars_100g"]),
    proteinG: numberValue(nutriments.proteins_100g),
    fatG: numberValue(nutriments.fat_100g),
    saturatedFatG: numberValue(nutriments["saturated-fat_100g"]),
    transFatG: numberValue(nutriments["trans-fat_100g"]),
    fiberG: numberValue(nutriments.fiber_100g),
    sodiumMg: sodiumMgFromOff(nutriments)
  }
  const nutritionBasis: NutritionBasis = { type: "mass", grams: 100 }
  return {
    name: product.product_name || `Produto ${barcode}`,
    brand: product.brands,
    barcode,
    nutritionBasis,
    nutrition,
    servingUnits: [],
    source: "open-food-facts",
    sourceMetadata: { provider: "Open Food Facts", rawProduct: product }
  }
}

function numberValue(value: unknown): number | undefined {
  const parsed = typeof value === "string" ? Number(value.replace(",", ".")) : value
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : undefined
}

function sodiumMgFromOff(nutriments: Record<string, number | string | undefined>): number | undefined {
  const sodium100g = numberValue(nutriments.sodium_100g)
  if (sodium100g !== undefined) return sodium100g * 1000
  return numberValue(nutriments["sodium_mg_100g"])
}
