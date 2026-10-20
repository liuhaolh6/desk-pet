#!/usr/bin/env node
/**
 * Cutout diagnostics / alpha acceptance metrics.
 *
 *   # analyse an existing PNG (plain Node, no Electron)
 *   node tools/cutout-diag.js --png dist/.../roles/rxxx.png
 *
 *   # compose-only: feed a fixture image + ground-truth mask through the
 *   # same mask -> alpha -> canvas path as the app (no model needed)
 *   node tools/cutout-diag.js --fake tools/fixtures/synthetic-portrait.png \
 *     --mask tools/fixtures/synthetic-portrait-mask.png --out .tmp-verify/fake.png --assert
 *
 *   # real model run (needs Electron because the input is decoded with nativeImage)
 *   electron tools/cutout-diag.js "C:/path/photo.jpg" --out .tmp-verify/out.png --assert
 *
 * Options: --gt <mask.png> (fake mode only), --canvas 610, --feather 2,
 *          --json, --assert, --out <file>
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const png = require('../lib/png')
const pixels = require('../lib/cutout-pixels')
const math = require('../lib/cutout-math')

function parseArgs(argv) {
  const out = { rest: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--png') out.png = argv[++i]
    else if (a === '--input') out.input = argv[++i]
    else if (a === '--decode') {
      const next = argv[i + 1]
      out.decode = next && !next.startsWith('--') ? argv[++i] : (process.env.DESKPET_CUTOUT_INPUT || '')
    }
    else if (a === '--fake') out.fake = argv[++i]
    else if (a === '--mask') out.mask = argv[++i]
    else if (a === '--gt') out.gt = argv[++i]
    else if (a === '--expect') out.expect = argv[++i]
    else if (a === '--out') out.out = argv[++i]
    else if (a === '--preprocess') out.preprocess = argv[++i]
    else if (a === '--no-decontaminate') out.decontaminate = false
    else if (a === '--mask-out') out.maskOut = argv[++i]
    else if (a === '--canvas') out.canvas = Number(argv[++i]) || 610
    else if (a === '--feather') out.feather = Number(argv[++i])
    else if (a === '--json') out.json = true
    else if (a === '--assert') out.assert = true
    else if (a === '--help' || a === '-h') out.help = true
    else if (!a.startsWith('--')) out.rest.push(a)
  }
  return out
}

function readPNG(file) {
  return png.decodePNG(fs.readFileSync(file))
}

function count(mask) {
  let n = 0
  for (let i = 0; i < mask.length; i++) n += mask[i] ? 1 : 0
  return n
}

function binary(rgba, threshold = 127) {
  const out = new Uint8Array(rgba.length / 4)
  for (let i = 0; i < out.length; i++) out[i] = rgba[i * 4 + 3] > threshold ? 1 : 0
  return out
}

function negate(mask) {
  const out = new Uint8Array(mask.length)
  for (let i = 0; i < mask.length; i++) out[i] = mask[i] ? 0 : 1
  return out
}

function erodeN(mask, w, h, n) {
  let out = mask
  for (let i = 0; i < n; i++) out = math.erode(out, w, h)
  return out
}

function dilateN(mask, w, h, n) {
  let out = mask
  for (let i = 0; i < n; i++) out = math.dilate(out, w, h)
  return out
}

function percentile(sorted, p) {
  if (!sorted.length) return 0
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
}

function regionStats(rgba, region) {
  const values = []
  let sum = 0
  let ge250 = 0
  let mid = 0
  let zero = 0
  for (let i = 0; i < region.length; i++) {
    if (!region[i]) continue
    const a = rgba[i * 4 + 3]
    values.push(a)
    sum += a
    if (a >= 250) ge250++
    if (a >= 32 && a <= 223) mid++
    if (a === 0) zero++
  }
  if (!values.length) return { count: 0 }
  values.sort((x, y) => x - y)
  return {
    count: values.length,
    mean: sum / values.length,
    p95: percentile(values, 0.95),
    min: values[0],
    max: values[values.length - 1],
    ge250Pct: (ge250 / values.length) * 100,
    midPct: (mid / values.length) * 100,
    zeroPct: (zero / values.length) * 100,
  }
}

function analyze(rgba, width, height, gt) {
  const total = width * height
  const bands = pixels.alphaBands(rgba)
  const fg = binary(rgba, 127)
  const coverage = count(fg) / total
  const core = erodeN(fg, width, height, 3)
  const farBg = negate(dilateN(fg, width, height, 3))
  const boundary = new Uint8Array(total)
  const eroded = math.erode(fg, width, height)
  for (let i = 0; i < total; i++) boundary[i] = fg[i] !== eroded[i] ? 1 : 0
  const band = dilateN(boundary, width, height, 4)
  let mid = 0
  let midNonEdge = 0
  for (let i = 0; i < total; i++) {
    const a = rgba[i * 4 + 3]
    if (a >= 32 && a <= 223) {
      mid++
      if (!band[i]) midNonEdge++
    }
  }
  const boundaryPixels = count(boundary)
  const metrics = {
    size: [width, height],
    coverage,
    bands: {
      zeroPct: round(bands.zeroPct),
      faintPct: round(bands.faintPct),
      softPct: round(bands.softPct),
      mediumPct: round(bands.mediumPct),
      strongPct: round(bands.strongPct),
      solidPct: round(bands.solidPct),
      midPct: round(bands.nonEdgeMidPct),
      mean: round(bands.mean),
      p95: bands.p95,
    },
    self: {
      farBackground: regionStats(rgba, farBg),
      core: regionStats(rgba, core),
      nonEdgeMidPct: round((midNonEdge / total) * 100),
      edge: {
        boundaryPixels,
        midPixels: mid,
        avgWidthPx: boundaryPixels ? round(mid / boundaryPixels) : 0,
      },
    },
    gt: null,
  }
  if (gt) {
    const gtFg = gt
    const gtBgFar = negate(dilateN(gtFg, width, height, 3))
    const gtCore = erodeN(gtFg, width, height, 3)
    const gtBoundary = new Uint8Array(total)
    const gtEroded = math.erode(gtFg, width, height)
    for (let i = 0; i < total; i++) gtBoundary[i] = gtFg[i] !== gtEroded[i] ? 1 : 0
    const gtBand = dilateN(gtBoundary, width, height, 4)
    let gtMid = 0
    let gtMidNonEdge = 0
    for (let i = 0; i < total; i++) {
      const a = rgba[i * 4 + 3]
      if (a >= 32 && a <= 223) {
        gtMid++
        if (!gtBand[i]) gtMidNonEdge++
      }
    }
    metrics.gt = {
      subjectPixels: count(gtFg),
      backgroundFar: regionStats(rgba, gtBgFar),
      subjectCore: regionStats(rgba, gtCore),
      nonEdgeMidPct: round((gtMidNonEdge / total) * 100),
      edgeWidthPx: count(gtBoundary) ? round(gtMid / count(gtBoundary)) : 0,
    }
  }
  return metrics
}

function round(n) {
  return Math.round(n * 100) / 100
}

function checksFor(metrics, options = {}) {
  const checks = []
  const add = (name, ok, detail) => checks.push({ name, ok, detail })
  const coverageOk = metrics.coverage >= 0.02 && metrics.coverage <= 0.9
  add('coverage 0.02–0.90', coverageOk, round(metrics.coverage))
  if (metrics.gt) {
    const bg = metrics.gt.backgroundFar
    const core = metrics.gt.subjectCore
    add('背景平均 alpha ≤2', bg.mean <= 2, round(bg.mean))
    add('背景 P95 alpha ≤8', bg.p95 <= 8, bg.p95)
    add('主体 alpha≥250 ≥98%', core.ge250Pct >= 98, round(core.ge250Pct))
    add('非边缘 32–223 ≤3%', metrics.gt.nonEdgeMidPct <= 3, metrics.gt.nonEdgeMidPct)
    add('边缘过渡 2–4px', metrics.gt.edgeWidthPx >= 2 && metrics.gt.edgeWidthPx <= 4,
      metrics.gt.edgeWidthPx)
  } else {
    const bg = metrics.self.farBackground
    const core = metrics.self.core
    add('背景平均 alpha ≤2', bg.mean <= 2, round(bg.mean))
    add('背景 P95 alpha ≤8', bg.p95 <= 8, bg.p95)
    add('主体 alpha≥250 ≥98%', core.ge250Pct >= 98, round(core.ge250Pct))
    add('非边缘 32–223 ≤3%', metrics.self.nonEdgeMidPct <= 3, metrics.self.nonEdgeMidPct)
    add('边缘过渡 2–4px', metrics.self.edge.avgWidthPx >= 2 && metrics.self.edge.avgWidthPx <= 4,
      metrics.self.edge.avgWidthPx)
  }
  if (options.timings && options.assertBlock) {
    // session.run() is async native work; the sync budget covers the
    // synchronous JS stages. The app offloads all of this to a utility
    // process (P1-5), so this is only asserted for the in-process path.
    const syncStages = ['decodeMs', 'resizeMs', 'preprocessMs', 'maskMs', 'composeMs', 'encodeMs']
    const worst = Math.max(...syncStages.map((k) => options.timings[k] || 0))
    add('单段同步阻塞 ≤50ms（进程内）', worst <= 50, worst)
  }
  return checks
}

function syncMax(timings) {
  if (!timings) return 0
  const syncStages = ['decodeMs', 'resizeMs', 'preprocessMs', 'maskMs', 'composeMs', 'encodeMs']
  return Math.max(...syncStages.map((k) => timings[k] || 0))
}

function printReport(report, opts) {
  if (opts.json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log('image      ' + report.source + ' -> ' + report.metrics.size.join('x'))
    if (report.preprocess) console.log('preprocess ' + report.preprocess)
    if (report.ms !== undefined) console.log('time       ' + report.ms + ' ms  ' + JSON.stringify(report.timings || {}))
    if (report.timings) console.log('sync       in-process max ' + syncMax(report.timings) + 'ms（应用已用 utilityProcess 卸载）')
    if (report.coverage !== undefined) console.log('coverage   ' + round(report.coverage))
    const b = report.metrics.bands
    console.log('bands      zero=' + b.zeroPct + '% faint=' + b.faintPct + '% soft=' + b.softPct +
      '% medium=' + b.mediumPct + '% strong=' + b.strongPct + '% solid=' + b.solidPct + '%')
    if (report.metrics.gt) {
      const g = report.metrics.gt
      console.log('gt/bg      mean=' + round(g.backgroundFar.mean) + ' p95=' + g.backgroundFar.p95 +
        ' zero=' + round(g.backgroundFar.zeroPct) + '%')
      console.log('gt/core    ≥250=' + round(g.subjectCore.ge250Pct) + '%  mid=' + g.nonEdgeMidPct + '%' +
        '  edge=' + g.edgeWidthPx + 'px')
    } else {
      const s = report.metrics.self
      console.log('farBg      mean=' + round(s.farBackground.mean) + ' p95=' + s.farBackground.p95 +
        ' zero=' + round(s.farBackground.zeroPct) + '%')
      console.log('core       ≥250=' + round(s.core.ge250Pct) + '%  mid=' + s.nonEdgeMidPct + '%' +
        '  edge=' + s.edge.avgWidthPx + 'px')
    }
    for (const c of report.checks) console.log((c.ok ? '  PASS  ' : '  FAIL  ') + c.name + '  (' + c.detail + ')')
  }
  if (opts.assert) {
    const failed = report.checks.filter((c) => !c.ok)
    if (failed.length) {
      console.error(failed.length + ' check(s) failed')
      process.exitCode = 1
    }
  }
}

/** Rasterise a mask that lives in the same coordinates as `src`. */
function rasterizeMaskSameSpace(mask, mw, mh, sw, sh, bounds, fit, canvas) {
  const out = new Uint8Array(canvas * canvas)
  for (let dy = 0; dy < fit.height; dy++) {
    const sy = bounds.y + (dy + 0.5) / fit.scale - 0.5
    const my = (sy + 0.5) * (mh / sh) - 0.5
    for (let dx = 0; dx < fit.width; dx++) {
      const sx = bounds.x + (dx + 0.5) / fit.scale - 0.5
      const mx = (sx + 0.5) * (mw / sw) - 0.5
      out[(fit.y + dy) * canvas + fit.x + dx] = pixels.sampleMask(mask, mw, mh, mx, my) >= 0.5 ? 1 : 0
    }
  }
  return out
}

function fakeCompose(opts) {
  const image = readPNG(opts.fake)
  const gt = readPNG(opts.mask)
  const keep = binary(gt.data, 127)
  const bounds0 = math.maskBounds(keep, gt.width, gt.height, 0.5)
  if (!bounds0) throw new Error('mask is empty')
  const pad = 8
  const x = Math.max(0, bounds0.x - pad)
  const y = Math.max(0, bounds0.y - pad)
  const right = Math.min(image.width, bounds0.x + bounds0.width + pad)
  const bustBottom = Math.min(image.height, Math.max(y + 120, Math.round(image.height * 0.66)))
  const bottom = Math.min(image.height, Math.min(bounds0.y + bounds0.height + pad, bustBottom))
  const bounds = { x, y, width: right - x, height: bottom - y }
  const canvas = opts.canvas || 610
  const fit = math.fitRect(bounds.width, bounds.height, canvas, 0.94, 6)
  const feather = opts.feather === undefined ? 2 : opts.feather
  const rgba = pixels.composeMaskedCanvas({
    src: image.data,
    sw: image.width,
    sh: image.height,
    mask: keep,
    mw: gt.width,
    mh: gt.height,
    bounds,
    fit,
    canvas,
    feather,
  })
  const pngBuffer = png.encodePNG(canvas, canvas, rgba)
  if (opts.out) fs.writeFileSync(opts.out, pngBuffer)
  const gtCanvas = rasterizeMaskSameSpace(keep, gt.width, gt.height, image.width, image.height, bounds, fit, canvas)
  const coverage = count(keep) / keep.length
  const metrics = analyze(rgba, canvas, canvas, gtCanvas)
  return {
    source: opts.fake + ' + ' + opts.mask,
    coverage,
    metrics,
    checks: checksFor(metrics),
    png: pngBuffer,
    bounds,
    fit,
  }
}

async function runNodeInput(opts) {
  const cutout = require('../lib/cutout')
  const image = readPNG(opts.input)
  const started = Date.now()
  const canvas = opts.canvas || 610
  const expectNoPerson = opts.expect === 'no-person'
  try {
    const result = await cutout.cutoutImageRGBA(image.data, image.width, image.height, {
      canvas,
      preprocess: opts.preprocess,
      decontaminate: opts.decontaminate,
    })
    if (expectNoPerson) {
      console.error('FAIL expected NO_PERSON but got a cutout (coverage ' + round(result.coverage) + ')')
      process.exitCode = 1
      return
    }
    if (opts.out) fs.writeFileSync(opts.out, result.png)
    if (opts.maskOut) fs.writeFileSync(opts.maskOut, result.maskPng)
    const decoded = png.decodePNG(result.png)
    const metrics = analyze(decoded.data, decoded.width, decoded.height, null)
    const report = {
      source: opts.input,
      ok: true,
      preprocess: result.preprocess,
      ms: Date.now() - started,
      timings: result.timings,
      coverage: result.coverage,
      cutout: result.cutout,
      working: result.working,
      metrics,
    }
    report.checks = checksFor(metrics, { timings: result.timings })
    printReport(report, opts)
    if (opts.assert && report.checks.some((c) => !c.ok)) process.exitCode = 1
  } catch (err) {
    const code = (err && err.code) || 'CUTOUT_FAILED'
    if (expectNoPerson && code === 'NO_PERSON') {
      console.log('PASS expected NO_PERSON (' + (err.message || '') + ')')
      return
    }
    console.error(JSON.stringify({ ok: false, code, error: String(err && err.message || err) }))
    if (opts.assert || expectNoPerson) process.exitCode = 1
  }
}

/** Electron-only helper: decode a JPEG/WebP photo into a straight RGBA PNG. */
function electronDecode(opts) {
  const { app, nativeImage } = require('electron')
  app.disableHardwareAcceleration()
  app.whenReady().then(() => {
    try {
      const image = nativeImage.createFromPath(opts.decode)
      if (image.isEmpty()) throw new Error('empty image')
      const size = image.getSize()
      const longest = Math.max(size.width, size.height)
      const scale = longest > 1200 ? 1200 / longest : 1
      const working = scale < 1
        ? image.resize({
          width: Math.max(1, Math.round(size.width * scale)),
          height: Math.max(1, Math.round(size.height * scale)),
          quality: 'best',
        })
        : image
      const s = working.getSize()
      const rgba = pixels.bgraToRGBA(working.getBitmap(), s.width, s.height, true)
      const out = opts.out || opts.decode.replace(/\.[^.]+$/, '') + '.png'
      fs.writeFileSync(out, png.encodePNG(s.width, s.height, rgba))
      console.log(JSON.stringify({ ok: true, width: s.width, height: s.height, out }))
      app.exit(0)
    } catch (err) {
      console.error(JSON.stringify({ ok: false, error: String(err && err.message || err) }))
      app.exit(1)
    }
  })
}

function electronRun(opts) {
  const { app, nativeImage } = require('electron')
  const cutout = require('../lib/cutout')
  app.disableHardwareAcceleration()
  app.whenReady().then(async () => {
    const file = opts.rest[0] || process.env.DESKPET_CUTOUT_INPUT || ''
    const started = Date.now()
    try {
      const image = nativeImage.createFromPath(file)
      if (image.isEmpty()) throw new Error('empty image')
      const canvas = opts.canvas || 610
      const result = await cutout.cutoutImage(nativeImage, image, { canvas, preprocess: opts.preprocess })
      if (opts.out) fs.writeFileSync(opts.out, result.png)
      const decoded = png.decodePNG(result.png)
      const metrics = analyze(decoded.data, decoded.width, decoded.height, null)
      const report = {
        source: file,
        ok: true,
        preprocess: result.preprocess,
        ms: Date.now() - started,
        timings: result.timings,
        coverage: result.coverage,
        cutout: result.cutout,
        working: result.working,
        metrics,
      }
      report.checks = checksFor(metrics, { timings: result.timings })
      printReport(report, opts)
      app.exit(0)
    } catch (err) {
      const code = (err && err.code) || 'CUTOUT_FAILED'
      console.error(JSON.stringify({ ok: false, code, error: String(err && err.message || err) }))
      if (opts.assert) process.exitCode = 1
      app.exit(1)
    }
  })
}

const opts = parseArgs(process.argv.slice(2))
if (opts.help) {
  console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0])
  process.exit(0)
}

if (opts.png) {
  const image = readPNG(opts.png)
  const gt = opts.gt ? readPNG(opts.gt) : null
  if (gt && (gt.width !== image.width || gt.height !== image.height)) {
    throw new Error('GT mask size does not match the PNG')
  }
  const gtMask = gt ? binary(gt.data, 127) : null
  const metrics = analyze(image.data, image.width, image.height, gtMask)
  const report = { source: opts.png, metrics, checks: checksFor(metrics) }
  printReport(report, opts)
} else if (opts.input) {
  runNodeInput(opts)
} else if (opts.fake) {
  if (!opts.mask) throw new Error('--fake requires --mask <gt.png>')
  const report = fakeCompose(opts)
  printReport(report, opts)
} else if (opts.decode) {
  electronDecode(opts)
} else if (opts.rest.length || process.env.DESKPET_CUTOUT_INPUT) {
  electronRun(opts)
} else {
  console.error('nothing to do; see --help')
  process.exitCode = 2
}