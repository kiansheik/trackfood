import type { Food } from "./types"

export type BarcodeIdentity = {
  barcode: string
  name?: string
  brand?: string
  provider: string
}

function genericName(name?: string): boolean {
  const value = name?.trim() ?? ""
  return !value || /^ocr food$/i.test(value) || /^produto\s+\d+$/i.test(value) || /^food$/i.test(value)
}

/**
 * Merge barcode identity without touching nutrition.
 *
 * Provider identity is allowed to replace an empty/generated placeholder, but
 * never a name/brand the user already chose. Most importantly, nutrition,
 * basis and serving units are passed through unchanged. This makes a barcode
 * useful after label OCR without allowing a partial/stale barcode database to
 * overwrite the package values the user just scanned.
 */
export function mergeBarcodeIdentity(draft: Partial<Food>, identity: BarcodeIdentity): Partial<Food> {
  return {
    ...draft,
    barcode: identity.barcode,
    name: identity.name && genericName(draft.name) ? identity.name : draft.name,
    brand: identity.brand && !draft.brand?.trim() ? identity.brand : draft.brand
  }
}

export function withBarcodeIdentityMetadata(metadata: unknown, identity?: BarcodeIdentity): unknown {
  if (!identity) return metadata
  const existing = metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? metadata as Record<string, unknown>
    : {}
  return {
    ...existing,
    barcodeIdentity: {
      provider: identity.provider,
      barcode: identity.barcode,
      name: identity.name,
      brand: identity.brand
    }
  }
}
