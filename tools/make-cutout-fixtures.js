/**
 * Generate the small, public synthetic fixtures used by tools/cutout-diag.js
 * and the alpha regression tests. No personal photos: everything here is
 * drawn from primitives so the images can live in the repository.
 *
 *   node tools/make-cutout-fixtures.js
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { encodePNG } = require('../lib/png')

const OUT = path.join(__dirname, 'fixtures')

function blank(width, height) {
  return Buffer.alloc(width * height * 4)
}

function setPixel(buf, width, x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= width) return
  const p = (y * width + x) * 4
  if (p + 3 >= buf.length) return
  buf[p] = r
  buf[p + 1] = g
  buf[p + 2] = b
  buf[p + 3] = a
}

function fillRect(buf, width, height, x0, y0, x1, y1, r, g, b, a = 255) {
  for (let y = Math.max(0, y0); y < Math.min(height, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(width, x1); x++) setPixel(buf, width, x, y, r, g, b, a)
  }
}

function fillEllipse(buf, width, height, cx, cy, rx, ry, r, g, b, a = 255) {
  for (let y = Math.max(0, Math.floor(cy - ry)); y < Math.min(height, Math.ceil(cy + ry)); y++) {
    for (let x = Math.max(0, Math.floor(cx - rx)); x < Math.min(width, Math.ceil(cx + rx)); x++) {
      const dx = (x + 0.5 - cx) / rx
      const dy = (y + 0.5 - cy) / ry
      if (dx * dx + dy * dy <= 1) setPixel(buf, width, x, y, r, g, b, a)
    }
  }
}

function write(name, width, height, rgba) {
  const file = path.join(OUT, name)
  fs.writeFileSync(file, encodePNG(width, height, rgba))
  return file
}

fs.mkdirSync(OUT, { recursive: true })

// --- alpha contract fixtures -------------------------------------------------
// A 50% alpha block: after the whole pipeline the straight colour must stay
// (200,100,50) and the alpha ~128 whether composited on white or black.
{
  const w = 64
  const h = 64
  const buf = blank(w, h)
  fillRect(buf, w, h, 16, 16, 48, 48, 200, 100, 50, 128)
  write('alpha-block.png', w, h, buf)
}

// Same block, but the transparent area carries white RGB — the classic source
// of white halos when straight-alpha pixels are resized.
{
  const w = 64
  const h = 64
  const buf = blank(w, h)
  fillRect(buf, w, h, 0, 0, w, h, 255, 255, 255, 0)
  fillRect(buf, w, h, 16, 16, 48, 48, 200, 100, 50, 128)
  write('alpha-block-white.png', w, h, buf)
}

// --- synthetic "portrait" with a ground-truth mask ---------------------------
// Not used to judge the model (U2Net will not see a cartoon as a person); it
// exercises the mask -> alpha -> canvas path deterministically.
{
  const w = 640
  const h = 960
  const img = blank(w, h)
  const mask = blank(w, h)
  // Background: vertical gradient with a few rectangles standing in for a
  // cluttered room, so leftover background alpha is visible in the metrics.
  for (let y = 0; y < h; y++) {
    const t = y / h
    const r = Math.round(70 + 60 * t)
    const g = Math.round(110 + 40 * t)
    const b = Math.round(150 + 30 * t)
    for (let x = 0; x < w; x++) setPixel(img, w, x, y, r, g, b, 255)
  }
  fillRect(img, w, h, 40, 620, 170, 900, 90, 80, 70, 255)
  fillRect(img, w, h, 470, 540, 600, 860, 70, 90, 80, 255)

  const skin = [232, 190, 160]
  const hair = [60, 45, 40]
  const shirt = [190, 70, 70]
  // head + hair
  fillEllipse(img, w, h, 320, 250, 95, 115, ...hair, 255)
  fillEllipse(img, w, h, 320, 265, 80, 98, ...skin, 255)
  // neck + shoulders + torso
  fillRect(img, w, h, 285, 340, 355, 420, ...skin, 255)
  fillEllipse(img, w, h, 320, 520, 175, 190, ...shirt, 255)
  fillRect(img, w, h, 150, 500, 490, 960, ...shirt, 255)
  // detached hand (component retention / crop width check)
  fillEllipse(img, w, h, 545, 700, 34, 42, ...skin, 255)

  // Build the mask from the same shapes.
  fillEllipse(mask, w, h, 320, 250, 95, 115, 255, 255, 255, 255)
  fillEllipse(mask, w, h, 320, 265, 80, 98, 255, 255, 255, 255)
  fillRect(mask, w, h, 285, 340, 355, 420, 255, 255, 255, 255)
  fillEllipse(mask, w, h, 320, 520, 175, 190, 255, 255, 255, 255)
  fillRect(mask, w, h, 150, 500, 490, 960, 255, 255, 255, 255)
  fillEllipse(mask, w, h, 545, 700, 34, 42, 255, 255, 255, 255)

  write('synthetic-portrait.png', w, h, img)
  write('synthetic-portrait-mask.png', w, h, mask)
}

// --- negative: no person ----------------------------------------------------
{
  const w = 640
  const h = 960
  const buf = blank(w, h)
  for (let y = 0; y < h; y++) {
    const horizon = 520
    for (let x = 0; x < w; x++) {
      if (y < horizon) {
        const t = y / horizon
        setPixel(buf, w, x, y, Math.round(120 + 80 * t), Math.round(170 + 60 * t), Math.round(220 + 25 * t), 255)
      } else {
        const t = (y - horizon) / (h - horizon)
        setPixel(buf, w, x, y, Math.round(60 + 40 * t), Math.round(130 - 40 * t), Math.round(70 + 10 * t), 255)
      }
    }
  }
  // A flat building at the horizon: nothing person-shaped to latch onto.
  fillRect(buf, w, h, 120, 470, 260, 520, 200, 200, 190, 255)
  fillRect(buf, w, h, 420, 440, 520, 520, 180, 185, 175, 255)
  write('negative-landscape.png', w, h, buf)
}

console.log('fixtures written to ' + OUT)
for (const file of fs.readdirSync(OUT).sort()) {
  console.log('  ' + file + '  ' + fs.statSync(path.join(OUT, file)).size + ' B')
}