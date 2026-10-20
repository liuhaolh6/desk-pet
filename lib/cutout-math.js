'use strict'

/**
 * Pure mask/math helpers for the photo cutout pipeline. Kept free of Electron
 * and onnxruntime so tools/smoke.js can exercise them without native modules.
 *
 * M12 note: the old `normalizeMask()` did a per-image min/max stretch followed
 * by a relative `cut` and gamma. That made the effective threshold drift with
 * the photo and, combined with `mask² + a<0.45`, produced a two-valued alpha
 * (0 or >=0.451) — the "background turned semi-transparent" bug. U2Net emits a
 * sigmoid probability, so we now keep absolute scores, segment with a
 * hysteresis threshold and keep the alpha plane binary. Soft edges are created
 * later, at output resolution, by feathering the binary mask.
 */

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

/**
 * Clamp U2Net's sigmoid output to 0..1. No min/max stretching: absolute
 * thresholds are the whole point. Returns null only for garbage input.
 */
function normalizeMask(data, size) {
  const n = Number(size) || (data ? data.length : 0)
  if (!data || data.length < n || n <= 0) return null
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const v = data[i]
    out[i] = Number.isFinite(v) ? clamp01(v) : 0
  }
  return out
}

/** 8-connected flood fill from every pixel whose score is >= `high`. */
function hysteresisMask(scores, width, height, low = 0.3, high = 0.55) {
  const n = width * height
  const out = new Uint8Array(n)
  if (!scores || scores.length < n) return out
  const queue = new Int32Array(n)
  let head = 0
  let tail = 0
  for (let i = 0; i < n; i++) {
    if (scores[i] >= high) {
      out[i] = 1
      queue[tail++] = i
    }
  }
  while (head < tail) {
    const i = queue[head++]
    const x = i % width
    const y = (i - x) / width
    for (let dy = -1; dy <= 1; dy++) {
      const ny = y + dy
      if (ny < 0 || ny >= height) continue
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue
        const nx = x + dx
        if (nx < 0 || nx >= width) continue
        const j = ny * width + nx
        if (!out[j] && scores[j] >= low) {
          out[j] = 1
          queue[tail++] = j
        }
      }
    }
  }
  return out
}

/** 3x3 erosion; pixels outside the frame do not count as background. */
function erode(mask, width, height) {
  const out = new Uint8Array(mask.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (!mask[i]) continue
      let keep = 1
      for (let dy = -1; dy <= 1 && keep; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= height) continue
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          if (nx < 0 || nx >= width) continue
          if (!mask[ny * width + nx]) { keep = 0; break }
        }
      }
      out[i] = keep
    }
  }
  return out
}

/** 3x3 dilation. */
function dilate(mask, width, height) {
  const out = new Uint8Array(mask.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= height) continue
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          if (nx < 0 || nx >= width) continue
          out[ny * width + nx] = 1
        }
      }
    }
  }
  return out
}

function openMask(mask, width, height) { return dilate(erode(mask, width, height), width, height) }
function closeMask(mask, width, height) { return erode(dilate(mask, width, height), width, height) }

/** Fill background pockets enclosed by foreground, up to `maxArea` pixels. */
function fillHoles(mask, width, height, maxArea = Infinity) {
  const n = width * height
  const outside = new Uint8Array(n)
  const queue = new Int32Array(n)
  let head = 0
  let tail = 0
  const push = (i) => {
    if (!mask[i] && !outside[i]) { outside[i] = 1; queue[tail++] = i }
  }
  for (let x = 0; x < width; x++) { push(x); push((height - 1) * width + x) }
  for (let y = 0; y < height; y++) { push(y * width); push(y * width + width - 1) }
  while (head < tail) {
    const i = queue[head++]
    const x = i % width
    const y = (i - x) / width
    if (x > 0) push(i - 1)
    if (x + 1 < width) push(i + 1)
    if (y > 0) push(i - width)
    if (y + 1 < height) push(i + width)
  }
  const out = Uint8Array.from(mask)
  const seen = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    if (mask[i] || outside[i] || seen[i]) continue
    // Collect one enclosed hole.
    const hole = []
    let h = 0
    const q = [i]
    seen[i] = 1
    while (h < q.length) {
      const j = q[h++]
      hole.push(j)
      const x = j % width
      const y = (j - x) / width
      const visit = (k) => {
        if (!mask[k] && !outside[k] && !seen[k]) { seen[k] = 1; q.push(k) }
      }
      if (x > 0) visit(j - 1)
      if (x + 1 < width) visit(j + 1)
      if (y > 0) visit(j - width)
      if (y + 1 < height) visit(j + width)
    }
    if (hole.length <= maxArea) for (const j of hole) out[j] = 1
  }
  return out
}

/** Label 8-connected foreground components. */
function components(mask, width, height) {
  const n = width * height
  const labels = new Int32Array(n).fill(-1)
  const sizes = []
  const queue = new Int32Array(n)
  let next = 0
  for (let i = 0; i < n; i++) {
    if (!mask[i] || labels[i] >= 0) continue
    const id = next++
    let head = 0
    let tail = 0
    queue[tail++] = i
    labels[i] = id
    let size = 0
    while (head < tail) {
      const j = queue[head++]
      size++
      const x = j % width
      const y = (j - x) / width
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= height) continue
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue
          const nx = x + dx
          if (nx < 0 || nx >= width) continue
          const k = ny * width + nx
          if (mask[k] && labels[k] < 0) { labels[k] = id; queue[tail++] = k }
        }
      }
    }
    sizes.push(size)
  }
  return { labels, sizes }
}

/**
 * Keep the primary subject plus any satellite blob that is at least
 * `minRatio` of the primary area (hands, ears, separated hair) and larger
 * than `minPixels`. Returns null when the mask is empty.
 */
function retainComponents(mask, width, height, options = {}) {
  const minRatio = options.minRatio === undefined ? 0.01 : options.minRatio
  const minPixels = options.minPixels === undefined ? 16 : options.minPixels
  const { labels, sizes } = components(mask, width, height)
  if (!sizes.length) return null
  let primary = 0
  for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[primary]) primary = i
  const floor = Math.max(minPixels, sizes[primary] * minRatio)
  const keepIds = new Uint8Array(sizes.length)
  for (let i = 0; i < sizes.length; i++) if (sizes[i] >= floor) keepIds[i] = 1
  keepIds[primary] = 1
  const out = new Uint8Array(width * height)
  for (let i = 0; i < out.length; i++) if (labels[i] >= 0 && keepIds[labels[i]]) out[i] = 1
  return out
}

/** Keep only the largest 8-connected blob (legacy helper, still tested). */
function largestComponent(alpha, width, height, threshold = 0.12) {
  const n = width * height
  if (!alpha || alpha.length !== n) return null
  let seed = -1
  let seedValue = threshold
  for (let i = 0; i < n; i++) {
    if (alpha[i] > seedValue) { seedValue = alpha[i]; seed = i }
  }
  if (seed < 0) return null
  const seen = new Uint8Array(n)
  const queue = new Int32Array(n)
  let head = 0
  let tail = 0
  queue[tail++] = seed
  seen[seed] = 1
  while (head < tail) {
    const i = queue[head++]
    const x = i % width
    const y = (i - x) / width
    for (let dy = -1; dy <= 1; dy++) {
      const ny = y + dy
      if (ny < 0 || ny >= height) continue
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue
        const nx = x + dx
        if (nx < 0 || nx >= width) continue
        const j = ny * width + nx
        if (!seen[j] && alpha[j] > threshold) { seen[j] = 1; queue[tail++] = j }
      }
    }
  }
  return seen
}

function maskBounds(alpha, width, height, threshold = 0.05) {
  if (!alpha || alpha.length !== width * height) return null
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      if (alpha[row + x] > threshold) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < minX || maxY < minY) return null
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

/** Fit an image to the 610 canvas, bottom-centred, with a 0.94 max dimension. */
function fitRect(srcW, srcH, canvas = 610, maxFrac = 0.94, margin = 6) {
  const max = canvas * maxFrac
  const scale = Math.min(max / srcW, max / srcH)
  const width = Math.max(1, Math.round(srcW * scale))
  const height = Math.max(1, Math.round(srcH * scale))
  return {
    x: Math.round((canvas - width) / 2),
    y: Math.max(0, canvas - height - margin),
    width,
    height,
    scale,
  }
}

function alphaCoverage(alpha, threshold = 0.5) {
  if (!alpha) return 0
  let count = 0
  for (let i = 0; i < alpha.length; i++) if (alpha[i] > threshold) count++
  return count / alpha.length
}

function smoothstep(edge0, edge1, x) {
  if (edge1 <= edge0) return x >= edge1 ? 1 : 0
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

module.exports = {
  clamp01,
  normalizeMask,
  hysteresisMask,
  erode,
  dilate,
  openMask,
  closeMask,
  fillHoles,
  components,
  retainComponents,
  largestComponent,
  maskBounds,
  fitRect,
  alphaCoverage,
  smoothstep,
}