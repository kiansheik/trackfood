import { quadArea, type NormalizedPoint, type NormalizedQuad, type TrackedRegion, type TrackingFrame } from "./labelRegionTracker"

/**
 * Robust short-interval tracking for the nutrition HUD.
 *
 * Methodology:
 * - Track strong local features rather than fixed grid points. OpenCV's sparse
 *   optical-flow tutorial pairs Shi-Tomasi-style good features with
 *   Lucas-Kanade tracking and explicitly notes that feature quality matters:
 *   https://docs.opencv.org/4.x/d4/dee/tutorial_optical_flow.html
 * - Reject inconsistent matches before fitting the motion model. RANSAC is the
 *   standard robust estimator used when feature correspondences contain
 *   outliers, including planar/document registration:
 *   https://docs.opencv.org/4.x/d7/dff/tutorial_feature_homography.html
 *
 * We keep this browser implementation small: a 96x72 frame, corner-strength
 * selection inside the known ROI, bidirectional patch matching, and a
 * deterministic RANSAC-style affine fit. PP-OCR supplies the perspective-aware
 * semantic re-anchor after each deliberate photo, so the cheap live tracker
 * only has to model small frame-to-frame motion between those anchors.
 */

const FEATURE_LIMIT = 24
const FEATURE_SPACING = 4
const PATCH_RADIUS = 2
const SEARCH_RADIUS = 8
const MAX_MATCH_SAD = 34
const FORWARD_BACKWARD_LIMIT = 1.75
const RANSAC_RESIDUAL = 2.5

type PixelPoint = { x: number; y: number }
type Match = { from: PixelPoint; to: PixelPoint; sad: number }
type Affine = [number, number, number, number, number, number]

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function pointInQuad(point: PixelPoint, quad: PixelPoint[]): boolean {
  let sign = 0
  for (let index = 0; index < quad.length; index++) {
    const a = quad[index]
    const b = quad[(index + 1) % quad.length]
    const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x)
    if (Math.abs(cross) < 1e-6) continue
    const nextSign = Math.sign(cross)
    if (!sign) sign = nextSign
    else if (nextSign !== sign) return false
  }
  return true
}

function toPixels(quad: NormalizedQuad, frame: TrackingFrame): PixelPoint[] {
  return quad.map((point) => ({
    x: point.x * (frame.width - 1),
    y: point.y * (frame.height - 1)
  }))
}

function cornerStrength(frame: TrackingFrame, x: number, y: number): number {
  let xx = 0
  let yy = 0
  let xy = 0
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const px = x + dx
      const py = y + dy
      const index = py * frame.width + px
      const gx = (frame.gray[index + 1] - frame.gray[index - 1]) / 2
      const gy = (frame.gray[index + frame.width] - frame.gray[index - frame.width]) / 2
      xx += gx * gx
      yy += gy * gy
      xy += gx * gy
    }
  }
  const trace = xx + yy
  const discriminant = Math.sqrt(Math.max(0, (xx - yy) ** 2 + 4 * xy * xy))
  return (trace - discriminant) / 2
}

function selectFeatures(frame: TrackingFrame, quad: NormalizedQuad): PixelPoint[] {
  const polygon = toPixels(quad, frame)
  const left = Math.max(PATCH_RADIUS + SEARCH_RADIUS + 1, Math.floor(Math.min(...polygon.map((point) => point.x))))
  const right = Math.min(frame.width - PATCH_RADIUS - SEARCH_RADIUS - 2, Math.ceil(Math.max(...polygon.map((point) => point.x))))
  const top = Math.max(PATCH_RADIUS + SEARCH_RADIUS + 1, Math.floor(Math.min(...polygon.map((point) => point.y))))
  const bottom = Math.min(frame.height - PATCH_RADIUS - SEARCH_RADIUS - 2, Math.ceil(Math.max(...polygon.map((point) => point.y))))
  const candidates: Array<{ point: PixelPoint; score: number }> = []

  for (let y = top; y <= bottom; y += 2) {
    for (let x = left; x <= right; x += 2) {
      if (!pointInQuad({ x, y }, polygon)) continue
      const score = cornerStrength(frame, x, y)
      if (score > 60) candidates.push({ point: { x, y }, score })
    }
  }

  candidates.sort((a, b) => b.score - a.score)
  const selected: PixelPoint[] = []
  for (const candidate of candidates) {
    if (selected.some((point) => Math.hypot(point.x - candidate.point.x, point.y - candidate.point.y) < FEATURE_SPACING)) continue
    selected.push(candidate.point)
    if (selected.length >= FEATURE_LIMIT) break
  }
  return selected
}

function patchSad(a: TrackingFrame, b: TrackingFrame, ax: number, ay: number, bx: number, by: number): number {
  let sad = 0
  let count = 0
  for (let dy = -PATCH_RADIUS; dy <= PATCH_RADIUS; dy++) {
    for (let dx = -PATCH_RADIUS; dx <= PATCH_RADIUS; dx++) {
      sad += Math.abs(a.gray[(ay + dy) * a.width + ax + dx] - b.gray[(by + dy) * b.width + bx + dx])
      count++
    }
  }
  return sad / count
}

function bestPatchMatch(previous: TrackingFrame, next: TrackingFrame, point: PixelPoint): { point: PixelPoint; sad: number } | undefined {
  const x = Math.round(point.x)
  const y = Math.round(point.y)
  if (x < PATCH_RADIUS || y < PATCH_RADIUS || x >= previous.width - PATCH_RADIUS || y >= previous.height - PATCH_RADIUS) return
  let bestSad = Number.POSITIVE_INFINITY
  let secondSad = Number.POSITIVE_INFINITY
  let best: PixelPoint | undefined
  for (let dy = -SEARCH_RADIUS; dy <= SEARCH_RADIUS; dy++) {
    for (let dx = -SEARCH_RADIUS; dx <= SEARCH_RADIUS; dx++) {
      const nx = x + dx
      const ny = y + dy
      if (nx < PATCH_RADIUS || ny < PATCH_RADIUS || nx >= next.width - PATCH_RADIUS || ny >= next.height - PATCH_RADIUS) continue
      const sad = patchSad(previous, next, x, y, nx, ny)
      if (sad < bestSad) {
        secondSad = bestSad
        bestSad = sad
        best = { x: nx, y: ny }
      } else if (sad < secondSad) {
        secondSad = sad
      }
    }
  }
  if (!best || bestSad > MAX_MATCH_SAD) return
  // Repetitive text strokes can produce several almost-identical matches. A
  // weak ratio check prevents an ambiguous patch from steering the ROI.
  if (Number.isFinite(secondSad) && bestSad > 2 && bestSad / Math.max(1e-6, secondSad) > 0.96) return
  return { point: best, sad: bestSad }
}

function matches(previous: TrackingFrame, next: TrackingFrame, quad: NormalizedQuad): Match[] {
  const result: Match[] = []
  for (const feature of selectFeatures(previous, quad)) {
    const forward = bestPatchMatch(previous, next, feature)
    if (!forward) continue
    const backward = bestPatchMatch(next, previous, forward.point)
    if (!backward || Math.hypot(backward.point.x - feature.x, backward.point.y - feature.y) > FORWARD_BACKWARD_LIMIT) continue
    result.push({ from: feature, to: forward.point, sad: forward.sad })
  }
  return result
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

function fitAffine(values: Match[]): Affine | undefined {
  if (values.length < 3) return
  let xx = 0
  let xy = 0
  let x = 0
  let yy = 0
  let y = 0
  let bx0 = 0
  let bx1 = 0
  let bx2 = 0
  let by0 = 0
  let by1 = 0
  let by2 = 0
  for (const match of values) {
    xx += match.from.x * match.from.x
    xy += match.from.x * match.from.y
    x += match.from.x
    yy += match.from.y * match.from.y
    y += match.from.y
    bx0 += match.from.x * match.to.x
    bx1 += match.from.y * match.to.x
    bx2 += match.to.x
    by0 += match.from.x * match.to.y
    by1 += match.from.y * match.to.y
    by2 += match.to.y
  }
  const normal = [[xx, xy, x], [xy, yy, y], [x, y, values.length]]
  const xp = solve3(normal.map((row) => [...row]), [bx0, bx1, bx2])
  const yp = solve3(normal.map((row) => [...row]), [by0, by1, by2])
  return xp && yp ? [xp[0], xp[1], xp[2], yp[0], yp[1], yp[2]] : undefined
}

function project(transform: Affine, point: PixelPoint): PixelPoint {
  return {
    x: transform[0] * point.x + transform[1] * point.y + transform[2],
    y: transform[3] * point.x + transform[4] * point.y + transform[5]
  }
}

function robustAffine(values: Match[]): { transform: Affine; inliers: Match[]; residual: number } | undefined {
  if (values.length < 4) return
  let best: { inliers: Match[]; residual: number } | undefined
  let trials = 0
  for (let i = 0; i < values.length - 2 && trials < 80; i++) {
    for (let j = i + 1; j < values.length - 1 && trials < 80; j++) {
      for (let k = j + 1; k < values.length && trials < 80; k++, trials++) {
        const transform = fitAffine([values[i], values[j], values[k]])
        if (!transform) continue
        const scored = values.map((match) => ({ match, error: Math.hypot(
          project(transform, match.from).x - match.to.x,
          project(transform, match.from).y - match.to.y
        ) }))
        const inliers = scored.filter((entry) => entry.error <= RANSAC_RESIDUAL).map((entry) => entry.match)
        if (inliers.length < 4) continue
        const residual = scored.filter((entry) => entry.error <= RANSAC_RESIDUAL)
          .reduce((sum, entry) => sum + entry.error, 0) / inliers.length
        if (!best || inliers.length > best.inliers.length || inliers.length === best.inliers.length && residual < best.residual) {
          best = { inliers, residual }
        }
      }
    }
  }
  if (!best) return
  const transform = fitAffine(best.inliers)
  return transform ? { transform, inliers: best.inliers, residual: best.residual } : undefined
}

export function trackRegionRobust(previous: TrackingFrame, next: TrackingFrame, quad: NormalizedQuad): TrackedRegion | undefined {
  if (previous.width !== next.width || previous.height !== next.height) return
  const allMatches = matches(previous, next, quad)
  const model = robustAffine(allMatches)
  if (!model) return

  const nextQuad = toPixels(quad, previous).map((point) => project(model.transform, point))
  if (nextQuad.some((point) => point.x < -12 || point.x > next.width + 12 || point.y < -12 || point.y > next.height + 12)) return
  const normalized = nextQuad.map((point) => ({
    x: clamp01(point.x / (next.width - 1)),
    y: clamp01(point.y / (next.height - 1))
  })) as NormalizedQuad

  const before = quadArea(quad)
  const after = quadArea(normalized)
  if (!before || after / before < 0.55 || after / before > 1.8) return

  const inlierRatio = model.inliers.length / Math.max(1, allMatches.length)
  const meanSad = model.inliers.reduce((sum, match) => sum + match.sad, 0) / model.inliers.length
  const confidence = Math.max(0, Math.min(1,
    Math.min(1, model.inliers.length / 10)
      * inlierRatio
      * Math.max(0, 1 - model.residual / 4)
      * Math.max(0, 1 - meanSad / 42)
  ))
  if (confidence < 0.14) return
  return { quad: normalized, confidence, source: "flow" }
}
