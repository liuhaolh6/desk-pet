'use strict'

/**
 * Cutout evaluation metrics (P2-5).
 *
 * Pure functions on masks/alpha so they can be unit tested and reused by the
 * CLI (`tools/cutout-eval.js`) without ONNX or Electron.
 *
 * A "mask" here is a Uint8Array of 0/1, row-major, length w*h.
 */

/** Turn an RGBA buffer's alpha channel into a 0/1 mask. */
function maskFromAlpha(rgba, threshold = 127) {
  const out = new Uint8Array(Math.floor(rgba.length / 4))
  for (let i = 0, p = 3; i < out.length; i++, p += 4) out[i] = rgba[p] > threshold ? 1 : 0
  return out
}

/**
 * Intersection over Union. Both masks must have the same length.
 * Empty vs empty counts as 1 (both agree there is nothing).
 */
function iou(pred, ref) {
  if (!pred || !ref || pred.length !== ref.length) return 0
  let inter = 0
  let union = 0
  for (let i = 0; i < pred.length; i++) {
    const a = pred[i] ? 1 : 0
    const b = ref[i] ? 1 : 0
    if (a && b) inter++
    if (a || b) union++
  }
  return union === 0 ? 1 : inter / union
}

/** Number of foreground pixels that have at least one background 4-neighbour. */
function boundaryLength(mask, w, h) {
  let n = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!mask[i]) continue
      const up = y > 0 ? mask[i - w] : 0
      const down = y < h - 1 ? mask[i + w] : 0
      const left = x > 0 ? mask[i - 1] : 0
      const right = x < w - 1 ? mask[i + 1] : 0
      if (!up || !down || !left || !right) n++
    }
  }
  return n
}

/**
 * Mean |Δalpha| across the boundary, normalised by boundary length.
 *
 * A hard 0/255 edge scores ~255; a mushy edge (lots of 40–180 pixels) scores
 * lower. It is a cheap "are the hair strands crisp or mush" proxy that does not
 * need a reference mask.
 */
function edgeSharpness(alpha, w, h) {
  let sum = 0
  let n = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w - 1; x++) {
      const i = y * w + x
      const a = alpha[i]
      const b = alpha[i + 1]
      let inside = false
      if (a >= 128 && b < 128) inside = true
      else if (b >= 128 && a < 128) inside = true
      if (!inside) continue
      sum += Math.abs(a - b)
      n++
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h - 1; y++) {
      const i = y * w + x
      const a = alpha[i]
      const b = alpha[i + w]
      let inside = false
      if (a >= 128 && b < 128) inside = true
      else if (b >= 128 && a < 128) inside = true
      if (!inside) continue
      sum += Math.abs(a - b)
      n++
    }
  }
  return n === 0 ? 0 : sum / n
}

/** A PNG's alpha channel as a plain array (convenience for callers). */
function alphaChannel(rgba) {
  const out = new Uint8Array(Math.floor(rgba.length / 4))
  for (let i = 0, p = 3; i < out.length; i++, p += 4) out[i] = rgba[p]
  return out
}

/** Percentile of a numeric list (nearest-rank, no interpolation). */
function percentile(values, p) {
  const list = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
  if (!list.length) return 0
  const idx = Math.min(list.length - 1, Math.max(0, Math.ceil((p / 100) * list.length) - 1))
  return list[idx]
}

/**
 * Aggregate per-image rows into one summary.
 * @param {Array<{iou?:number, ms?:number, edge?:number, coverage?:number}>} rows
 */
function summarize(rows) {
  const list = Array.isArray(rows) ? rows : []
  const withIou = list.filter((r) => Number.isFinite(r && r.iou))
  const ms = list.map((r) => (r && r.ms) || 0).filter((v) => v > 0)
  const edges = list.map((r) => (r && r.edge) || 0).filter((v) => v > 0)
  const mean = (vals) => (vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0)
  return {
    count: list.length,
    iouCount: withIou.length,
    iouMean: mean(withIou.map((r) => r.iou)),
    iouMin: withIou.length ? Math.min(...withIou.map((r) => r.iou)) : 0,
    msP50: percentile(ms, 50),
    msP95: percentile(ms, 95),
    edgeMean: mean(edges),
  }
}


/**
 * Cutout masks are 8-bit grey written into RGB with alpha=255 (see
 * `lib/cutout.js` maskPng). Some tools write them into alpha instead. This
 * picks whichever channel actually varies, so both conventions work.
 */
function greyChannel(rgba) {
  const n = Math.floor(rgba.length / 4)
  let minA = 255
  let maxA = 0
  for (let i = 0, p = 3; i < n; i++, p += 4) {
    const a = rgba[p]
    if (a < minA) minA = a
    if (a > maxA) maxA = a
  }
  const out = new Uint8Array(n)
  if (maxA - minA > 8) {
    for (let i = 0, p = 3; i < n; i++, p += 4) out[i] = rgba[p]
    return out
  }
  for (let i = 0, p = 0; i < n; i++, p += 4) out[i] = Math.round(0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2])
  return out
}

/** Mask from a decoded PNG (either convention). */
function maskFromImage(rgba, threshold = 127) {
  const grey = greyChannel(rgba)
  const out = new Uint8Array(grey.length)
  for (let i = 0; i < grey.length; i++) out[i] = grey[i] > threshold ? 1 : 0
  return out
}

module.exports = { maskFromAlpha, greyChannel, maskFromImage, alphaChannel, iou, boundaryLength, edgeSharpness, percentile, summarize }