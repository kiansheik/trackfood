import type { ActivityLevel, BiologicalSex, Profile } from "./types"

export const activityMultipliers: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  "very-active": 1.9
}

export function ageFromBirthDate(birthDate: string, today = new Date()): number {
  const birth = new Date(`${birthDate}T00:00:00`)
  let age = today.getFullYear() - birth.getFullYear()
  const monthDiff = today.getMonth() - birth.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) age -= 1
  return age
}

export function mifflinStJeorBmr(args: {
  weightKg: number
  heightCm: number
  age: number
  sex: BiologicalSex
}): number {
  const sexOffset = args.sex === "male" ? 5 : -161
  return 10 * args.weightKg + 6.25 * args.heightCm - 5 * args.age + sexOffset
}

export function estimateTdee(profile: Profile, today = new Date()): { bmr?: number; tdee?: number; reason?: string } {
  if (profile.manualTdee) return { tdee: profile.manualTdee, reason: "manual" }
  const age = profile.age ?? (profile.birthDate ? ageFromBirthDate(profile.birthDate, today) : undefined)
  if (!profile.currentWeightKg || !profile.heightCm || !age || !profile.sex) {
    return { reason: "missing-inputs" }
  }
  const bmr = mifflinStJeorBmr({
    weightKg: profile.currentWeightKg,
    heightCm: profile.heightCm,
    age,
    sex: profile.sex
  })
  return { bmr, tdee: bmr * activityMultipliers[profile.activityLevel], reason: "mifflin-st-jeor" }
}
