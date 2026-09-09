import {
  NUTRIENT_DEFINITIONS,
  foldOcrText,
  matchNutrientLabel,
  type OcrLayout,
  type OcrLayoutItem
} from "@/domain/ocrLayout"
import type { NutritionKey } from "@/domain/types"
import { quadArea, type NormalizedPoint, type NormalizedQuad } from "./labelRegionTracker"

/**
 * Semantic nutrition-region estimation and cross-photo registration.
 *
 * Why OCR itself participates in geometry:
 * - OCR words + coordinates can be used as compact geometric features for
 *   document registration; Greer et al. (2025) specifically estimate document
 *   homographies from OCR text/positions and use RANSAC to tolerate OCR noise:
 *   https://arxiv.org/abs/2505.18925
 * - Camera-captured documents are approximately planar, so matching features
 *   across views supports a projective/affine registration. OpenCV documents
 *   the same feature-match -> robust transform -> corner projection pattern:
 *   https://docs.opencv.org/4.x/d7/dff/tutorial_feature_homography.html
 *
 * TrackFood has an easier correspondence problem than generic documents: the
 * same regulated nutrient names recur in every deliberate photo. We use those
 * semantic identities (carbohydrate, sodium, 100 g, etc.) as stable landmarks.
 * A per-photo region is built from whole nutritional rows, including rows whose
 * label OCR is weak but which lie inside the table span. Across photos, matching
 * semantic landmarks robustly register the previous region into the new image.
 * This lets the displayed region remember useful extents discovered by earlier
 * photos instead of starting from scratch on every PP-OCR pass.
 */

export type SemanticRegionFeature = {
  id: string
  point: NormalizedPoint
  score: number
}

export type NutritionRegionEvidence = {
  quad?: NormalizedQuad
  features: SemanticRegionFeature[]
  nutrientKeys: NutritionKey[]
  supportRows: number
}

export type NutritionRegionMemory = {
  quad: NormalizedQuad
  features: SemanticRegionFeature[]
  nutrientKeys: NutritionKey[]
  observations: number
}

type Located = {
  item: OcrLayoutItem
  points: NormalizedPoint[]
  left: number
  right: number
  top: number
  bottom: number
  cx: number
  cy: number
  width: number
  height: number
}

type RegionRow = {
  cells: Located[]
  cy: number
  height: number
  text: string
  nutrientKeys: NutritionKey[]
}

type Pair = { from: NormalizedPoint; to: NormalizedPoint }
type Affine = [number, number, number, number, number, number]

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function located(layout: OcrLayout): Located[] {
  if (!layout.width || !layout.height) return []
  return layout.items.flatMap((item) => {
    const points = item.poly.flatMap(([x, y]) => Number.isFinite(x) && Number.isFinite(y)
      ? [{ x: x / layout.width, y: y / layout.height }]
      : [])
    if (points.length < 4 || !item.text.trim()) return []
    const xs = points.map((point) => point.x)
    const ys = points.map((point) => point.y)
    const left = Math.min(...xs)
    const right = Math.max(...xs)
    const top = Math.min(...ys)
    const bottom = Math.max(...ys)
    return [{
      item,
      points,
      left,
      right,
      top,
      bottom,
      cx: (left + right) / 2,
      cy: (top + bottom) / 2,
      width: right - left,
      height: bottom - top
    }]
  })
}

function keysInText(text: string): NutritionKey[] {
  const folded = foldOcrText(text)
  const keys = new Set<NutritionKey>()
  for (const definition of NUTRIENT_DEFINITIONS) {
    if (definition.aliases.some((alias) => folded.includes(alias))) keys.add(definition.key)
  }
  const fuzzy = matchNutrientLabel(text)
  if (fuzzy) keys.add(fuzzy)
  return [...keys]
}

function clusterRows(cells: Located[]): RegionRow[] {
  const ordered = [...cells].sort((a, b) => a.cy - b.cy || a.left - b.left)
  const typicalHeight = median(ordered.map((cell) => cell.height)) || 0.02
  const rows: Array<{ cells: Located[]; cy: number; height: number }> = []
  for (const cell of ordered) {
    const threshold = Math.max(0.008, Math.min(typicalHeight, cell.height) * 0.75)
    let best: (typeof rows)[number] | undefined
    let distance = Number.POSITIVE_INFINITY
    for (const row of rows.slice(-5)) {
      const candidate = Math.abs(row.cy - cell.cy)
      if (candidate <= threshold && candidate < distance) {
        best = row
        distance = candidate
      }
    }
    if (!best) {
      rows.push({ cells: [cell], cy: cell.cy, height: cell.height })
      continue
    }
    best.cells.push(cell)
    best.cells.sort((a, b) => a.left - b.left)
    best.cy = best.cells.reduce((sum, value) => sum + value.cy, 0) / best.cells.length
    best.height = median(best.cells.map((value) => value.height))
  }
  return rows
    .sort((a, b) => a.cy - b.cy)
    .map((row) => {
      const text = row.cells.map((cell) => cell.item.text).join(" ")
      const keys = new Set<NutritionKey>(keysInText(text))
      row.cells.forEach((cell) => keysInText(cell.item.text).forEach((key) => keys.add(key)))
      return { ...row, text, nutrientKeys: [...keys] }
    })
}

function isHeading(row: RegionRow): boolean {
  const text = foldOcrText(row.text)
  return text.includes("informacao nutricional") || text.includes("informacoes nutricionais")
}

function isBasisOrHeader(row: RegionRow): boolean {
  const text = foldOcrText(row.text)
  return /\b100\s*(?:g|ml)\b/.test(text)
    || /\bporcao\b/.test(text)
    || /%\s*vd\b/.test(text)
    || /valor diario/.test(text)
}

function looksLikeNutritionContinuation(row: RegionRow): boolean {
  const text = foldOcrText(row.text)
  const hasNumber = /\b\d+(?:[,.]\d+)?\b/.test(text)
  const hasUnit = /\b(?:kcal|kj|mg|g|ml)\b/.test(text) || /%/.test(text)
  return hasNumber && hasUnit
}

function semanticRows(rows: RegionRow[]): RegionRow[] {
  const nutrientIndexes = rows.flatMap((row, index) => row.nutrientKeys.length ? [index] : [])
  if (!nutrientIndexes.length) return []

  const firstNutrient = Math.min(...nutrientIndexes)
  const lastNutrient = Math.max(...nutrientIndexes)
  let first = firstNutrient
  let last = lastNutrient

  // Pull in the nearby title/basis/serving header, but never walk arbitrarily
  // into an ingredients paragraph above the table.
  for (let index = firstNutrient - 1; index >= Math.max(0, firstNutrient - 4); index--) {
    if (isHeading(rows[index]) || isBasisOrHeader(rows[index])) first = index
  }

  // A final nutrient label is sometimes the token OCR drops. Permit a couple
  // of table-looking continuation rows below the last semantic anchor so their
  // numeric cells remain visible inside the ROI instead of being cropped out.
  for (let index = lastNutrient + 1; index <= Math.min(rows.length - 1, lastNutrient + 2); index++) {
    if (looksLikeNutritionContinuation(rows[index])) last = index
    else break
  }

  // Every row between the first and last known nutrient is part of the region.
  // This is important when, for example, the word "Açúcares" is the one OCR
  // misses: its row still lies geometrically between recognized nutrient rows.
  return rows.slice(first, last + 1)
}

function dominantTextAngle(cells: Located[]): number {
  let sx = 0
  let sy = 0
  let weight = 0
  for (const cell of cells) {
    if (cell.points.length < 2) continue
    const a = cell.points[0]
    const b = cell.points[1]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const length = Math.hypot(dx, dy)
    if (length < 1e-4) continue
    const angle = Math.atan2(dy, dx)
    sx += Math.cos(angle) * length
    sy += Math.sin(angle) * length
    weight += length
  }
  return weight ? Math.atan2(sy, sx) : 0
}

function rotate(point: NormalizedPoint, center: NormalizedPoint, angle: number): NormalizedPoint {
  const dx = point.x - center.x
  const dy = point.y - center.y
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos }
}

function linearFit(samples: Array<{ y: number; x: number }>): { a: number; b: number } {
  if (samples.length < 2) return { a: 0, b: samples[0]?.x ?? 0 }
  const meanY = samples.reduce((sum, sample) => sum + sample.y, 0) / samples.length
  const meanX = samples.reduce((sum, sample) => sum + sample.x, 0) / samples.length
  let numerator = 0
  let denominator = 0
  for (const sample of samples) {
    numerator += (sample.y - meanY) * (sample.x - meanX)
    denominator += (sample.y - meanY) ** 2
  }
  const a = denominator > 1e-8 ? numerator / denominator : 0
  return { a, b: meanX - a * meanY }
}

function perspectiveEnvelope(rows: RegionRow[]): NormalizedQuad | undefined {
  const cells = rows.flatMap((row) => row.cells)
  const points = cells.flatMap((cell) => cell.points)
  if (points.length < 4) return
  const center = {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length
  }
  const angle = dominantTextAngle(cells)
  const rotatedRows = rows.map((row) => {
    const pts = row.cells.flatMap((cell) => cell.points.map((point) => rotate(point, center, -angle)))
    return {
      cy: pts.reduce((sum, point) => sum + point.y, 0) / pts.length,
      left: Math.min(...pts.map((point) => point.x)),
      right: Math.max(...pts.map((point) => point.x)),
      top: Math.min(...pts.map((point) => point.y)),
      bottom: Math.max(...pts.map((point) => point.y))
    }
  })
  const leftFit = linearFit(rotatedRows.map((row) => ({ y: row.cy, x: row.left })))
  const rightFit = linearFit(rotatedRows.map((row) => ({ y: row.cy, x: row.right })))
  const predictLeft = (y: number) => leftFit.a * y + leftFit.b
  const predictRight = (y: number) => rightFit.a * y + rightFit.b

  // Shift the fitted side lines outward far enough to include every semantic
  // row. This is intentionally an envelope, not a best-fit box that can clip a
  // weak/missing nutrient row.
  const leftResidual = Math.min(0, ...rotatedRows.map((row) => row.left - predictLeft(row.cy)))
  const rightResidual = Math.max(0, ...rotatedRows.map((row) => row.right - predictRight(row.cy)))
  let top = Math.min(...rotatedRows.map((row) => row.top))
  let bottom = Math.max(...rotatedRows.map((row) => row.bottom))
  const height = Math.max(0.01, bottom - top)
  const typicalWidth = median(rotatedRows.map((row) => row.right - row.left)) || 0.2
  const padX = Math.max(0.018, typicalWidth * 0.06)
  const padY = Math.max(0.015, height * 0.05)
  top -= padY
  bottom += padY

  const leftAt = (y: number) => predictLeft(y) + leftResidual - padX
  const rightAt = (y: number) => predictRight(y) + rightResidual + padX
  const raw: NormalizedQuad = [
    { x: leftAt(top), y: top },
    { x: rightAt(top), y: top },
    { x: rightAt(bottom), y: bottom },
    { x: leftAt(bottom), y: bottom }
  ]
  const quad = raw.map((point) => rotate(point, center, angle)) as NormalizedQuad
  const clamped = quad.map((point) => ({ x: clamp01(point.x), y: clamp01(point.y) })) as NormalizedQuad
  return quadArea(clamped) >= 0.012 ? clamped : undefined
}

function featureCenter(cells: Located[]): NormalizedPoint {
  return {
    x: cells.reduce((sum, cell) => sum + cell.cx, 0) / cells.length,
    y: cells.reduce((sum, cell) => sum + cell.cy, 0) / cells.length
  }
}

function semanticFeatures(rows: RegionRow[]): SemanticRegionFeature[] {
  const result = new Map<string, SemanticRegionFeature>()
  for (const row of rows) {
    for (const key of row.nutrientKeys) {
      const direct = row.cells.filter((cell) => keysInText(cell.item.text).includes(key))
      const cells = direct.length ? direct : row.cells
      const score = cells.reduce((sum, cell) => sum + Math.max(0, Math.min(1, cell.item.score)), 0) / cells.length
      const feature = { id: `nutrient:${key}`, point: featureCenter(cells), score }
      const current = result.get(feature.id)
      if (!current || feature.score > current.score) result.set(feature.id, feature)
    }
    const folded = foldOcrText(row.text)
    const specials: Array<[string, boolean]> = [
      ["heading", isHeading(row)],
      ["basis", /\b100\s*(?:g|ml)\b/.test(folded)],
      ["serving", /\bporcao\b/.test(folded)]
    ]
    for (const [id, present] of specials) {
      if (!present) continue
      const feature = { id, point: featureCenter(row.cells), score: 0.9 }
      if (!result.has(id)) result.set(id, feature)
    }
  }
  return [...result.values()]
}

export function deriveNutritionRegionEvidence(layout: OcrLayout): NutritionRegionEvidence {
  const rows = clusterRows(located(layout))
  const selected = semanticRows(rows)
  if (!selected.length) return { features: [], nutrientKeys: [], supportRows: 0 }
  const keys = new Set<NutritionKey>()
  selected.forEach((row) => row.nutrientKeys.forEach((key) => keys.add(key)))
  return {
    quad: perspectiveEnvelope(selected),
    features: semanticFeatures(selected),
    nutrientKeys: [...keys],
    supportRows: selected.length
  }
}

function solve3(matrix: number[][], vector: number[]): number[] | undefined {
  const augmented = matrix.map((row, index) => [...row, vector[index]])
  for (let col = 0; col < 3; col++) {
    let pivot = col
    for (let row = col + 1; row < 3; row++) {
      if (Math.abs(augmented[row][col]) > Math.abs(augmented[pivot][col])) pivot = row
    }
    if (Math.abs(augmented[pivot][col]) < 1e-10) return
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

function fitAffine(pairs: Pair[]): Affine | undefined {
  if (pairs.length < 3) return
  let xx = 0
  let xy = 0
  let x = 0
  let yy = 0
  let y = 0
  let tx0 = 0
  let tx1 = 0
  let tx2 = 0
  let ty0 = 0
  let ty1 = 0
  let ty2 = 0
  for (const pair of pairs) {
    xx += pair.from.x * pair.from.x
    xy += pair.from.x * pair.from.y
    x += pair.from.x
    yy += pair.from.y * pair.from.y
    y += pair.from.y
    tx0 += pair.from.x * pair.to.x
    tx1 += pair.from.y * pair.to.x
    tx2 += pair.to.x
    ty0 += pair.from.x * pair.to.y
    ty1 += pair.from.y * pair.to.y
    ty2 += pair.to.y
  }
  const normal = [[xx, xy, x], [xy, yy, y], [x, y, pairs.length]]
  const xp = solve3(normal.map((row) => [...row]), [tx0, tx1, tx2])
  const yp = solve3(normal.map((row) => [...row]), [ty0, ty1, ty2])
  return xp && yp ? [xp[0], xp[1], xp[2], yp[0], yp[1], yp[2]] : undefined
}

function transformPoint(transform: Affine, point: NormalizedPoint): NormalizedPoint {
  return {
    x: transform[0] * point.x + transform[1] * point.y + transform[2],
    y: transform[3] * point.x + transform[4] * point.y + transform[5]
  }
}

function robustAffine(pairs: Pair[]): Affine | undefined {
  if (pairs.length < 3) return
  let best: { inliers: Pair[]; error: number } | undefined
  let trials = 0
  for (let i = 0; i < pairs.length - 2 && trials < 80; i++) {
    for (let j = i + 1; j < pairs.length - 1 && trials < 80; j++) {
      for (let k = j + 1; k < pairs.length && trials < 80; k++, trials++) {
        const transform = fitAffine([pairs[i], pairs[j], pairs[k]])
        if (!transform) continue
        const scored = pairs.map((pair) => ({ pair, error: Math.hypot(
          transformPoint(transform, pair.from).x - pair.to.x,
          transformPoint(transform, pair.from).y - pair.to.y
        ) }))
        const inliers = scored.filter((entry) => entry.error <= 0.045).map((entry) => entry.pair)
        if (inliers.length < 3) continue
        const error = scored.filter((entry) => entry.error <= 0.045)
          .reduce((sum, entry) => sum + entry.error, 0) / inliers.length
        if (!best || inliers.length > best.inliers.length || inliers.length === best.inliers.length && error < best.error) {
          best = { inliers, error }
        }
      }
    }
  }
  return best ? fitAffine(best.inliers) : undefined
}

function matchedPairs(previous: SemanticRegionFeature[], next: SemanticRegionFeature[]): Pair[] {
  const current = new Map(next.map((feature) => [feature.id, feature]))
  return previous.flatMap((feature) => {
    const match = current.get(feature.id)
    return match ? [{ from: feature.point, to: match.point }] : []
  })
}

function transformQuad(quad: NormalizedQuad, transform: Affine): NormalizedQuad {
  return quad.map((point) => {
    const transformed = transformPoint(transform, point)
    return { x: clamp01(transformed.x), y: clamp01(transformed.y) }
  }) as NormalizedQuad
}

function quadCenter(quad: NormalizedQuad): NormalizedPoint {
  return {
    x: quad.reduce((sum, point) => sum + point.x, 0) / 4,
    y: quad.reduce((sum, point) => sum + point.y, 0) / 4
  }
}

function extendByRegisteredMemory(current: NormalizedQuad, previous: NormalizedQuad): NormalizedQuad {
  const center = quadCenter(current)
  return current.map((point, index) => {
    const old = previous[index]
    const direction = { x: point.x - center.x, y: point.y - center.y }
    const currentProjection = direction.x * (point.x - center.x) + direction.y * (point.y - center.y)
    const oldProjection = direction.x * (old.x - center.x) + direction.y * (old.y - center.y)
    const chosen = oldProjection > currentProjection ? old : point
    return { x: clamp01(chosen.x), y: clamp01(chosen.y) }
  }) as NormalizedQuad
}

/**
 * Register the previous semantic ROI into the new OCR image and retain useful
 * extents from either observation. The registration is only accepted when at
 * least three named OCR landmarks agree under a robust affine model; otherwise
 * we trust the new photo rather than smearing unrelated boxes together.
 */
export function updateNutritionRegionMemory(
  memory: NutritionRegionMemory | undefined,
  evidence: NutritionRegionEvidence
): NutritionRegionMemory | undefined {
  if (!evidence.quad) return memory
  if (!memory) {
    return {
      quad: evidence.quad,
      features: evidence.features,
      nutrientKeys: evidence.nutrientKeys,
      observations: 1
    }
  }

  const transform = robustAffine(matchedPairs(memory.features, evidence.features))
  const previousRegistered = transform ? transformQuad(memory.quad, transform) : undefined
  const newKeys = new Set([...memory.nutrientKeys, ...evidence.nutrientKeys])
  const gainedCoverage = evidence.nutrientKeys.some((key) => !memory.nutrientKeys.includes(key))

  let quad = evidence.quad
  if (previousRegistered) {
    // If this photo adds a newly recognized nutrient, preserve both extents.
    // Otherwise prefer the registered historical envelope when it was already
    // based on at least as much semantic coverage as the current OCR pass.
    quad = gainedCoverage
      ? extendByRegisteredMemory(evidence.quad, previousRegistered)
      : memory.nutrientKeys.length >= evidence.nutrientKeys.length
        ? extendByRegisteredMemory(previousRegistered, evidence.quad)
        : evidence.quad
  }

  return {
    quad,
    features: evidence.features,
    nutrientKeys: [...newKeys],
    observations: memory.observations + 1
  }
}

/** Map a region observed at shutter time into the currently tracked pose. */
export function mapRegionBetweenQuads(
  sourceAnchor: NormalizedQuad,
  destinationAnchor: NormalizedQuad,
  region: NormalizedQuad
): NormalizedQuad | undefined {
  const pairs: Pair[] = sourceAnchor.map((from, index) => ({ from, to: destinationAnchor[index] }))
  const transform = fitAffine(pairs)
  return transform ? transformQuad(region, transform) : undefined
}
