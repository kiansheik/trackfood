import { describe, expect, it } from "vitest"
import type { NormalizedQuad, TrackingFrame } from "./labelRegionTracker"
import { trackRegionRobust } from "./robustRegionTracker"

function patternedFrame(width = 96, height = 72): TrackingFrame {
  const gray = new Uint8Array(width * height)
  let seed = 123456789
  for (let i = 0; i < gray.length; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0
    gray[i] = 20 + (seed % 220)
  }
  return { width, height, gray }
}

function translated(frame: TrackingFrame, dx: number, dy: number): TrackingFrame {
  const gray = new Uint8Array(frame.gray.length)
  for (let y = 0; y < frame.height; y++) {
    for (let x = 0; x < frame.width; x++) {
      const nx = x + dx
      const ny = y + dy
      if (nx >= 0 && nx < frame.width && ny >= 0 && ny < frame.height) {
        gray[ny * frame.width + nx] = frame.gray[y * frame.width + x]
      }
    }
  }
  return { width: frame.width, height: frame.height, gray }
}

describe("robust nutrition region tracker", () => {
  it("tracks a textured label through frame-to-frame translation", () => {
    const previous = patternedFrame()
    const next = translated(previous, 4, 3)
    const quad: NormalizedQuad = [
      { x: 0.22, y: 0.22 },
      { x: 0.75, y: 0.22 },
      { x: 0.75, y: 0.78 },
      { x: 0.22, y: 0.78 }
    ]

    const tracked = trackRegionRobust(previous, next, quad)
    expect(tracked).toBeDefined()
    expect(tracked!.confidence).toBeGreaterThan(0.15)
    expect(tracked!.quad[0].x - quad[0].x).toBeCloseTo(4 / 95, 2)
    expect(tracked!.quad[0].y - quad[0].y).toBeCloseTo(3 / 71, 2)
  })

  it("refuses to invent motion on a featureless region", () => {
    const frame: TrackingFrame = { width: 96, height: 72, gray: new Uint8Array(96 * 72).fill(128) }
    const quad: NormalizedQuad = [
      { x: 0.2, y: 0.2 },
      { x: 0.8, y: 0.2 },
      { x: 0.8, y: 0.8 },
      { x: 0.2, y: 0.8 }
    ]
    expect(trackRegionRobust(frame, frame, quad)).toBeUndefined()
  })
})
