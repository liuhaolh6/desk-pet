'use strict'

const fs = require('fs')
const path = require('path')
const math = require('./cutout-math')
const pixels = require('./cutout-pixels')
const png = require('./png')
const models = require('./cutout-model')

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

// A/B result on the available 1 real + 2 synthetic images: letterbox keeps the
// subject's aspect and removes the squash-induced mask bloat, with no loss of
// subject opacity. Keep the switch so the choice is testable and reversible.
const DEFAULT_PREPROCESS = 'letterbox'

// Electron's getBitmap()/toBitmap() return premultiplied BGRA (verified on
// Electron 44 / Windows: straight (200,100,50,128) comes back as 25,50,100,128).
const BITMAP_PREMULTIPLIED = true

let sessionPromise = null

// P2-5: model choice is data, not code. `lib/cutout-model.js` owns the
// registry; here we only resolve it for this process.
function modelPath() {
  const hit = models.resolve({
    env: process.env.DESKPET_CUTOUT_MODEL,
    resourcesPath: process.resourcesPath,
    appDir: path.join(__dirname, '..'),
    id: process.env.DESKPET_CUTOUT_MODEL_ID || undefined,
  })
  return hit ? hit.path : ''
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

/**
 * Build the 320x320 model input.
 *
 * `squash` stretches the photo to a square (M11 behaviour). `letterbox` keeps
 * the aspect ratio, pads with black, and remembers the valid box so the mask
 * can be cropped and un-squashed afterwards. The A/B decision lives in
 * DEFAULT_PREPROCESS; see M12-NOTES.md.
 */
function buildModelInput(rgba, width, height, mode = DEFAULT_PREPROCESS) {
  let plane
  let box = { x: 0, y: 0, width: INPUT_SIZE, height: INPUT_SIZE }
  let used = 'squash'
  if (mode === 'letterbox' && width !== height) {
    const scale = Math.min(INPUT_SIZE / width, INPUT_SIZE / height)
    const dw = Math.max(1, Math.round(width * scale))
    const dh = Math.max(1, Math.round(height * scale))
    const ox = Math.floor((INPUT_SIZE - dw) / 2)
    const oy = Math.floor((INPUT_SIZE - dh) / 2)
    const small = pixels.resizeAreaRGBA(rgba, width, height, dw, dh)
    plane = Buffer.alloc(INPUT_SIZE * INPUT_SIZE * 4) // black padding
    for (let y = 0; y < dh; y++) {
      small.copy(plane, ((oy + y) * INPUT_SIZE + ox) * 4, y * dw * 4, (y + 1) * dw * 4)
    }
    box = { x: ox, y: oy, width: dw, height: dh }
    used = 'letterbox'
  } else if (width === INPUT_SIZE && height === INPUT_SIZE) {
    plane = rgba
  } else {
    plane = pixels.resizeAreaRGBA(rgba, width, height, INPUT_SIZE, INPUT_SIZE)
  }
  const n = INPUT_SIZE * INPUT_SIZE
  const input = new Float32Array(3 * n)
  for (let i = 0; i < n; i++) {
    const p = i * 4
    input[i] = (plane[p] / 255 - MEAN[0]) / STD[0]
    input[n + i] = (plane[p + 1] / 255 - MEAN[1]) / STD[1]
    input[2 * n + i] = (plane[p + 2] / 255 - MEAN[2]) / STD[2]
  }
  return { input, box, mode: used }
}

/** Crop the valid letterbox area and stretch it back to 320x320 for mapping. */
function scoresFromBox(scores, box) {
  if (!box || (box.x === 0 && box.y === 0 && box.width === INPUT_SIZE && box.height === INPUT_SIZE)) {
    return scores
  }
  const cropped = new Float32Array(box.width * box.height)
  for (let y = 0; y < box.height; y++) {
    for (let x = 0; x < box.width; x++) {
      cropped[y * box.width + x] = scores[(box.y + y) * INPUT_SIZE + box.x + x]
    }
  }
  return pixels.resizeMask(cropped, box.width, box.height, INPUT_SIZE, INPUT_SIZE)
}

/** Backwards-compatible helper used by tests/diagnostics. */
function buildInput(rgba, width, height, mode) {
  return buildModelInput(rgba, width, height, mode).input
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
  const preprocess = options.preprocess === 'squash' || options.preprocess === 'letterbox'
    ? options.preprocess
    : DEFAULT_PREPROCESS
  const modelInput = buildModelInput(working, work.width, work.height, preprocess)
  mark('preprocessMs')

  const session = await getSession()
  const ort = require('onnxruntime-node')
  const tensor = new ort.Tensor('float32', modelInput.input, [1, 3, INPUT_SIZE, INPUT_SIZE])
  const outputs = await session.run({ [session.inputNames[0]]: tensor })
  const result = outputs[session.outputNames[0]]
  if (!result || !result.data) throw fail('NO_OUTPUT', '模型没有返回蒙版')

  const dims = Array.isArray(result.dims) ? result.dims.map(Number) : []
  const expected = [1, 1, INPUT_SIZE, INPUT_SIZE]
  if (dims.length !== 4 || dims.some((v, i) => v !== expected[i])) {
    throw fail('BAD_OUTPUT_SHAPE', '模型输出形状异常: ' + JSON.stringify(dims))
  }
  let scores = math.normalizeMask(result.data, INPUT_SIZE * INPUT_SIZE)
  if (!scores || scores.length !== INPUT_SIZE * INPUT_SIZE) {
    throw fail('BAD_OUTPUT_SHAPE', '模型输出长度异常: ' + (result.data.length || 0))
  }
  scores = scoresFromBox(scores, modelInput.box)
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

  // Diagnostic "mask" view: white where kept, black elsewhere, fully opaque.
  const maskPreview = Buffer.alloc(INPUT_SIZE * INPUT_SIZE * 4)
  for (let i = 0; i < keep.length; i++) {
    const v = keep[i] ? 255 : 0
    const p = i * 4
    maskPreview[p] = v
    maskPreview[p + 1] = v
    maskPreview[p + 2] = v
    maskPreview[p + 3] = 255
  }
  const maskPng = png.encodePNG(INPUT_SIZE, INPUT_SIZE, maskPreview)

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
    decontaminate: options.decontaminate,
    timings,
  })
  mark('composeMs')
  const bands = pixels.alphaBands(composed)
  const pngBuffer = png.encodePNG(canvas, canvas, composed)
  mark('encodeMs')

  return {
    png: pngBuffer,
    maskPng,
    preprocess: modelInput.mode,
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
 * Decode a native image to a working-size straight RGBA buffer. Opaque photos
 * are resized by Skia (fast C++) and read once; if the image carries
 * transparency we decode the full frame and resize in JS, because resizing a
 * partially transparent nativeImage is what fogged the M11 output.
 *
 * Exposed separately so the main process can hand pixels to a utility process
 * (P1-5) without duplicating this logic.
 */
function loadWorkingRGBA(nativeImage, image) {
  const size = image.getSize()
  const target = workingSizeOf(size.width, size.height)
  if (target.scale === 1) {
    return {
      rgba: pixels.bgraToRGBA(image.getBitmap(), size.width, size.height, BITMAP_PREMULTIPLIED),
      width: size.width,
      height: size.height,
    }
  }
  const working = image.resize({ width: target.width, height: target.height, quality: 'best' })
  const ws = working.getSize()
  const bitmap = working.getBitmap()
  let transparent = false
  for (let i = 3; i < bitmap.length; i += 4) {
    if (bitmap[i] !== 255) { transparent = true; break }
  }
  const rgba = transparent
    ? pixels.resizeAreaRGBA(
      pixels.bgraToRGBA(image.getBitmap(), size.width, size.height, BITMAP_PREMULTIPLIED),
      size.width,
      size.height,
      target.width,
      target.height,
    )
    : pixels.bgraToRGBA(bitmap, ws.width, ws.height, BITMAP_PREMULTIPLIED)
  return { rgba, width: target.width, height: target.height }
}

/**
 * Electron-facing wrapper: decode the native image and run the pure core.
 */
async function cutoutImage(nativeImage, image, options = {}) {
  const decodeStarted = Date.now()
  const { rgba, width, height } = loadWorkingRGBA(nativeImage, image)
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
  loadWorkingRGBA,
  scaleOnly,
  modelPath,
  resetSession,
  buildInput,
  buildModelInput,
  scoresFromBox,
  COVERAGE_MIN,
  COVERAGE_MAX,
  MASK_LOW,
  MASK_HIGH,
  INPUT_SIZE,
  WORK_MAX,
  DEFAULT_PREPROCESS,
}