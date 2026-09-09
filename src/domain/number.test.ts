import { describe, expect, it } from "vitest"
import { parseDecimalInput } from "./number"

describe("numeric input parser", () => {
  it("accepts decimal dots and Brazilian decimal commas", () => {
    expect(parseDecimalInput("4.75")).toBe(4.75)
    expect(parseDecimalInput("4,75")).toBe(4.75)
    expect(parseDecimalInput("0,3")).toBe(0.3)
  })

  it("accepts simple fractions", () => {
    expect(parseDecimalInput("3/4")).toBe(0.75)
    expect(parseDecimalInput("-3/4")).toBe(-0.75)
    expect(parseDecimalInput(" 1 / 8 ")).toBe(0.125)
  })

  it("accepts mixed numbers used on package labels", () => {
    expect(parseDecimalInput("4 3/4")).toBe(4.75)
    expect(parseDecimalInput("4-3/4")).toBe(4.75)
    expect(parseDecimalInput("-4 3/4")).toBe(-4.75)
  })

  it("accepts common unicode vulgar fractions", () => {
    expect(parseDecimalInput("4 ¾")).toBe(4.75)
    expect(parseDecimalInput("½")).toBe(0.5)
  })
})
