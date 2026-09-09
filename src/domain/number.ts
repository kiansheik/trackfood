export function parseDecimalInput(value: string | number | undefined): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined
  if (!value) return undefined
  const normalized = expandVulgarFractions(value.trim())
  if (!normalized) return undefined

  const mixedFraction = normalized.match(/^([+-]?\d+)(?:\s+|-)(\d+)\s*\/\s*(\d+)$/)
  if (mixedFraction) {
    const whole = Number(mixedFraction[1])
    const numerator = Number(mixedFraction[2])
    const denominator = Number(mixedFraction[3])
    if (denominator === 0) return undefined
    const sign = whole < 0 || mixedFraction[1].startsWith("-") ? -1 : 1
    return sign * (Math.abs(whole) + numerator / denominator)
  }

  const fraction = normalized.match(/^([+-]?\d+)\s*\/\s*(\d+)$/)
  if (fraction) {
    const numerator = Number(fraction[1])
    const denominator = Number(fraction[2])
    return denominator === 0 ? undefined : numerator / denominator
  }

  const parsed = Number(normalized.replace(/\s+/g, "").replace(",", "."))
  return Number.isFinite(parsed) ? parsed : undefined
}

const vulgarFractions: Record<string, string> = {
  "¼": "1/4",
  "½": "1/2",
  "¾": "3/4",
  "⅐": "1/7",
  "⅑": "1/9",
  "⅒": "1/10",
  "⅓": "1/3",
  "⅔": "2/3",
  "⅕": "1/5",
  "⅖": "2/5",
  "⅗": "3/5",
  "⅘": "4/5",
  "⅙": "1/6",
  "⅚": "5/6",
  "⅛": "1/8",
  "⅜": "3/8",
  "⅝": "5/8",
  "⅞": "7/8"
}

function expandVulgarFractions(value: string): string {
  let expanded = value
  for (const [symbol, fraction] of Object.entries(vulgarFractions)) {
    expanded = expanded.split(symbol).join(` ${fraction}`)
  }
  return expanded.trim()
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
