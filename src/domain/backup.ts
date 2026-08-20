import type { AppSettings, BackupV1, DiaryEntry, Food, WeightEntry } from "./types"

export function buildBackup(args: {
  settings: AppSettings
  foods: Food[]
  diaryEntries: DiaryEntry[]
  weightEntries: WeightEntry[]
}): BackupV1 {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: args.settings,
    foods: args.foods,
    diaryEntries: args.diaryEntries,
    weightEntries: args.weightEntries
  }
}

export function validateBackup(input: unknown): BackupV1 {
  if (!input || typeof input !== "object") throw new Error("Backup inválido.")
  const backup = input as Partial<BackupV1>
  if (backup.version !== 1) throw new Error("Versão de backup não suportada.")
  if (!backup.settings || backup.settings.id !== "settings") throw new Error("Backup sem configurações válidas.")
  if (!Array.isArray(backup.foods) || !Array.isArray(backup.diaryEntries) || !Array.isArray(backup.weightEntries)) {
    throw new Error("Backup incompleto.")
  }
  for (const food of backup.foods) {
    if (!food.id || !food.name || !food.nutritionBasis || !food.nutrition) throw new Error("Backup contém alimento inválido.")
  }
  return backup as BackupV1
}
