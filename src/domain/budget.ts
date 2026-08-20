import type { AppSettings, DiaryEntry, Nutrition } from "./types"
import { sumNutrition } from "./nutrition"

export function isoDate(date = new Date()): string {
  return date.toISOString().slice(0, 10)
}

export function startOfWeek(date: Date, weekStartsOn: AppSettings["weekStartsOn"]): Date {
  const copy = new Date(date)
  copy.setHours(0, 0, 0, 0)
  const day = copy.getDay()
  const diff = (day - weekStartsOn + 7) % 7
  copy.setDate(copy.getDate() - diff)
  return copy
}

export function addDays(date: Date, days: number): Date {
  const copy = new Date(date)
  copy.setDate(copy.getDate() + days)
  return copy
}

export function dateRangeIncludes(date: string, start: Date, end: Date): boolean {
  const target = new Date(`${date}T00:00:00`)
  return target >= start && target <= end
}

export function weeklyTarget(settings: AppSettings): number {
  return settings.calorieTargetMode === "weekly" ? settings.weeklyCalorieTarget : settings.dailyCalorieTarget * 7
}

export function daysRemainingIncludingToday(today: Date, weekStartsOn: AppSettings["weekStartsOn"]): number {
  const start = startOfWeek(today, weekStartsOn)
  const end = addDays(start, 6)
  const todayStart = new Date(today)
  todayStart.setHours(0, 0, 0, 0)
  return Math.max(1, Math.ceil((end.getTime() - todayStart.getTime()) / 86_400_000) + 1)
}

export function entriesForDate(entries: DiaryEntry[], date: string): DiaryEntry[] {
  return entries.filter((entry) => entry.date === date)
}

export function entriesForWeek(entries: DiaryEntry[], today: Date, weekStartsOn: AppSettings["weekStartsOn"]): DiaryEntry[] {
  const start = startOfWeek(today, weekStartsOn)
  const end = addDays(start, 6)
  return entries.filter((entry) => dateRangeIncludes(entry.date, start, end))
}

export function nutritionForEntries(entries: DiaryEntry[]): Nutrition {
  return sumNutrition(entries.map((entry) => entry.nutritionSnapshot))
}

export function weeklyBudgetSummary(entries: DiaryEntry[], settings: AppSettings, today = new Date()) {
  const weekEntries = entriesForWeek(entries, today, settings.weekStartsOn)
  const consumed = nutritionForEntries(weekEntries).kcal ?? 0
  const target = weeklyTarget(settings)
  const remaining = target - consumed
  const remainingDays = daysRemainingIncludingToday(today, settings.weekStartsOn)
  return {
    target,
    consumed,
    remaining,
    remainingDays,
    averageAvailablePerRemainingDay: remaining / remainingDays,
    weekStart: isoDate(startOfWeek(today, settings.weekStartsOn)),
    weekEnd: isoDate(addDays(startOfWeek(today, settings.weekStartsOn), 6))
  }
}
