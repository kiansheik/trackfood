import { foldOcrText, matchNutrientLabel, type OcrLayout } from "@/domain/ocrLayout"

export type NormalizedPoint = { x: number; y: number }
export type NormalizedQuad = [NormalizedPoint, NormalizedPoint, NormalizedPoint, NormalizedPoint]
export type TrackingFrame = { width: number; height: number; gray: Uint8Array }

export type TrackedRegion = {
  quad: NormalizedQuad
  confidence: number
  source: "candidate" | "ocr" | "flow"
}

/**
 * The live region tracker deliberately separates expensive semantic OCR from
 * cheap visual motion tracking.
 *
 * Methodology:
 * - Sparse optical flow tracks local image structure between adjacent video
 *   frames. OpenCV's Lucas-Kanade tutorial describes tracking strong local
 *   features through an image pyramid rather than re-detecting the object on
 *   every frame: https://docs.opencv.org/4.x/d4/dee/tutorial_optical_flow.html
 * - A transform estimated from tracked points can move an object's corners as
 *   translation, rotation, scale and shear change. OpenCV documents the same
 *   detect/match -> transform -> perspective-corner pattern for planar object
 *   tracking: https://docs.opencv.org/4.x/d7/dff/tutorial_feature_homography.html
 * - Document scanners expose detected edges/crops in the viewfinder so users
 *   can understand what the scanner sees before capture. Google ML Kit lists
 *   automatic document detection, accurate edge detection and auto-rotation as
 *   core scanner behavior: https://developers.google.com/ml-kit/vision/doc-scanner
 *
 * TrackFood uses a deliberately tiny browser implementation instead of adding
 * OpenCV.js to the PWA: 96x72 grayscale frames, sparse patch flow, and a least-
 * squares affine transform. Affine motion covers the short-interval translation,
 * rotation, scale and shear we need between PP-OCR refreshes. PP-OCR polygons
 * periodically re-anchor the quad, so this tracker is never nutrition evidence
 * and is not trusted indefinitely through occlusion or large perspective jumps.
 */

const TRACK_WIDTH = 96
const TRACK_HEIGHT = 72
const PATCH_RADIUS = 2
const SEARCH_RADIUS = 6
const GUIDE = { x: 0.05, y: 0.1, width: 0.9, height: 0.8 }

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

export function quadArea(quad: NormalizedQuad): number {
  let twiceArea = 0
  for (let i = 0; i < quad.length; i++) {
    const current = quad[i]
    const next = quad[(i + 1) % quad.length]
    twiceArea += current.x * next.y - next.x * current.y
  }
  return Math.abs(twiceArea) / 2
}

export function quadBounds(quad: NormalizedQuad) {
  const xs = quad.map((point) => point.x)
  const ys = quad.map((point) => point.y)
  const left = Math.min(...xs)
  const right = Math.max(...xs)
  const top = Math.min(...ys)
  const bottom = Math.max(...ys)
  return { left, right, top, bottom, width: right - left, height: bottom - top }
}

function itemPoints(layout: OcrLayout, item: OcrLayout["items"][number]): NormalizedPoint[] {
  if (!layout.width || !layout.height) return []
  return item.poly.map(([x, y]) => ({ x: x / layout.width, y: y / layout.height }))
}

function orientedBounds(points: NormalizedPoint[]): NormalizedQuad | undefined {
  if (points.length < 4) return
  const cx = points.reduce((sum, point) => sum + point.x, 0) / points.length
  const cy = points.reduce((sum, point) => sum + point.y, 0) / points.length
  let xx = 0
  let yy = 0
  let xy = 0
  for (const point of points) {
    const dx = point.x - cx
    const dy = point.y - cy
    xx += dx * dx
    yy += dy * dy
    xy += dx * dy
  }
  const theta = 0.5 * Math.atan2(2 * xy, xx - yy)
  const ux = Math.cos(theta)
  const uy = Math.sin(theta)
  const vx = -uy
  const vy = ux
  let minU = Number.POSITIVE_INFINITY
  let maxU = Number.NEGATIVE_INFINITY
  let minV = Number.POSITIVE_INFINITY
  let maxV = Number.NEGATIVE_INFINITY
  for (const point of points) {
    const dx = point.x - cx
    const dy = point.y - cy
    const u = dx * ux + dy * uy
    const v = dx * vx + dy * vy
    minU = Math.min(minU, u)
    maxU = Math.max(maxU, u)
    minV = Math.min(minV, v)
    maxV = Math.max(maxV, v)
  }
  const padU = Math.max(0.012, (maxU - minU) * 0.06)
  const padV = Math.max(0.012, (maxV - minV) * 0.05)
  minU -= padU
  maxU += padU
  minV -= padV
  maxV += padV
  const point = (u: number, v: number): NormalizedPoint => ({
    x: clamp01(cx + u * ux + v * vx),
    y: clamp01(cy + u * uy + v * vy)
  })
  const quad: NormalizedQuad = [point(minU, minV), point(maxU, minV), point(maxU, maxV), point(minU, maxV)]
  return quadArea(quad) >= 0.015 ? quad : undefined
}

/**
 * Turn PP-OCR's text polygons into the nutrition block that the person should
 * see tracked. Nutrient-name/100 g tokens seed the vertical extent, then nearby
 * OCR boxes on those rows are included so numeric columns remain inside the
 * region even when the nutrient names themselves occupy only the left side.
 */
export function deriveNutritionRegion(layout: OcrLayout): NormalizedQuad | undefined {
  if (!layout.width || !layout.height || !layout.items.length) return
  const anchors = layout.items.filter((item) => {
    const folded = foldOcrText(item.text)
    return !!matchNutrientLabel(item.text)
      || /\b100\s*(?:g|ml)\b/.test(folded)
      || folded.includes("informacao nutricional")
  })
  if (anchors.length < 2) return

  const anchorPoints = anchors.flatMap((item) => itemPoints(layout, item))
  const minY = Math.min(...anchorPoints.map((point) => point.y))
  const maxY = Math.max(...anchorPoints.map((point) => point.y))
  const margin = Math.max(0.025, (maxY - minY) * 0.08)
  const nearby = layout.items.filter((item) => {
    const points = itemPoints(layout, item)
    if (!points.length) return false
    const centerY = points.reduce((sum, point) => sum + point.y, 0) / points.length
    return centerY >= minY - margin && centerY <= maxY + margin
  })
  return orientedBounds(nearby.flatMap((item) => itemPoints(layout, item)))
}

export function captureTrackingFrame(video: HTMLVideoElement): TrackingFrame | undefined {
  if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return
  const canvas = document.createElement("canvas")
  canvas.width = TRACK_WIDTH
  canvas.height = TRACK_HEIGHT
  const context = canvas.getContext("2d", { willReadFrequently: true })
  if (!context) return
  context.drawImage(video, 0, 0, canvas.width, canvas.height)
  const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data
  const gray = new Uint8Array(canvas.width * canvas.height)
  for (let i = 0; i < gray.length; i++) {
    const offset = i * 4
    gray[i] = Math.round(rgba[offset] * 0.299 + rgba[offset + 1] * 0.587 + rgba[offset + 2] * 0.114)
  }
  return { width: canvas.width, height: canvas.height, gray }
}

/** A fast, intentionally tentative text-dense candidate before OCR finishes. */
export function detectTextCandidate(frame: TrackingFrame): TrackedRegion | undefined {
  const cols = 12
  const rows = 9
  const cellW = frame.width / cols
  const cellH = frame.height / rows
  const scores: Array<{ x: number; y: number; score: number }> = []
  let best = 0
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const cx = (gx + 0.5) / cols
      const cy = (gy + 0.5) / rows
      if (cx < GUIDE.x || cx > GUIDE.x + GUIDE.width || cy < GUIDE.y || cy > GUIDE.y + GUIDE.height) continue
      let edge = 0
      let count = 0
      const left = Math.max(1, Math.floor(gx * cellW))
      const right = Math.min(frame.width - 1, Math.ceil((gx + 1) * cellW))
      const top = Math.max(1, Math.floor(gy * cellH))
      const bottom = Math.min(frame.height - 1, Math.ceil((gy + 1) * cellH))
      for (let y = top; y < bottom; y++) {
        for (let x = left; x < right; x++) {
          const index = y * frame.width + x
          const gradient = Math.abs(frame.gray[index] - frame.gray[index - 1])
            + Math.abs(frame.gray[index] - frame.gray[index - frame.width])
          if (gradient > 28) edge++
          count++
        }
      }
      const score = count ? edge / count : 0
      best = Math.max(best, score)
      scores.push({ x: gx, y: gy, score })
    }
  }
  if (best < 0.08) return
  const selected = scores.filter((cell) => cell.score >= Math.max(0.07, best * 0.48))
  if (selected.length < 4) return
  let minX = Math.min(...selected.map((cell) => cell.x)) / cols
  let maxX = (Math.max(...selected.map((cell) => cell.x)) + 1) / cols
  let minY = Math.min(...selected.map((cell) => cell.y)) / rows
  let maxY = (Math.max(...selected.map((cell) => cell.y)) + 1) / rows
  const padX = 0.025
  const padY = 0.025
  minX = clamp01(minX - padX)
  maxX = clamp01(maxX + padX)
  minY = clamp01(minY - padY)
  maxY = clamp01(maxY + padY)
  const quad: NormalizedQuad = [
    { x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }
  ]
  const area = quadArea(quad)
  if (area < 0.04 || area > 0.82) return
  return { quad, confidence: Math.min(0.45, 0.18 + best), source: "candidate" }
}

function bilinear(quad: NormalizedQuad, u: number, v: number): NormalizedPoint {
  const top = {
    x: quad[0].x * (1 - u) + quad[1].x * u,
    y: quad[0].y * (1 - u) + quad[1].y * u
  }
  const bottom = {
    x: quad[3].x * (1 - u) + quad[2].x * u,
    y: quad[3].y * (1 - u) + quad[2].y * u
  }
  return { x: top.x * (1 - v) + bottom.x * v, y: top.y * (1 - v) + bottom.y * v }
}

type Match = { x: number; y: number; nx: number; ny: number; sad: number }

function patchSad(previous: TrackingFrame, next: TrackingFrame, x: number, y: number, nx: number, ny: number): number {
  let sad = 0
  let count = 0
  for (let dy = -PATCH_RADIUS; dy <= PATCH_RADIUS; dy++) {
    for (let dx = -PATCH_RADIUS; dx <= PATCH_RADIUS; dx++) {
      const a = (y + dy) * previous.width + x + dx
      const b = (ny + dy) * next.width + nx + dx
      sad += Math.abs(previous.gray[a] - next.gray[b])
      count++
    }
  }
  return sad / Math.max(1, count)
}

function matchPoint(previous: TrackingFrame, next: TrackingFrame, point: NormalizedPoint): Match | undefined {
  const x = Math.round(point.x * (previous.width - 1))
  const y = Math.round(point.y * (previous.height - 1))
  if (x < PATCH_RADIUS + SEARCH_RADIUS || y < PATCH_RADIUS + SEARCH_RADIUS
    || x >= previous.width - PATCH_RADIUS - SEARCH_RADIUS || y >= previous.height - PATCH_RADIUS - SEARCH_RADIUS) return
  let bestSad = Number.POSITIVE_INFINITY
  let bestX = x
  let bestY = y
  for (let dy = -SEARCH_RADIUS; dy <= SEARCH_RADIUS; dy++) {
    for (let dx = -SEARCH_RADIUS; dx <= SEARCH_RADIUS; dx++) {
      const nx = x + dx
      const ny = y + dy
      const sad = patchSad(previous, next, x, y, nx, ny)
      if (sad < bestSad) {
        bestSad = sad
        bestX = nx
        bestY = ny
      }
    }
  }
  if (bestSad > 34) return
  return { x, y, nx: bestX, ny: bestY, sad: bestSad }
}

function solve3(matrix: number[][], vector: number[]): number[] | undefined {
  const augmented = matrix.map((row, index) => [...row, vector[index]])
  for (let col = 0; col < 3; col++) {
    let pivot = col
    for (let row = col + 1; row < 3; row++) {
      if (Math.abs(augmented[row][col]) > Math.abs(augmented[pivot][col])) pivot = row
    }
    if (Math.abs(augmented[pivot][col]) < 1e-8) return
    ;[augmented[col], augmented[pivot]] = [augmented[pivot], augmented[col]]
    const divisor = augmented[col][col]
    for (let k = col; k < 4; k++) augmented[col][k] /= divisor
    for (let row = 0; row < 3; row++) {
      if (row === col) continue
      const factor = augmented[row][col]
      for (let k = col; k < 4; k++) augmented[row][k] -= factor * augmented[col][k]
    }
  }
  return [augmented[0][3], augmented[1][3], augmented[2][3]]
}

function affine(matches: Match[]): number[] | undefined {
  let xx = 0
  let xy = 0
  let x = 0
  let yy = 0
  let y = 0
  const n = matches.length
  let bx0 = 0
  let bx1 = 0
  let bx2 = 0
  let by0 = 0
  let by1 = 0
  let by2 = 0
  for (const match of matches) {
    xx += match.x * match.x
    xy += match.x * match.y
    x += match.x
    yy += match.y * match.y
    y += match.y
    bx0 += match.x * match.nx
    bx1 += match.y * match.nx
    bx2 += match.nx
    by0 += match.x * match.ny
    by1 += match.y * match.ny
    by2 += match.ny
  }
  const normal = [[xx, xy, x], [xy, yy, y], [x, y, n]]
  const xParams = solve3(normal.map((row) => [...row]), [bx0, bx1, bx2])
  const yParams = solve3(normal.map((row) => [...row]), [by0, by1, by2])
  return xParams && yParams ? [...xParams, ...yParams] : undefined
}

/** Track a known label quad one cheap frame forward. */
export function trackRegion(previous: TrackingFrame, next: TrackingFrame, quad: NormalizedQuad): TrackedRegion | undefined {
  if (previous.width !== next.width || previous.height !== next.height) return
  const anchors = [0.2, 0.5, 0.8].flatMap((v) => [0.2, 0.5, 0.8].map((u) => bilinear(quad, u, v)))
  const matches = anchors.flatMap((point) => {
    const match = matchPoint(previous, next, point)
    return match ? [match] : []
  })
  if (matches.length < 4) return
  const transform = affine(matches)
  if (!transform) return
  const [a, b, c, d, e, f] = transform
  let residual = 0
  let meanSad = 0
  for (const match of matches) {
    const px = a * match.x + b * match.y + c
    const py = d * match.x + e * match.y + f
    residual += Math.hypot(px - match.nx, py - match.ny)
    meanSad += match.sad
  }
  residual /= matches.length
  meanSad /= matches.length

  const nextQuad = quad.map((point) => {
    const x = point.x * (previous.width - 1)
    const y = point.y * (previous.height - 1)
    return {
      x: (a * x + b * y + c) / (next.width - 1),
      y: (d * x + e * y + f) / (next.height - 1)
    }
  }) as NormalizedQuad
  if (nextQuad.some((point) => point.x < -0.12 || point.x > 1.12 || point.y < -0.12 || point.y > 1.12)) return
  const previousArea = quadArea(quad)
  const nextArea = quadArea(nextQuad)
  if (!previousArea || nextArea / previousArea < 0.5 || nextArea / previousArea > 1.9) return

  const confidence = Math.max(0, Math.min(1,
    matches.length / 9 * Math.max(0, 1 - residual / 5) * Math.max(0, 1 - meanSad / 42)
  ))
  if (confidence < 0.12) return
  return {
    quad: nextQuad.map((point) => ({ x: clamp01(point.x), y: clamp01(point.y) })) as NormalizedQuad,
    confidence,
    source: "flow"
  }
}

export function blendQuads(current: NormalizedQuad | undefined, observed: NormalizedQuad, weight = 0.72): NormalizedQuad {
  if (!current) return observed
  return observed.map((point, index) => ({
    x: current[index].x * (1 - weight) + point.x * weight,
    y: current[index].y * (1 - weight) + point.y * weight
  })) as NormalizedQuad
}
