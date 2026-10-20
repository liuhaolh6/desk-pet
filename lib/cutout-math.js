'use strict'

/**
 * Pure mask/math helpers for the photo cutout pipeline. Kept free of Electron
 * and onnxruntime so tools/smoke.js can exercise them without native modules.
 */

function normalizeMask(data, size, cut = 0.32, gain = 1.6) {
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < data.length; i++) {
    const v = data[i]
    if (v < min) min = v
    if (v > max) max = v
  }
  const span = max - min
  if (!Number.isFinite(span) || span < 1e-6) return null
  const out = new Float32Array(data.length)
  const c = Math.max(0, Math.min(0.95, Number(cut) || 0))
  const g = Math.max(0.1, Number(gain) || 1.6)
  for (let i = 0; i < data.length; i++) {
    const v = (data[i] - min) / span
    let a = (v - c) / (1 - c)
    a = Math.max(0, Math.min(1, a))
    a = Math.pow(a, 1 / g)
    out[i] = a < 0.06 ? 0 : a
  }
  return out
}

/** Keep the largest 4-connected blob of confident foreground. */
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
    if (x > 0 && !seen[i - 1] && alpha[i - 1] > threshold) { seen[i - 1] = 1; queue[tail++] = i - 1 }
    if (x + 1 < width && !seen[i + 1] && alpha[i + 1] > threshold) { seen[i + 1] = 1; queue[tail++] = i + 1 }
    if (y > 0 && !seen[i - width] && alpha[i - width] > threshold) { seen[i - width] = 1; queue[tail++] = i - width }
    if (y + 1 < height && !seen[i + width] && alpha[i + width] > threshold) { seen[i + width] = 1; queue[tail++] = i + width }
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

module.exports = { normalizeMask, largestComponent, maskBounds, fitRect, alphaCoverage }
