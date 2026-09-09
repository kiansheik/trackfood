import type { Food, Nutrition, NutritionBasis } from "./types"
import type { BarcodeIdentity } from "./barcodeIdentity"

type OpenFoodFactsProduct = {
  product_name?: string
  product_name_pt?: string
  product_name_en?: string
  abbreviated_product_name?: string
  brands?: string
  code?: string
  serving_quantity?: string | number
  serving_quantity_unit?: string
  nutriments?: Record<string, number | string | undefined>
}

type OpenFoodFactsPayload = { status?: number; product?: OpenFoodFactsProduct }

async function fetchOpenFoodFactsProduct(barcode: string): Promise<OpenFoodFactsProduct | undefined> {
  const response = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json`)
  if (!response.ok) throw new Error("Open Food Facts indisponível.")
  const payload = (await response.json()) as OpenFoodFactsPayload
  if (payload.status !== 1 || !payload.product) return undefined
  return payload.product
}

/**
 * Product identity is a separate concern from nutrition provenance.
 *
 * Open Food Facts is often useful for a human-readable name/brand even when
 * the nutrition table is absent, partial, stale or simply wrong for the
 * package in front of the user. Callers that already have label OCR/manual
 * nutrition should therefore use this identity-only lookup and must not merge
 * OFF nutriments over those values.
 */
export async function lookupOpenFoodFactsIdentity(barcode: string): Promise<BarcodeIdentity | undefined> {
  const product = await fetchOpenFoodFactsProduct(barcode)
  if (!product) return undefined
  return normalizeOpenFoodFactsIdentity(product, barcode)
}

export function normalizeOpenFoodFactsIdentity(product: OpenFoodFactsProduct, barcode: string): BarcodeIdentity {
  // Brazil-first UI: prefer an explicit Portuguese product title, then the
  // provider's canonical title. English/abbreviated names are still better
  // than forcing the user to type a product name from scratch.
  const name = firstText(
    product.product_name_pt,
    product.product_name,
    product.product_name_en,
    product.abbreviated_product_name
  )
  return {
    barcode,
    name,
    brand: firstText(product.brands),
    provider: "Open Food Facts"
  }
}

export async function lookupOpenFoodFacts(barcode: string): Promise<Partial<Food> | undefined> {
  const product = await fetchOpenFoodFactsProduct(barcode)
  if (!product) return undefined
  return normalizeOpenFoodFactsProduct(product, barcode)
}

export function normalizeOpenFoodFactsProduct(product: OpenFoodFactsProduct, barcode: string): Partial<Food> {
  const nutriments = product.nutriments ?? {}
  const identity = normalizeOpenFoodFactsIdentity(product, barcode)
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
    // Identity survives even when OFF has zero usable nutrition fields.
    name: identity.name || `Produto ${barcode}`,
    brand: identity.brand,
    barcode,
    nutritionBasis,
    nutrition,
    servingUnits: [],
    source: "open-food-facts",
    sourceMetadata: { provider: "Open Food Facts", rawProduct: product }
  }
}

function firstText(...values: Array<string | undefined>): string | undefined {
  return values.map((value) => value?.trim()).find((value): value is string => !!value)
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
