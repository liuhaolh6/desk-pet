'use strict'

/**
 * Cutout evaluation CLI (P2-5).
 *
 *   node tools/cutout-eval.js                     # synthetic golden set
 *   node tools/cutout-eval.js --dir=.cutout-eval  # your own photos
 *   node tools/cutout-eval.js --model=u2netp-human --json
 *
 * For every image it runs the real pipeline (`lib/cutout.js`, ONNX on CPU) and
 * reports:
 *   IoU      – vs `<name>.mask.png` when a ground-truth mask is present
 *   edge     – mean |Δalpha| across the boundary (higher = crisper)
 *   ms       – wall time of the whole cutout call
 *   cover    – predicted foreground coverage
 *
 * Images without a mask still report edge/ms/cover, which is enough to compare
 * two models on your own photos.
 */

const fs = require('fs')
const path = require('path')
const png = require('../lib/png')
const cutout = require('../lib/cutout')
const models = require('../lib/cutout-model')
const metrics = require('../lib/cutout-eval')

function arg(name, fallback) {
  const hit = process.argv.slice(2).find((a) => a.startsWith('--' + name + '='))
  return hit ? hit.slice(name.length + 3) : fallback
}

function flag(name) {
  return process.argv.slice(2).includes('--' + name)
}

/** Nearest-neighbour mask resize (keeps 0/1 exact). */
function resizeMask(mask, sw, sh, dw, dh) {
  const out = new Uint8Array(dw * dh)
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.floor((y + 0.5) * sh / dh))
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, Math.floor((x + 0.5) * sw / dw))
      out[y * dw + x] = mask[sy * sw + sx]
    }
  }
  return out
}

function listImages(dir) {
  return fs.readdirSync(dir)
    .filter((f) => /\.png$/i.test(f) && !/\.mask\.png$/i.test(f))
    .sort()
    .map((f) => path.join(dir, f))
}

async function main() {
  const dir = path.resolve(arg('dir', path.join(__dirname, '..', 'tests', 'fixtures', 'cutout-golden')))
  const modelId = arg('model', '')
  const asJson = flag('json')
  const limit = Number(arg('limit', '0')) || 0
  if (modelId) process.env.DESKPET_CUTOUT_MODEL_ID = modelId

  const resolved = models.resolve({ appDir: path.join(__dirname, '..'), id: modelId || undefined, resourcesPath: process.resourcesPath })
  if (!resolved) {
    console.error('模型没找到，先看 `node tools/cutout-eval.js --missing`')
    process.exitCode = 2
    return
  }
  const images = listImages(dir).slice(0, limit || undefined)
  if (!images.length) {
    console.error('目录里没有 png：' + dir)
    process.exitCode = 2
    return
  }

  const rows = []
  for (const file of images) {
    const name = path.basename(file, '.png')
    const decoded = png.decodePNG(fs.readFileSync(file))
    const t0 = Date.now()
    let result
    try {
      result = await cutout.cutoutImageRGBA(decoded.data, decoded.width, decoded.height, {})
    } catch (err) {
      rows.push({ name, error: err && err.code ? err.code : String(err && err.message || err) })
      continue
    }
    const ms = Date.now() - t0
    const maskPng = png.decodePNG(result.maskPng)
    const predMask = metrics.maskFromImage(maskPng.data, 127)
    const edge = metrics.edgeSharpness(metrics.greyChannel(maskPng.data), maskPng.width, maskPng.height)
    const row = {
      name,
      ms,
      edge,
      coverage: result.coverage,
      size: decoded.width + 'x' + decoded.height,
      maskSize: maskPng.width + 'x' + maskPng.height,
    }
    const refFile = file.replace(/\.png$/i, '.mask.png')
    if (fs.existsSync(refFile)) {
      const ref = png.decodePNG(fs.readFileSync(refFile))
      const refMask = metrics.maskFromImage(ref.data, 127)
      const refScaled = ref.width === maskPng.width && ref.height === maskPng.height
        ? refMask
        : resizeMask(refMask, ref.width, ref.height, maskPng.width, maskPng.height)
      row.iou = metrics.iou(predMask, refScaled)
    }
    rows.push(row)
  }

  const summary = metrics.summarize(rows)
  const payload = { dir, model: resolved.id, modelBytes: resolved.bytes, rows, summary }
  if (asJson) {
    console.log(JSON.stringify(payload, null, 2))
    return
  }
  console.log('模型 ' + resolved.id + '（' + (resolved.bytes / 1048576).toFixed(1) + ' MB）  目录 ' + dir)
  console.log('')
  console.log('  #  图片                 尺寸         ms    IoU    edge   cover')
  for (const row of rows) {
    const iou = Number.isFinite(row.iou) ? row.iou.toFixed(3) : ' -  '
    const edge = Number.isFinite(row.edge) ? row.edge.toFixed(0) : ' - '
    if (row.error) {
      console.log('  .  ' + row.name.padEnd(20) + ' 失败：' + row.error)
      continue
    }
    console.log('  ' + String(rows.indexOf(row) + 1).padStart(2) + ' ' + row.name.padEnd(20) + ' ' +
      row.size.padEnd(10) + ' ' + String(row.ms).padStart(4) + '  ' + iou.padEnd(6) + ' ' +
      edge.padStart(5) + '  ' + (Number.isFinite(row.coverage) ? (row.coverage * 100).toFixed(1) + '%' : ' - '))
  }
  console.log('')
  console.log('汇总：' + summary.count + ' 张，IoU 均值 ' + summary.iouMean.toFixed(3) +
    '（最低 ' + summary.iouMin.toFixed(3) + '），耗时 P50 ' + summary.msP50 + 'ms / P95 ' + summary.msP95 +
    'ms，edge 均值 ' + summary.edgeMean.toFixed(0))
  if (!summary.iouCount) console.log('（没有 .mask.png，因此没有 IoU——只比耗时与边缘）')
}

main().catch((err) => {
  console.error(err && err.stack || err)
  process.exitCode = 1
})