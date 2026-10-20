'use strict'

const fs = require('fs')
const path = require('path')
const math = require('./cutout-math')
const pixels = require('./cutout-pixels')
const png = require('./png')

const INPUT_SIZE = 320
const MEAN = [0.485, 0.456, 0.406]
const STD = [0.229, 0.224, 0.225]
const WORK_MAX = 1200

// Absolute score thresholds. U2Net human-seg ends in a sigmoid, so these are
// meaningful across photos; the old relative min/max stretch is gone.
const MASK_LOW = 0.22
const MASK_HIGH = 0.55
const MIN_COMPONENT_RATIO = 0.01
const MIN_COMPONENT_PIXELS = 16
const COVERAGE_MIN = 0.02
const COVERAGE_MAX = 0.9
const FEATHER_PASSES = 2

// Electron's getBitmap()/toBitmap() return premultiplied BGRA (verified on
// Electron 44 / Windows: straight (200,100,50,128) comes back as 25,50,100,128).
const BITMAP_PREMULTIPLIED = true

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

function fail(code, message) {
  return Object.assign(new Error(message || code), { code })
}

function workingSizeOf(width, height) {
  const longest = Math.max(width, height)
  if (!longest || longest <= WORK_MAX) return { width, height, scale: 1 }
  const scale = WORK_MAX / longest
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  }
}

/** U2Net input tensor from straight RGBA. Aspect is squashed to 320x320 (P1). */
function buildInput(rgba, width, height) {
  const small = (width === INPUT_SIZE && height === INPUT_SIZE)
    ? rgba
    : pixels.resizeAreaRGBA(rgba, width, height, INPUT_SIZE, INPUT_SIZE)
  const n = INPUT_SIZE * INPUT_SIZE
  const input = new Float32Array(3 * n)
  for (let i = 0; i < n; i++) {
    const p = i * 4
    input[i] = (small[p] / 255 - MEAN[0]) / STD[0]
    input[n + i] = (small[p + 1] / 255 - MEAN[1]) / STD[1]
    input[2 * n + i] = (small[p + 2] / 255 - MEAN[2]) / STD[2]
  }
  return input
}

/**
 * Pure cutout core: straight RGBA in, 610x610 straight-alpha PNG out.
 *
 * This deliberately has no Electron dependency so the whole mask -> alpha ->
 * canvas pipeline can be tested and diagnosed from plain Node. The caller
 * decodes the photo (nativeImage or lib/png) and hands us pixels.
 */
async function cutoutImageRGBA(rgba, width, height, options = {}) {
  const startedAt = Date.now()
  let stageAt = startedAt
  const timings = {}
  const mark = (name) => { const now = Date.now(); timings[name] = now - stageAt; stageAt = now }
  const canvas = Number(options.canvas) || 610

  const work = workingSizeOf(width, height)
  let working = rgba
  if (work.scale !== 1) {
    working = pixels.resizeAreaRGBA(rgba, width, height, work.width, work.height)
  }
  mark('resizeMs')
  const input = buildInput(working, work.width, work.height)
  mark('preprocessMs')

  const session = await getSession()
  const ort = require('onnxruntime-node')
  const tensor = new ort.Tensor('float32', input, [1, 3, INPUT_SIZE, INPUT_SIZE])
  const outputs = await session.run({ [session.inputNames[0]]: tensor })
  const result = outputs[session.outputNames[0]]
  if (!result || !result.data) throw fail('NO_OUTPUT', '模型没有返回蒙版')

  const dims = Array.isArray(result.dims) ? result.dims.map(Number) : []
  const expected = [1, 1, INPUT_SIZE, INPUT_SIZE]
  if (dims.length !== 4 || dims.some((v, i) => v !== expected[i])) {
    throw fail('BAD_OUTPUT_SHAPE', '模型输出形状异常: ' + JSON.stringify(dims))
  }
  const scores = math.normalizeMask(result.data, INPUT_SIZE * INPUT_SIZE)
  if (!scores || scores.length !== INPUT_SIZE * INPUT_SIZE) {
    throw fail('BAD_OUTPUT_SHAPE', '模型输出长度异常: ' + (result.data.length || 0))
  }
  mark('inferenceMs')

  let mask = math.hysteresisMask(scores, INPUT_SIZE, INPUT_SIZE, MASK_LOW, MASK_HIGH)
  mask = math.openMask(mask, INPUT_SIZE, INPUT_SIZE)
  mask = math.closeMask(mask, INPUT_SIZE, INPUT_SIZE)
  let foreground = 0
  for (let i = 0; i < mask.length; i++) if (mask[i]) foreground++
  if (foreground > 0) {
    mask = math.fillHoles(mask, INPUT_SIZE, INPUT_SIZE, Math.max(32, Math.round(foreground * 0.01)))
  }
  const keep = math.retainComponents(mask, INPUT_SIZE, INPUT_SIZE, {
    minRatio: MIN_COMPONENT_RATIO,
    minPixels: MIN_COMPONENT_PIXELS,
  })
  if (!keep) throw fail('NO_PERSON', '没有检测到清晰人像')
  mark('maskMs')

  const coverage = math.alphaCoverage(keep, 0.5)
  if (coverage < COVERAGE_MIN) {
    throw Object.assign(fail('NO_PERSON', '没有检测到清晰人像'), { coverage })
  }
  if (coverage > COVERAGE_MAX) {
    throw Object.assign(fail('OVER_SEGMENTED', '主体覆盖画面过多，可能把背景当成了人像'), { coverage })
  }

  const bounds320 = math.maskBounds(keep, INPUT_SIZE, INPUT_SIZE, 0.5)
  if (!bounds320 || bounds320.width < 10 || bounds320.height < 10) {
    throw Object.assign(fail('NO_PERSON', '人像区域过小'), { coverage })
  }

  const scaleX = work.width / INPUT_SIZE
  const scaleY = work.height / INPUT_SIZE
  const pad = 8
  const x = Math.max(0, Math.floor(bounds320.x * scaleX) - pad)
  const y = Math.max(0, Math.floor(bounds320.y * scaleY) - pad)
  const right = Math.min(work.width, Math.ceil((bounds320.x + bounds320.width) * scaleX) + pad)
  const bustBottom = Math.min(
    work.height,
    Math.max(y + 120, Math.round(work.height * 0.66)),
  )
  const bottom = Math.min(
    work.height,
    Math.min(Math.ceil((bounds320.y + bounds320.height) * scaleY) + pad, bustBottom),
  )
  const bounds = { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) }

  const fit = math.fitRect(bounds.width, bounds.height, canvas, 0.94, 6)
  const composed = pixels.composeMaskedCanvas({
    src: working,
    sw: work.width,
    sh: work.height,
    mask: keep,
    mw: INPUT_SIZE,
    mh: INPUT_SIZE,
    bounds,
    fit,
    canvas,
    feather: FEATHER_PASSES,
  })
  mark('composeMs')
  const bands = pixels.alphaBands(composed)
  const pngBuffer = png.encodePNG(canvas, canvas, composed)
  mark('encodeMs')

  return {
    png: pngBuffer,
    fit,
    coverage,
    bands,
    ms: Date.now() - startedAt,
    timings,
    source: { width, height },
    working: { width: work.width, height: work.height },
    cutout: { width: bounds.width, height: bounds.height },
    mask: { size: INPUT_SIZE, coverage },
  }
}

/**
 * Electron-facing wrapper: decode the native image to straight RGBA and run
 * the pure core. Opaque photos are resized by Skia (fast C++) and then read
 * once; if the image actually carries transparency we fall back to decoding the
 * full frame and resizing in JS, because resizing a partially transparent
 * nativeImage is exactly what fogged the M11 output.
 */
async function cutoutImage(nativeImage, image, options = {}) {
  const decodeStarted = Date.now()
  const size = image.getSize()
  const target = workingSizeOf(size.width, size.height)
  let rgba
  let width = size.width
  let height = size.height
  if (target.scale === 1) {
    rgba = pixels.bgraToRGBA(image.getBitmap(), size.width, size.height, BITMAP_PREMULTIPLIED)
  } else {
    const working = image.resize({ width: target.width, height: target.height, quality: 'best' })
    const ws = working.getSize()
    const bitmap = working.getBitmap()
    let transparent = false
    for (let i = 3; i < bitmap.length; i += 4) {
      if (bitmap[i] !== 255) { transparent = true; break }
    }
    if (transparent) {
      const full = pixels.bgraToRGBA(image.getBitmap(), size.width, size.height, BITMAP_PREMULTIPLIED)
      rgba = pixels.resizeAreaRGBA(full, size.width, size.height, target.width, target.height)
    } else {
      rgba = pixels.bgraToRGBA(bitmap, ws.width, ws.height, BITMAP_PREMULTIPLIED)
    }
    width = target.width
    height = target.height
  }
  const preTimings = { decodeMs: Date.now() - decodeStarted }
  const result = await cutoutImageRGBA(rgba, width, height, options)
  result.pngBuffer = result.png
  result.timings.decodeMs = preTimings.decodeMs
  if (typeof result.ms === 'number') {
    result.ms += preTimings.decodeMs
  }
  if (nativeImage && typeof nativeImage.createFromBuffer === 'function') {
    result.image = nativeImage.createFromBuffer(result.png)
  }
  return result
}

function scaleOnly(image, max = 610) {
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

function resetSession() {
  sessionPromise = null
}

module.exports = {
  cutoutImage,
  cutoutImageRGBA,
  scaleOnly,
  modelPath,
  resetSession,
  buildInput,
  COVERAGE_MIN,
  COVERAGE_MAX,
  MASK_LOW,
  MASK_HIGH,
  INPUT_SIZE,
  WORK_MAX,
}