import type { WeightEntry } from "./types"

export function sortWeights(entries: WeightEntry[]): WeightEntry[] {
  return [...entries].sort((a, b) => a.date.localeCompare(b.date))
}

export function movingAverage(entries: WeightEntry[], window = 7): Array<WeightEntry & { trendKg: number }> {
  const sorted = sortWeights(entries)
  return sorted.map((entry, index) => {
    const slice = sorted.slice(Math.max(0, index - window + 1), index + 1)
    const trendKg = slice.reduce((sum, item) => sum + item.kg, 0) / slice.length
    return { ...entry, trendKg }
  })
}

export function latestWeight(entries: WeightEntry[]): WeightEntry | undefined {
  const sorted = sortWeights(entries)
  return sorted[sorted.length - 1]
}

export function changeOverDays(entries: WeightEntry[], days: number, today = new Date()): number | undefined {
  const sorted = sortWeights(entries)
  const latest = sorted[sorted.length - 1]
  if (!latest) return undefined
  const cutoff = new Date(today)
  cutoff.setDate(cutoff.getDate() - days)
  const prior = [...sorted].reverse().find((entry) => new Date(`${entry.date}T00:00:00`) <= cutoff)
  return prior ? latest.kg - prior.kg : undefined
}
