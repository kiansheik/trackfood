import Dexie, { type Table } from "dexie"
import type { AppSettings, DiaryEntry, Food, WeightEntry } from "./domain/types"

export class TrackFoodDatabase extends Dexie {
  foods!: Table<Food, string>
  diaryEntries!: Table<DiaryEntry, string>
  weightEntries!: Table<WeightEntry, string>
  settings!: Table<AppSettings, string>

  constructor() {
    super("trackfood")
    this.version(1).stores({
      foods: "id, &barcode, name, brand, updatedAt",
      diaryEntries: "id, date, meal, foodId, createdAt",
      weightEntries: "id, date",
      settings: "id"
    })
  }
}

export const db = new TrackFoodDatabase()

export function defaultSettings(): AppSettings {
  const now = new Date().toISOString()
  return {
    id: "settings",
    locale: "pt-BR",
    theme: "system",
    mealNames: ["Café da manhã", "Almoço", "Jantar", "Lanches"],
    weekStartsOn: 1,
    calorieTargetMode: "daily",
    dailyCalorieTarget: 2000,
    weeklyCalorieTarget: 14000,
    macroTargets: {
      kcal: 2000,
      proteinG: 130,
      carbsG: 220,
      fatG: 70
    },
    profile: {
      activityLevel: "moderate"
    },
    reminders: [
      { id: "breakfast", label: "Log breakfast", time: "08:00", enabled: false },
      { id: "lunch", label: "Log lunch", time: "12:30", enabled: false },
      { id: "dinner", label: "Log dinner", time: "19:30", enabled: false },
      { id: "weight", label: "Log today's weight", time: "07:30", enabled: false }
    ],
    updatedAt: now
  }
}
