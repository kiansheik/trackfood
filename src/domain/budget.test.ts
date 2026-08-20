import { describe, expect, it } from "vitest"
import { daysRemainingIncludingToday, weeklyBudgetSummary } from "./budget"
import { defaultSettings } from "@/db"
import type { DiaryEntry } from "./types"

describe("weekly calorie budget", () => {
  it("uses daily target to produce a weekly target and average available per remaining day", () => {
    const settings = defaultSettings()
    settings.dailyCalorieTarget = 2000
    const entries: DiaryEntry[] = [
      {
        id: "1",
        date: "2026-08-17",
        meal: "Almoço",
        foodName: "A",
        amount: 1,
        unitId: "kcal",
        unitLabel: "kcal",
        nutritionSnapshot: { kcal: 7300 },
        createdAt: "2026-08-17T12:00:00.000Z"
      }
    ]
    const summary = weeklyBudgetSummary(entries, settings, new Date("2026-08-21T10:00:00"))
    expect(summary.target).toBe(14000)
    expect(summary.remaining).toBe(6700)
    expect(summary.remainingDays).toBe(3)
    expect(summary.averageAvailablePerRemainingDay).toBeCloseTo(2233.333333, 5)
  })

  it("counts Sunday as one remaining day in a Monday-start week", () => {
    expect(daysRemainingIncludingToday(new Date("2026-08-23T09:00:00"), 1)).toBe(1)
  })
})
