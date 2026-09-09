import { describe, expect, it } from "vitest"
import { layoutFromTextDetections } from "./nativeLabelReader"

describe("native OCR layout normalization", () => {
  it("preserves platform TextDetector corner geometry for the existing nutrition parser", () => {
    const layout = layoutFromTextDetections([
      {
        rawValue: "Valor energético 192 kcal",
        boundingBox: { left: 100, top: 80, right: 780, bottom: 130 },
        cornerPoints: [
          { x: 105, y: 76 },
          { x: 785, y: 92 },
          { x: 778, y: 136 },
          { x: 98, y: 120 }
        ]
      },
      {
        rawValue: "Açúcares totais 0 g",
        boundingBox: { left: 120, top: 170, right: 760, bottom: 220 }
      }
    ], 1000, 600)

    expect(layout.width).toBe(1000)
    expect(layout.height).toBe(600)
    expect(layout.items).toHaveLength(2)
    expect(layout.items[0].text).toContain("Valor energético")
    expect(layout.items[0].poly).toEqual([[105, 76], [785, 92], [778, 136], [98, 120]])
    expect(layout.items[1].poly).toEqual([[120, 170], [760, 170], [760, 220], [120, 220]])
    expect(layout.items.every((item) => item.score === 0.92)).toBe(true)
  })
})
