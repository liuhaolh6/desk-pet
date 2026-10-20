'use strict'

const fs = require('fs')
const path = require('path')
const math = require('./cutout-math')

const INPUT_SIZE = 320
const MEAN = [0.485, 0.456, 0.406]
const STD = [0.229, 0.224, 0.225]
const WORK_MAX = 1200

let sessionPromise = null

function modelPath() {
  const candidates = []
  if (process.env.DESKPET_CUTOUT_MODEL) candidates.push(process.env.DESKPET_CUTOUT_MODEL)
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, 'models', 'u2net_human_seg.onnx'))
  candidates.push(path.join(__dirname, '..', 'assets', 'models', 'u2net_human_seg.onnx'))
  return candidates.find((p) => { try { return fs.existsSync(p) && fs.statSync(p).size > 1024 * 1024 } catch (err) { return false } }) || ''
}

function getSession() {
  if (!sessionPromise) {
    const resolved = modelPath()
    if (!resolved) return Promise.reject(Object.assign(new Error('MODEL_MISSING'), { code: 'MODEL_MISSING' }))
    sessionPromise = Promise.resolve().then(() => {
      const ort = require('onnxruntime-node')
      return ort.InferenceSession.create(resolved, { executionProviders: ['cpu'] })
    }).catch((err) => {
      sessionPromise = null
      throw Object.assign(new Error('MODEL_LOAD_FAILED: ' + (err && err.message ? err.message : err)), { code: 'MODEL_LOAD_FAILED' })
    })
  }
  return sessionPromise
}

function resizeToMax(image, max) {
  const size = image.getSize()
  const longest = Math.max(size.width, size.height)
  if (!longest || longest <= max) return image
  const scale = max / longest
  return image.resize({
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
    quality: 'best',
  })
}

function buildInput(image) {
  const small = image.resize({ width: INPUT_SIZE, height: INPUT_SIZE, quality: 'best' })
  const bitmap = small.getBitmap()
  const n = INPUT_SIZE * INPUT_SIZE
  const input = new Float32Array(3 * n)
  for (let i = 0; i < n; i++) {
    const p = i * 4
    input[i] = (bitmap[p + 2] / 255 - MEAN[0]) / STD[0]
    input[n + i] = (bitmap[p + 1] / 255 - MEAN[1]) / STD[1]
    input[2 * n + i] = (bitmap[p] / 255 - MEAN[2]) / STD[2]
  }
  return input
}

function resizeAlpha(src, sw, sh, dw, dh) {
  const out = new Float32Array(dw * dh)
  const xr = sw / dw
  const yr = sh / dh
  for (let y = 0; y < dh; y++) {
    const sy = Math.max(0, Math.min(sh - 1, (y + 0.5) * yr - 0.5))
    const y0 = Math.floor(sy)
    const y1 = Math.min(sh - 1, y0 + 1)
    const fy = sy - y0
    const row0 = y0 * sw
    const row1 = y1 * sw
    const rowOut = y * dw
    for (let x = 0; x < dw; x++) {
      const sx = Math.max(0, Math.min(sw - 1, (x + 0.5) * xr - 0.5))
      const x0 = Math.floor(sx)
      const x1 = Math.min(sw - 1, x0 + 1)
      const fx = sx - x0
      const a = src[row0 + x0] * (1 - fx) + src[row0 + x1] * fx
      const b = src[row1 + x0] * (1 - fx) + src[row1 + x1] * fx
      out[rowOut + x] = a * (1 - fy) + b * fy
    }
  }
  return out
}

function applyAlpha(image, mask) {
  const size = image.getSize()
  const src = image.getBitmap()
  const out = Buffer.alloc(src.length)
  for (let i = 0; i < mask.length; i++) {
    const p = i * 4
    const a = Math.round((src[p + 3] / 255) * mask[i] * 255)
    out[p] = src[p]
    out[p + 1] = src[p + 1]
    out[p + 2] = src[p + 2]
    out[p + 3] = Math.max(0, Math.min(255, a))
  }
  return { buffer: out, width: size.width, height: size.height }
}

function composeCanvas(nativeImage, image, canvas = 610) {
  const size = image.getSize()
  const fit = math.fitRect(size.width, size.height, canvas, 0.94, 6)
  const resized = image.resize({ width: fit.width, height: fit.height, quality: 'best' })
  const src = resized.getBitmap()
  const out = Buffer.alloc(canvas * canvas * 4)
  for (let y = 0; y < fit.height; y++) {
    const from = y * fit.width * 4
    const to = ((fit.y + y) * canvas + fit.x) * 4
    src.copy(out, to, from, from + fit.width * 4)
  }
  return {
    image: nativeImage.createFromBitmap(out, { width: canvas, height: canvas, scaleFactor: 1 }),
    fit,
  }
}

/**
 * Run offline U2Net human segmentation and return a 610x610 transparent PNG
 * image object. `nativeImage` is Electron's nativeImage module (injected so
 * this file stays usable outside the main-process global).
 */
async function cutoutImage(nativeImage, image, options = {}) {
  const canvas = Number(options.canvas) || 610
  const working = resizeToMax(image, WORK_MAX)
  const workingSize = working.getSize()
  const input = buildInput(working)
  const session = await getSession()
  const ort = require('onnxruntime-node')
  const tensor = new ort.Tensor('float32', input, [1, 3, INPUT_SIZE, INPUT_SIZE])
  const outputs = await session.run({ [session.inputNames[0]]: tensor })
  const result = outputs[session.outputNames[0]]
  if (!result || !result.data) throw Object.assign(new Error('NO_OUTPUT'), { code: 'NO_OUTPUT' })

  let alpha = math.normalizeMask(result.data, INPUT_SIZE * INPUT_SIZE, 0.32, 1.6)
  if (!alpha) throw Object.assign(new Error('NO_PERSON'), { code: 'NO_PERSON' })
  const keep = math.largestComponent(alpha, INPUT_SIZE, INPUT_SIZE, 0.45)
  if (keep) alpha = alpha.map((v, i) => (keep[i] ? v : 0))
  const coverage = math.alphaCoverage(alpha, 0.5)
  if (coverage < 0.003) throw Object.assign(new Error('NO_PERSON'), { code: 'NO_PERSON' })

  const mask = resizeAlpha(alpha, INPUT_SIZE, INPUT_SIZE, workingSize.width, workingSize.height)
  // Suppress the low-alpha background halo that survives bilinear resizing.
  for (let i = 0; i < mask.length; i++) {
    const a = mask[i] * mask[i]
    mask[i] = a < 0.45 ? 0 : a
  }
  let bounds = math.maskBounds(mask, workingSize.width, workingSize.height, 0.5)
  if (!bounds || bounds.width < 12 || bounds.height < 12) {
    throw Object.assign(new Error('NO_PERSON'), { code: 'NO_PERSON' })
  }
  const pad = 8
  const x = Math.max(0, bounds.x - pad)
  const y = Math.max(0, bounds.y - pad)
  const right = Math.min(workingSize.width, bounds.x + bounds.width + pad)
  const bustBottom = Math.min(
    workingSize.height,
    Math.max(bounds.y + 120, Math.round(workingSize.height * 0.66)),
  )
  const bottom = Math.min(workingSize.height, Math.min(bounds.y + bounds.height + pad, bustBottom))
  bounds = { x, y, width: right - x, height: bottom - y }

  const masked = applyAlpha(working, mask)
  const maskedImage = nativeImage.createFromBitmap(masked.buffer, {
    width: masked.width,
    height: masked.height,
    scaleFactor: 1,
  })
  const cropped = maskedImage.crop(bounds)
  const composed = composeCanvas(nativeImage, cropped, canvas)
  return {
    image: composed.image,
    fit: composed.fit,
    coverage,
    source: { width: image.getSize().width, height: image.getSize().height },
    cutout: { width: bounds.width, height: bounds.height },
  }
}

function scaleOnly(image, max = 610) {
  return resizeToMax(image, max)
}

function resetSession() {
  sessionPromise = null
}

module.exports = { cutoutImage, scaleOnly, modelPath, resetSession, resizeToMax, resizeAlpha }
