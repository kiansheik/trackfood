export function parseDecimalInput(value: string | number | undefined): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined
  if (!value) return undefined
  const normalized = value.trim().replace(/\s+/g, "").replace(",", ".")
  if (!normalized) return undefined
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function requiredDecimal(value: string | number | undefined, field: string): number {
  const parsed = parseDecimalInput(value)
  if (parsed === undefined) throw new Error(`${field} precisa ser um número válido.`)
  return parsed
}

export function roundForDisplay(value: number, digits = 2): number {
  const factor = 10 ** digits
  return Math.round((value + Number.EPSILON) * factor) / factor
}

export function formatNumber(value: number | undefined, locale = "pt-BR", digits = 0): string {
  if (value === undefined || Number.isNaN(value)) return "—"
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  }).format(value)
}
