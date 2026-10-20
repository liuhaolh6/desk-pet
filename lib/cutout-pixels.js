'use strict'

/**
 * Pure pixel helpers for the cutout pipeline (no Electron / no native modules).
 *
 * Alpha contract used everywhere in this file:
 *   - "straight" RGBA: colour channels are NOT multiplied by alpha.
 *   - all resampling happens in premultiplied space so fully transparent
 *     neighbours cannot bleed white/grey into the result.
 *
 * The M11 bug was: straight alpha was handed to `nativeImage.createFromBitmap`
 * (which expects premultiplied BGRA) and the resulting native image was
 * resized while it still had transparent pixels. Skia then fogged the
 * transparent area (alpha=0 -> ~200) and boosted the colour of partial
 * pixels (200,100,50,128 -> 255,199,100,128). We therefore never resize a
 * partially transparent native image: the final canvas is composed with the
 * functions below and encoded straight to PNG.
 */

const LOW_CUT = 2 / 255 // below this, force fully transparent (background purity)

/** Electron `getBitmap()` layout (BGRA) -> straight RGBA. */
function bgraToRGBA(bgra, width, height, premultiplied = true) {
  const n = width * height
  if (!bgra || bgra.length < n * 4) throw new Error('BGRA buffer too small')
  const out = Buffer.alloc(n * 4)
  for (let i = 0; i < n; i++) {
    const p = i * 4
    const b = bgra[p]
    const g = bgra[p + 1]
    const r = bgra[p + 2]
    const a = bgra[p + 3]
    if (a === 0) continue
    if (!premultiplied || a === 255) {
      out[p] = r
      out[p + 1] = g
      out[p + 2] = b
    } else {
      const s = 255 / a
      out[p] = Math.min(255, Math.round(r * s))
      out[p + 1] = Math.min(255, Math.round(g * s))
      out[p + 2] = Math.min(255, Math.round(b * s))
    }
    out[p + 3] = a
  }
  return out
}

/** Straight RGBA -> premultiplied BGRA (what createFromBitmap expects). */
function rgbaToPremultipliedBGRA(rgba, width, height) {
  const n = width * height
  if (!rgba || rgba.length < n * 4) throw new Error('RGBA buffer too small')
  const out = Buffer.alloc(n * 4)
  for (let i = 0; i < n; i++) {
    const p = i * 4
    const a = rgba[p + 3]
    const f = a / 255
    out[p] = Math.round(rgba[p + 2] * f)
    out[p + 1] = Math.round(rgba[p + 1] * f)
    out[p + 2] = Math.round(rgba[p] * f)
    out[p + 3] = a
  }
  return out
}

/** Multiply straight RGBA alpha by a 0..1 mask; zero RGB where fully clear. */
function applyMaskToRGBA(src, mask) {
  const out = Buffer.from(src)
  for (let i = 0; i < mask.length; i++) {
    const p = i * 4
    const a = Math.round(out[p + 3] * Math.max(0, Math.min(1, mask[i])))
    if (a <= 0) {
      out[p] = 0
      out[p + 1] = 0
      out[p + 2] = 0
      out[p + 3] = 0
    } else {
      out[p + 3] = a
    }
  }
  return out
}

function clampCoord(value, max) {
  return value < 0 ? 0 : value > max ? max : value
}

/** Bilinear sample of a straight-alpha image, interpolated premultiplied. */
function sampleStraight(src, width, height, x, y) {
  const xc = clampCoord(x, width - 1)
  const yc = clampCoord(y, height - 1)
  const x0 = Math.floor(xc)
  const y0 = Math.floor(yc)
  const x1 = x0 + 1 < width ? x0 + 1 : x0
  const y1 = y0 + 1 < height ? y0 + 1 : y0
  const fx = xc - x0
  const fy = yc - y0
  let r = 0
  let g = 0
  let b = 0
  let a = 0
  for (let j = 0; j < 2; j++) {
    const yy = j ? y1 : y0
    const wy = j ? fy : 1 - fy
    for (let k = 0; k < 2; k++) {
      const xx = k ? x1 : x0
      const weight = wy * (k ? fx : 1 - fx)
      if (weight <= 0) continue
      const p = (yy * width + xx) * 4
      const pa = src[p + 3]
      if (pa === 0) continue
      const w = weight * (pa / 255)
      r += src[p] * w
      g += src[p + 1] * w
      b += src[p + 2] * w
      a += w
    }
  }
  if (a <= 1e-6) return { r: 0, g: 0, b: 0, a: 0 }
  return {
    r: Math.min(255, Math.round(r / a)),
    g: Math.min(255, Math.round(g / a)),
    b: Math.min(255, Math.round(b / a)),
    a: Math.min(255, Math.round(a * 255)),
  }
}

/** Bilinear sample of a 0..1 mask. */
function sampleMask(mask, width, height, x, y) {
  const xc = clampCoord(x, width - 1)
  const yc = clampCoord(y, height - 1)
  const x0 = Math.floor(xc)
  const y0 = Math.floor(yc)
  const x1 = x0 + 1 < width ? x0 + 1 : x0
  const y1 = y0 + 1 < height ? y0 + 1 : y0
  const fx = xc - x0
  const fy = yc - y0
  const top = mask[y0 * width + x0] * (1 - fx) + mask[y0 * width + x1] * fx
  const bottom = mask[y1 * width + x0] * (1 - fx) + mask[y1 * width + x1] * fx
  return top * (1 - fy) + bottom * fy
}

/** Bilinear resize of a 0..1 mask. */
function resizeMask(mask, sw, sh, dw, dh) {
  const out = new Float32Array(dw * dh)
  const xr = sw / dw
  const yr = sh / dh
  for (let y = 0; y < dh; y++) {
    const sy = (y + 0.5) * yr - 0.5
    for (let x = 0; x < dw; x++) {
      out[y * dw + x] = sampleMask(mask, sw, sh, (x + 0.5) * xr - 0.5, sy)
    }
  }
  return out
}

/** Approximate RGB<->alpha-independent resize (used by tests/diagnostics). */
function resampleStraight(src, sw, sh, dw, dh) {
  const out = Buffer.alloc(dw * dh * 4)
  const xr = sw / dw
  const yr = sh / dh
  for (let y = 0; y < dh; y++) {
    const sy = (y + 0.5) * yr - 0.5
    for (let x = 0; x < dw; x++) {
      const sx = (x + 0.5) * xr - 0.5
      const px = sampleStraight(src, sw, sh, sx, sy)
      const p = (y * dw + x) * 4
      out[p] = px.r
      out[p + 1] = px.g
      out[p + 2] = px.b
      out[p + 3] = px.a
    }
  }
  return out
}

/**
 * Area-average downscale of straight RGBA, accumulated premultiplied so
 * transparent source pixels cannot wash colour into the result. Used for the
 * U2Net input and the working copy; falls back to bilinear when upscaling.
 */
function resizeAreaRGBA(src, sw, sh, dw, dh) {
  if (dw >= sw || dh >= sh) return resampleStraight(src, sw, sh, dw, dh)
  const out = Buffer.alloc(dw * dh * 4)
  const xr = sw / dw
  const yr = sh / dh
  for (let dy = 0; dy < dh; dy++) {
    const y0 = dy * yr
    const y1 = Math.min(sh, y0 + yr)
    const iy0 = Math.floor(y0)
    const iy1 = Math.min(sh, Math.ceil(y1))
    for (let dx = 0; dx < dw; dx++) {
      const x0 = dx * xr
      const x1 = Math.min(sw, x0 + xr)
      const ix0 = Math.floor(x0)
      const ix1 = Math.min(sw, Math.ceil(x1))
      let sumA = 0
      let sumR = 0
      let sumG = 0
      let sumB = 0
      for (let yy = iy0; yy < iy1; yy++) {
        const wy = Math.min(yy + 1, y1) - Math.max(yy, y0)
        if (wy <= 0) continue
        for (let xx = ix0; xx < ix1; xx++) {
          const wx = Math.min(xx + 1, x1) - Math.max(xx, x0)
          if (wx <= 0) continue
          const p = (yy * sw + xx) * 4
          const a = src[p + 3]
          if (!a) continue
          const f = (wx * wy) * (a / 255)
          sumA += f
          sumR += src[p] * f
          sumG += src[p + 1] * f
          sumB += src[p + 2] * f
        }
      }
      if (sumA <= 0) continue
      const area = (x1 - x0) * (y1 - y0)
      const o = (dy * dw + dx) * 4
      out[o] = Math.min(255, Math.round(sumR / sumA))
      out[o + 1] = Math.min(255, Math.round(sumG / sumA))
      out[o + 2] = Math.min(255, Math.round(sumB / sumA))
      out[o + 3] = Math.round(Math.min(1, sumA / area) * 255)
    }
  }
  return out
}

/** In-place-ish separable [1,2,1]/4 blur of a float alpha plane. */
function featherAlpha(alpha, width, height, passes = 2) {
  if (!passes) return alpha
  let src = Float32Array.from(alpha)
  let dst = new Float32Array(alpha.length)
  for (let pass = 0; pass < passes; pass++) {
    for (let y = 0; y < height; y++) {
      const row = y * width
      for (let x = 0; x < width; x++) {
        const l = row + (x > 0 ? x - 1 : 0)
        const r = row + (x + 1 < width ? x + 1 : width - 1)
        dst[row + x] = (src[l] + 2 * src[row + x] + src[r]) / 4
      }
    }
    const t = src
    src = dst
    dst = t
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        const u = (y > 0 ? y - 1 : 0) * width + x
        const d = (y + 1 < height ? y + 1 : height - 1) * width + x
        dst[y * width + x] = (src[u] + 2 * src[y * width + x] + src[d]) / 4
      }
    }
    const t2 = src
    src = dst
    dst = t2
  }
  alpha.set(src)
  return alpha
}

/**
 * Compose the final transparent canvas.
 *
 * `src` is straight RGBA at the working resolution, `mask` is a 0..1 plane at
 * the model resolution (squashed, same aspect as `src`). `bounds` is the crop
 * rectangle in working pixels; `fit` is the destination rect on the canvas
 * (see cutout-math.fitRect).
 */
function composeMaskedCanvas(options) {
  const {
    src, sw, sh, mask, mw, mh, bounds, fit, canvas = 610, feather = 2,
  } = options
  const out = Buffer.alloc(canvas * canvas * 4)
  const alpha = new Float32Array(canvas * canvas)
  const maskScaleX = mw / sw
  const maskScaleY = mh / sh
  const scale = fit.scale
  for (let dy = 0; dy < fit.height; dy++) {
    const sy = bounds.y + (dy + 0.5) / scale - 0.5
    const my = (sy + 0.5) * maskScaleY - 0.5
    for (let dx = 0; dx < fit.width; dx++) {
      const sx = bounds.x + (dx + 0.5) / scale - 0.5
      const mx = (sx + 0.5) * maskScaleX - 0.5
      // Sample colour even where the hard mask is 0: feathering spreads alpha
      // ~2px past the silhouette, and those pixels need the real image colour
      // or they become a black fringe on white/black backgrounds.
      const px = sampleStraight(src, sw, sh, sx, sy)
      if (px.a <= 0) continue
      const m = sampleMask(mask, mw, mh, mx, my)
      const di = (fit.y + dy) * canvas + fit.x + dx
      const p = di * 4
      out[p] = px.r
      out[p + 1] = px.g
      out[p + 2] = px.b
      const a = (px.a / 255) * m
      if (a >= LOW_CUT / 2) alpha[di] = a
    }
  }
  featherAlpha(alpha, canvas, canvas, feather)
  for (let i = 0; i < alpha.length; i++) {
    const a = alpha[i]
    if (a <= LOW_CUT) {
      const p = i * 4
      out[p] = 0
      out[p + 1] = 0
      out[p + 2] = 0
      out[p + 3] = 0
      continue
    }
    out[i * 4 + 3] = Math.round(Math.min(1, a) * 255)
  }
  return out
}

/** Alpha histogram bands used by the M12 acceptance metrics. */
function alphaBands(rgba) {
  const total = rgba.length / 4
  const hist = new Uint32Array(256)
  let sum = 0
  for (let i = 3; i < rgba.length; i += 4) {
    const a = rgba[i]
    hist[a]++
    sum += a
  }
  let zero = hist[0]
  let faint = 0
  let soft = 0
  let medium = 0
  let strong = 0
  let solid = 0
  for (let a = 1; a < 32; a++) faint += hist[a]
  for (let a = 32; a < 128; a++) soft += hist[a]
  for (let a = 128; a < 224; a++) medium += hist[a]
  for (let a = 224; a < 250; a++) strong += hist[a]
  for (let a = 250; a < 256; a++) solid += hist[a]
  const k = Math.min(total - 1, Math.floor(total * 0.95))
  let cumulative = 0
  let p95 = 255
  for (let a = 0; a < 256; a++) {
    cumulative += hist[a]
    if (cumulative > k) { p95 = a; break }
  }
  const pct = (n) => (n / total) * 100
  return {
    total,
    mean: sum / total,
    p95,
    zero, faint, soft, medium, strong, solid,
    zeroPct: pct(zero),
    faintPct: pct(faint),
    softPct: pct(soft),
    mediumPct: pct(medium),
    strongPct: pct(strong),
    solidPct: pct(solid),
    nonEdgeMidPct: pct(soft + medium), // 32..223 total
  }
}

module.exports = {
  LOW_CUT,
  bgraToRGBA,
  rgbaToPremultipliedBGRA,
  applyMaskToRGBA,
  sampleStraight,
  sampleMask,
  resizeMask,
  resampleStraight,
  resizeAreaRGBA,
  featherAlpha,
  composeMaskedCanvas,
  alphaBands,
}