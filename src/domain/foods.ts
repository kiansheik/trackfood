import type { Food } from "./types"

export function duplicateFoodDraft(food: Food, idFactory: () => string = () => crypto.randomUUID()): Partial<Food> {
  return {
    name: `${food.name} copy`,
    brand: food.brand,
    barcode: undefined,
    nutritionBasis: { ...food.nutritionBasis },
    nutrition: { ...food.nutrition },
    servingUnits: food.servingUnits.map((unit) => ({
      ...unit,
      id: idFactory()
    })),
    source: "manual",
    sourceMetadata: {
      duplicatedFrom: food.id,
      duplicatedAt: new Date().toISOString()
    }
  }
}
