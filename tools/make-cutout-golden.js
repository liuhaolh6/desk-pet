'use strict'

/**
 * Golden set generator for `tools/cutout-eval.js` (P2-5).
 *
 * These are **synthetic** portraits: a headed silhouette built from signed
 * distance fields on a gradient background. They are not a quality benchmark of
 * U^2-Net on real photos——they exist so the evaluation pipeline itself has
 * deterministic fixtures with a known ground-truth mask (IoU is meaningful
 * because we know where the person is).
 *
 * Real-photo benchmarking: drop photos into `.cutout-eval/` (gitignored) and
 * run `node tools/cutout-eval.js --dir=.cutout-eval`; without a `*.mask.png`
 * companion only timing + edge sharpness are reported.
 *
 * Usage: node tools/make-cutout-golden.js [--out=<dir>]
 */

const fs = require('fs')
const path = require('path')
const png = require('../lib/png')

const WIDTHS = [480, 512, 560, 600, 640, 700, 760, 820, 880, 900]
const VARIANTS = [
  { bg: [40, 60, 90], bg2: [90, 130, 170], hair: 0.16, shoulder: 0.34, torso: 0.30, offset: 0 },
  { bg: [120, 90, 60], bg2: [200, 170, 120], hair: 0.18, shoulder: 0.32, torso: 0.28, offset: -0.02 },
  { bg: [30, 30, 34], bg2: [70, 74, 80], hair: 0.14, shoulder: 0.36, torso: 0.32, offset: 0.02 },
  { bg: [200, 210, 220], bg2: [240, 244, 248], hair: 0.17, shoulder: 0.30, torso: 0.30, offset: 0.01 },
  { bg: [80, 40, 60], bg2: [150, 90, 120], hair: 0.19, shoulder: 0.33, torso: 0.26, offset: -0.01 },
  { bg: [20, 70, 60], bg2: [60, 130, 110], hair: 0.15, shoulder: 0.35, torso: 0.31, offset: 0.015 },
  { bg: [90, 80, 20], bg2: [160, 150, 60], hair: 0.18, shoulder: 0.31, torso: 0.29, offset: -0.015 },
  { bg: [60, 60, 100], bg2: [110, 110, 170], hair: 0.16, shoulder: 0.34, torso: 0.33, offset: 0.005 },
  { bg: [150, 60, 40], bg2: [220, 130, 90], hair: 0.20, shoulder: 0.30, torso: 0.27, offset: -0.005 },
  { bg: [45, 45, 45], bg2: [110, 110, 110], hair: 0.17, shoulder: 0.32, torso: 0.30, offset: 0.01 },
]

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

function ellipseSDF(x, y, cx, cy, rx, ry) {
  const dx = (x - cx) / rx
  const dy = (y - cy) / ry
  return (Math.sqrt(dx * dx + dy * dy) - 1) * Math.min(rx, ry)
}

/** Union of the body parts; returns per-pixel coverage in [0,1]. */
function silhouette(w, h, v) {
  const sdf = new Float32Array(w * h)
  const headR = v.hair * w
  const headY = h * 0.27
  const torsoRy = h * 0.30
  const torsoCy = h - torsoRy * 0.55
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const head = ellipseSDF(x, y, w * 0.5 + v.offset * w, headY, headR, headR * 1.12)
      const neck = ellipseSDF(x, y, w * 0.5, headY + headR * 0.95, headR * 0.42, headR * 0.5)
      const shoulders = ellipseSDF(x, y, w * 0.5, torsoCy - torsoRy * 0.35, v.shoulder * w, torsoRy * 0.62)
      const torso = ellipseSDF(x, y, w * 0.5, torsoCy, v.torso * w, torsoRy)
      sdf[i] = Math.min(head, neck, shoulders, torso)
    }
  }
  const cov = new Float32Array(w * h)
  for (let i = 0; i < sdf.length; i++) cov[i] = smoothstep(-1.2, 1.2, -sdf[i])
  return cov
}

function render(w, h, v) {
  const cov = silhouette(w, h, v)
  const rgba = Buffer.alloc(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const t = y / Math.max(1, h - 1)
      const noise = ((x * 7 + y * 13) % 11) / 11 - 0.5
      let r = v.bg[0] + (v.bg2[0] - v.bg[0]) * t + noise * 6
      let g = v.bg[1] + (v.bg2[1] - v.bg[1]) * t + noise * 6
      let b = v.bg[2] + (v.bg2[2] - v.bg[2]) * t + noise * 6
      const c = cov[i]
      // subject: warm skin tones with a little shading so the edge is not flat
      const shade = 0.82 + 0.18 * (1 - t)
      r = r * (1 - c) + 214 * shade * c
      g = g * (1 - c) + 172 * shade * c
      b = b * (1 - c) + 138 * shade * c
      const p = i * 4
      rgba[p] = Math.max(0, Math.min(255, Math.round(r)))
      rgba[p + 1] = Math.max(0, Math.min(255, Math.round(g)))
      rgba[p + 2] = Math.max(0, Math.min(255, Math.round(b)))
      rgba[p + 3] = 255
    }
  }
  const mask = Buffer.alloc(w * h * 4, 255)
  for (let i = 0; i < w * h; i++) {
    const a = Math.round(cov[i] * 255)
    const p = i * 4
    mask[p] = a
    mask[p + 1] = a
    mask[p + 2] = a
    mask[p + 3] = 255
  }
  return { image: rgba, mask }
}

function main(argv) {
  const outArg = argv.find((a) => a.startsWith('--out='))
  const outDir = outArg ? outArg.slice(6) : path.join(__dirname, '..', 'tests', 'fixtures', 'cutout-golden')
  fs.mkdirSync(outDir, { recursive: true })
  const written = []
  WIDTHS.forEach((w, idx) => {
    const v = VARIANTS[idx % VARIANTS.length]
    const h = Math.round(w * 1.25)
    const { image, mask } = render(w, h, v)
    const name = 'person-' + String(idx + 1).padStart(2, '0')
    fs.writeFileSync(path.join(outDir, name + '.png'), png.encodePNG(w, h, image))
    fs.writeFileSync(path.join(outDir, name + '.mask.png'), png.encodePNG(w, h, mask))
    written.push(name + ' ' + w + 'x' + h)
  })
  console.log('wrote ' + written.length + ' pairs to ' + outDir)
  for (const line of written) console.log('  ' + line)
}

if (require.main === module) main(process.argv.slice(2))

module.exports = { render, silhouette }