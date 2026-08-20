import { describe, expect, it } from "vitest"
import { changeOverDays, movingAverage } from "./weight"

describe("weight trend", () => {
  it("calculates moving average and day-window change", () => {
    const entries = [
      { id: "1", date: "2026-08-01", kg: 83 },
      { id: "2", date: "2026-08-10", kg: 82 },
      { id: "3", date: "2026-08-20", kg: 81.5 }
    ]
    const trend = movingAverage(entries, 2)
    expect(trend[trend.length - 1]?.trendKg).toBe(81.75)
    expect(changeOverDays(entries, 7, new Date("2026-08-20T12:00:00"))).toBeCloseTo(-0.5)
  })
})
