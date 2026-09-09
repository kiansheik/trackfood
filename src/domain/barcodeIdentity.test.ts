import { describe, expect, it } from "vitest"
import { mergeBarcodeIdentity, withBarcodeIdentityMetadata } from "./barcodeIdentity"
import type { Food } from "./types"

const scannedDraft: Partial<Food> = {
  name: "OCR food",
  nutritionBasis: { type: "mass", grams: 100 },
  nutrition: { kcal: 421, carbsG: 62, sugarsG: 19, proteinG: 8, fatG: 14 },
  servingUnits: [{ id: "u", singular: "unidade", plural: "unidades", quantity: 1, grams: 30 }],
  source: "label-ocr"
}

describe("barcode identity merge", () => {
  it("fills generated identity without overwriting label nutrition", () => {
    const merged = mergeBarcodeIdentity(scannedDraft, {
      barcode: "7891234567890",
      name: "Biscoito Chocolate",
      brand: "Marca Boa",
      provider: "Open Food Facts"
    })

    expect(merged.name).toBe("Biscoito Chocolate")
    expect(merged.brand).toBe("Marca Boa")
    expect(merged.barcode).toBe("7891234567890")
    expect(merged.nutrition).toBe(scannedDraft.nutrition)
    expect(merged.nutritionBasis).toBe(scannedDraft.nutritionBasis)
    expect(merged.servingUnits).toBe(scannedDraft.servingUnits)
    expect(merged.source).toBe("label-ocr")
  })

  it("does not overwrite a name or brand the user already chose", () => {
    const merged = mergeBarcodeIdentity({ ...scannedDraft, name: "Meu biscoito", brand: "Minha marca" }, {
      barcode: "789",
      name: "Provider title",
      brand: "Provider brand",
      provider: "Open Food Facts"
    })

    expect(merged.name).toBe("Meu biscoito")
    expect(merged.brand).toBe("Minha marca")
    expect(merged.barcode).toBe("789")
  })

  it("records identity provenance alongside existing OCR metadata", () => {
    expect(withBarcodeIdentityMetadata({ confidence: "high" }, {
      barcode: "789",
      name: "Produto",
      brand: "Marca",
      provider: "Open Food Facts"
    })).toEqual({
      confidence: "high",
      barcodeIdentity: {
        provider: "Open Food Facts",
        barcode: "789",
        name: "Produto",
        brand: "Marca"
      }
    })
  })
})
