export type Nutrition = {
  kcal?: number
  carbsG?: number
  sugarsG?: number
  addedSugarsG?: number
  proteinG?: number
  fatG?: number
  saturatedFatG?: number
  transFatG?: number
  fiberG?: number
  sodiumMg?: number
}

export type NutritionKey = keyof Nutrition

export type NutritionBasis =
  | { type: "mass"; grams: number }
  | { type: "volume"; ml: number }

export type ServingUnit = {
  id: string
  singular: string
  plural: string
  quantity: number
  grams?: number
  ml?: number
}

export type FoodSource = "manual" | "open-food-facts" | "label-ocr"

export type Food = {
  id: string
  name: string
  brand?: string
  barcode?: string
  nutritionBasis: NutritionBasis
  nutrition: Nutrition
  servingUnits: ServingUnit[]
  source: FoodSource
  sourceMetadata?: unknown
  createdAt: string
  updatedAt: string
}

export type MealName = "Café da manhã" | "Almoço" | "Jantar" | "Lanches" | string

export type DiaryEntry = {
  id: string
  date: string
  meal: MealName
  foodId?: string
  foodName: string
  amount: number
  unitId: string
  unitLabel: string
  grams?: number
  ml?: number
  nutritionSnapshot: Nutrition
  createdAt: string
}

export type WeightEntry = {
  id: string
  date: string
  kg: number
  note?: string
}

export type ActivityLevel = "sedentary" | "light" | "moderate" | "active" | "very-active"
export type BiologicalSex = "female" | "male"

export type Profile = {
  currentWeightKg?: number
  goalWeightKg?: number
  heightCm?: number
  birthDate?: string
  age?: number
  sex?: BiologicalSex
  activityLevel: ActivityLevel
  manualTdee?: number
  desiredWeightChangeKgPerWeek?: number
}

export type MacroTargets = {
  kcal: number
  proteinG?: number
  carbsG?: number
  fatG?: number
}

export type ReminderPreference = {
  id: string
  label: string
  time: string
  enabled: boolean
}

export type AppSettings = {
  id: "settings"
  locale: "pt-BR" | "en-US"
  theme: "system" | "light" | "dark"
  mealNames: MealName[]
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6
  calorieTargetMode: "daily" | "weekly"
  dailyCalorieTarget: number
  weeklyCalorieTarget: number
  macroTargets: MacroTargets
  profile: Profile
  reminders: ReminderPreference[]
  updatedAt: string
}

export type BackupV1 = {
  version: 1
  exportedAt: string
  settings: AppSettings
  foods: Food[]
  diaryEntries: DiaryEntry[]
  weightEntries: WeightEntry[]
}
