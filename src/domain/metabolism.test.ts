import { describe, expect, it } from "vitest"
import { ageFromBirthDate, estimateTdee, mifflinStJeorBmr } from "./metabolism"

describe("metabolism estimates", () => {
  it("calculates age from birth date", () => {
    expect(ageFromBirthDate("1990-08-21", new Date("2026-08-20T12:00:00"))).toBe(35)
    expect(ageFromBirthDate("1990-08-20", new Date("2026-08-20T12:00:00"))).toBe(36)
  })

  it("keeps Mifflin-St Jeor isolated and testable", () => {
    expect(mifflinStJeorBmr({ weightKg: 82, heightCm: 180, age: 36, sex: "male" })).toBeCloseTo(1770)
  })

  it("uses manual TDEE override when present", () => {
    expect(estimateTdee({ activityLevel: "active", manualTdee: 2400 }).tdee).toBe(2400)
  })
})
