import { defineStore } from "pinia"
import { computed, ref } from "vue"
import { db, defaultSettings } from "@/db"
import { buildBackup, validateBackup } from "@/domain/backup"
import { isoDate } from "@/domain/budget"
import { buildDiarySnapshot, quickCaloriesEntry } from "@/domain/nutrition"
import type { AppSettings, BackupV1, DiaryEntry, Food, WeightEntry } from "@/domain/types"

export const useAppStore = defineStore("app", () => {
  const ready = ref(false)
  const foods = ref<Food[]>([])
  const diaryEntries = ref<DiaryEntry[]>([])
  const weightEntries = ref<WeightEntry[]>([])
  const settings = ref<AppSettings>(defaultSettings())
  const lastError = ref<string | undefined>()

  const recentFoods = computed(() => {
    const seen = new Set<string>()
    return [...diaryEntries.value]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .filter((entry) => {
        if (!entry.foodId || seen.has(entry.foodId)) return false
        seen.add(entry.foodId)
        return true
      })
      .slice(0, 8)
      .map((entry) => foods.value.find((food) => food.id === entry.foodId))
      .filter(Boolean) as Food[]
  })

  const frequentFoods = computed(() => {
    const counts = new Map<string, number>()
    for (const entry of diaryEntries.value) {
      if (entry.foodId) counts.set(entry.foodId, (counts.get(entry.foodId) ?? 0) + 1)
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([id]) => foods.value.find((food) => food.id === id))
      .filter(Boolean) as Food[]
  })

  async function load() {
    const persisted = await db.settings.get("settings")
    if (!persisted) await db.settings.put(forStorage(settings.value))
    else settings.value = persisted
    foods.value = await db.foods.orderBy("name").toArray()
    diaryEntries.value = await db.diaryEntries.orderBy("date").toArray()
    weightEntries.value = await db.weightEntries.orderBy("date").toArray()
    ready.value = true
    void requestPersistentStorage()
  }

  async function requestPersistentStorage() {
    if ("storage" in navigator && "persist" in navigator.storage) {
      try {
        await navigator.storage.persist()
      } catch {
        // The app remains local-first without persistent storage grants.
      }
    }
  }

  async function saveFood(food: Food) {
    const now = new Date().toISOString()
    const saved = { ...food, updatedAt: now, createdAt: food.createdAt || now }
    await db.foods.put(forStorage(saved))
    foods.value = await db.foods.orderBy("name").toArray()
  }

  async function deleteFood(id: string) {
    await db.foods.delete(id)
    foods.value = await db.foods.orderBy("name").toArray()
  }

  async function saveSettings(next: AppSettings) {
    const saved = { ...next, updatedAt: new Date().toISOString() }
    await db.settings.put(forStorage(saved))
    settings.value = saved
  }

  async function logFood(args: { food: Food; date: string; meal: string; amount: number; unitId: string }) {
    const now = new Date().toISOString()
    const entry = buildDiarySnapshot({
      id: crypto.randomUUID(),
      date: args.date,
      meal: args.meal,
      food: args.food,
      amount: args.amount,
      unitId: args.unitId,
      createdAt: now
    })
    await db.diaryEntries.add(forStorage(entry))
    diaryEntries.value = await db.diaryEntries.orderBy("date").toArray()
  }

  async function logQuickCalories(args: { date: string; meal: string; label: string; kcal: number }) {
    const now = new Date().toISOString()
    const entry = quickCaloriesEntry({
      id: crypto.randomUUID(),
      date: args.date,
      meal: args.meal,
      label: args.label,
      kcal: args.kcal,
      createdAt: now
    })
    await db.diaryEntries.add(forStorage(entry))
    diaryEntries.value = await db.diaryEntries.orderBy("date").toArray()
  }

  async function deleteDiaryEntry(id: string) {
    await db.diaryEntries.delete(id)
    diaryEntries.value = await db.diaryEntries.orderBy("date").toArray()
  }

  async function saveWeight(entry: Omit<WeightEntry, "id"> & { id?: string }) {
    const saved = { ...entry, id: entry.id ?? crypto.randomUUID() }
    await db.weightEntries.put(forStorage(saved))
    weightEntries.value = await db.weightEntries.orderBy("date").toArray()
    if (saved.date === isoDate()) {
      settings.value.profile.currentWeightKg = saved.kg
      await saveSettings(settings.value)
    }
  }

  async function exportBackup(): Promise<BackupV1> {
    return buildBackup({
      settings: settings.value,
      foods: await db.foods.toArray(),
      diaryEntries: await db.diaryEntries.toArray(),
      weightEntries: await db.weightEntries.toArray()
    })
  }

  async function importBackup(payload: unknown) {
    const backup = validateBackup(payload)
    await db.transaction("rw", db.settings, db.foods, db.diaryEntries, db.weightEntries, async () => {
      await db.settings.clear()
      await db.foods.clear()
      await db.diaryEntries.clear()
      await db.weightEntries.clear()
      await db.settings.put(forStorage(backup.settings))
      await db.foods.bulkPut(forStorage(backup.foods))
      await db.diaryEntries.bulkPut(forStorage(backup.diaryEntries))
      await db.weightEntries.bulkPut(forStorage(backup.weightEntries))
    })
    await load()
  }

  async function eraseAllData() {
    const fresh = defaultSettings()
    await db.transaction("rw", db.settings, db.foods, db.diaryEntries, db.weightEntries, async () => {
      await db.foods.clear()
      await db.diaryEntries.clear()
      await db.weightEntries.clear()
      await db.settings.clear()
      await db.settings.put(forStorage(fresh))
    })
    await load()
  }

  function foodByBarcode(barcode: string): Food | undefined {
    return foods.value.find((food) => food.barcode === barcode)
  }

  return {
    ready,
    foods,
    diaryEntries,
    weightEntries,
    settings,
    lastError,
    recentFoods,
    frequentFoods,
    load,
    saveFood,
    deleteFood,
    saveSettings,
    logFood,
    logQuickCalories,
    deleteDiaryEntry,
    saveWeight,
    exportBackup,
    importBackup,
    eraseAllData,
    foodByBarcode
  }
})

function forStorage<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
