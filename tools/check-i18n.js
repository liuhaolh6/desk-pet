'use strict'

/**
 * i18n guard (P2-6).
 *
 * Three jobs:
 *   1. **Locale parity** — every locale file must have exactly the same keys as
 *      `zh-CN` (the source of truth). Missing keys are a bug, extra keys are a
 *      typo or a forgotten removal; both fail.
 *   2. **No hard-coded copy** — the app's UI strings are being moved into
 *      `locales/*.json` page by page. `TRACKED` lists the files that can put copy
 *      on screen, and the per-file baseline ratchets: a file may never grow its
 *      count, and once it reaches 0 it stays 0. Comments are not copy, so they
 *      are stripped before counting (a comment may quote 「中文」 freely).
 *   3. **Keys that exist** — every `t('a.b')` in tracked code and every
 *      `data-i18n*="a.b"` in tracked markup must be a key in `locales/zh-CN.json`,
 *      otherwise the screen shows a raw key. Keys that nothing references are
 *      reported (not failed: some are built at runtime).
 *
 * Deliberately *not* tracked: log lines (`app/main/log.js`), the diagnostics
 * report body, `console.*` tracing, tests and tooling output. They are for us,
 * not for the person using the pet.
 *
 * Usage:
 *   node tools/check-i18n.js            # check
 *   node tools/check-i18n.js --list     # per-file counts
 *   node tools/check-i18n.js --update   # rewrite the baseline (only when you
 *                                       # genuinely moved strings out)
 */

const fs = require('node:fs')
const path = require('node:path')
const { keyDiff, flatten } = require('../lib/i18n')

const ROOT = path.join(__dirname, '..')
const LOCALES = path.join(ROOT, 'locales')
const BASELINE = path.join(__dirname, 'i18n-baseline.json')
const SOURCE = 'zh-CN'
const CJK = /[\u4e00-\u9fff]/

/** Files whose strings can reach the screen. Adding one starts its baseline at
 *  its current count — so add it *after* extracting, or the number is a debt. */
const TRACKED = [
  // main process: tray, notifications, dialogs, window titles, exports
  'app/main.js',
  'app/main/tray.js',
  'app/main/reminder.js',
  'app/main/weather-pump.js',
  'app/main/nudge-pump.js',
  'app/main/ipc.js',
  'app/main/windows.js',
  'app/main/privacy.js',
  'app/main/cutout-service.js',
  'app/main/diagnostics.js',
  // renderer
  'app/preload.js',
  'app/pet.js',
  'app/pet.html',
  'app/overlay.js',
  'app/onboard.html',
  'app/onboard.js',
  'app/settings.js',
  'app/settings.html',
  'app/cutout.js',
  'app/cutout.html',
  'app/editor.js',
  'app/editor.html',
  'app/bubble-model.js',
  'app/sound-model.js',
  // shared vocabulary that ends up in a bubble, a dialog or a CSV
  'lib/nudges.js',
  'lib/weather.js',
  'lib/store.js',
  'lib/water-log.js',
  'lib/cutout.js',
  'lib/update-check.js',
]

// ---------------------------------------------------------------- comment strip

/** Blank out line and block comments while leaving strings and newlines where
 *  they were, so the counts stay comparable line by line. */
function stripJsComments(text) {
  let out = ''
  let i = 0
  const n = text.length
  let state = 'code'
  while (i < n) {
    const ch = text[i]
    const next = text[i + 1]
    if (state === 'code') {
      if (ch === '/' && next === '/') { state = 'line'; out += '  '; i += 2; continue }
      if (ch === '/' && next === '*') { state = 'block'; out += '  '; i += 2; continue }
      if (ch === "'") { state = 'sq'; out += ch; i += 1; continue }
      if (ch === '"') { state = 'dq'; out += ch; i += 1; continue }
      if (ch === '`') { state = 'tpl'; out += ch; i += 1; continue }
      out += ch; i += 1; continue
    }
    if (state === 'line') {
      if (ch === '\n') { state = 'code'; out += '\n' } else out += ' '
      i += 1; continue
    }
    if (state === 'block') {
      if (ch === '*' && next === '/') { state = 'code'; out += '  '; i += 2; continue }
      out += ch === '\n' ? '\n' : ' '
      i += 1; continue
    }
    // inside a string: only the closing quote (or an escape) matters
    if (ch === '\\') { out += ch + (next === undefined ? '' : next); i += 2; continue }
    if (ch === '\n') { state = 'code'; out += '\n'; i += 1; continue }
    if ((state === 'sq' && ch === "'") || (state === 'dq' && ch === '"') || (state === 'tpl' && ch === '`')) {
      state = 'code'; out += ch; i += 1; continue
    }
    out += ch; i += 1
  }
  return out
}

function stripMarkupComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
}

function stripCssComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
}

// ------------------------------------------------------------------ counting

/** Quoted literals that contain CJK. */
function countCjkLiterals(text) {
  const literals = text.match(/['"`][^'"`\n]*[\u4e00-\u9fff][^'"`\n]*['"`]/g) || []
  return literals.length
}

/** Markup: Chinese inside a text node or inside an attribute value. A text node
 *  and its attributes count separately, which is the granularity of "one piece
 *  of copy to move into the locale file". */
function countHtmlCopy(text) {
  const clean = stripMarkupComments(text)
  let count = 0
  for (const node of clean.match(/>[^<]*</g) || []) if (CJK.test(node)) count += 1
  for (const attr of clean.match(/="[^"]*"/g) || []) if (CJK.test(attr)) count += 1
  return count
}

/** Count the copy left in one file, dispatching on its extension. */
function countFile(rel, text) {
  if (/\.html$/.test(rel)) return countHtmlCopy(text)
  if (/\.css$/.test(rel)) return countCjkLiterals(stripCssComments(text))
  return countCjkLiterals(stripJsComments(text))
}

// --------------------------------------------------------------- references

const KEY_CALL = /\b(?:t|tr)\(\s*['"]([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+)['"]/g
const HTML_KEY = /data-i18n(?:-html|-title|-aria-label|-placeholder|-alt)?="([^"]+)"/g

/** Keys the code asks for. Dynamic keys (`t('settings.find.' + id)`) are
 *  invisible here, which is what `unused` is only a hint about. */
function collectKeys(rel, text) {
  const keys = []
  if (/\.html$/.test(rel)) {
    const clean = stripMarkupComments(text)
    let m
    HTML_KEY.lastIndex = 0
    while ((m = HTML_KEY.exec(clean))) keys.push(m[1])
    return keys
  }
  const clean = stripJsComments(text)
  let m
  KEY_CALL.lastIndex = 0
  while ((m = KEY_CALL.exec(clean))) keys.push(m[1])
  return keys
}

// ------------------------------------------------------------------- checks

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

function readLocales() {
  const files = fs.readdirSync(LOCALES).filter((f) => f.endsWith('.json'))
  const dicts = {}
  for (const file of files) {
    const id = file.replace(/\.json$/, '')
    try {
      dicts[id] = JSON.parse(fs.readFileSync(path.join(LOCALES, file), 'utf8'))
    } catch (err) {
      return { dicts, files, error: 'locales/' + file + ' 解析失败：' + err.message }
    }
  }
  return { dicts, files }
}

function checkLocales({ dicts, error }) {
  if (error) return [error]
  if (!dicts[SOURCE]) return ['缺少源语言 locales/' + SOURCE + '.json']
  const problems = []
  for (const id of Object.keys(dicts).sort()) {
    if (id === SOURCE) continue
    const diff = keyDiff(dicts[SOURCE], dicts[id])
    if (diff.onlyA.length) problems.push('locales/' + id + '.json 缺 ' + diff.onlyA.length + ' 个键：' + diff.onlyA.slice(0, 6).join(', ') + (diff.onlyA.length > 6 ? ' …' : ''))
    if (diff.onlyB.length) problems.push('locales/' + id + '.json 多 ' + diff.onlyB.length + ' 个键（源语言没有）：' + diff.onlyB.slice(0, 6).join(', ') + (diff.onlyB.length > 6 ? ' …' : ''))
  }
  // An empty string is usually a forgotten translation.
  for (const [id, dict] of Object.entries(dicts)) {
    const empties = Object.entries(dict).filter(([, v]) => typeof v === 'string' && v.trim() === '').map(([k]) => k)
    if (empties.length) problems.push('locales/' + id + '.json 有空串：' + empties.join(', '))
  }
  return problems
}

function scanSources() {
  const counts = {}
  const used = new Set()
  const missing = []
  for (const rel of TRACKED) {
    let text = ''
    try { text = read(rel) } catch (err) {
      counts[rel] = -1
      continue
    }
    counts[rel] = countFile(rel, text)
    for (const key of collectKeys(rel, text)) used.add(key)
  }
  return { counts, used, missing }
}

function checkKeysExist(used, dict) {
  const problems = []
  const known = new Set(Object.keys(flatten(dict)))
  for (const key of [...used].sort()) {
    if (!known.has(key)) problems.push('代码里引用了语言包里没有的键：' + key)
  }
  return problems
}

function unusedKeys(used, dict) {
  const referenced = new Set(used)
  return Object.keys(flatten(dict)).filter((key) => !referenced.has(key)).sort()
}

function main() {
  const listMode = process.argv.includes('--list')
  const update = process.argv.includes('--update')
  const { dicts, files } = readLocales()
  const { counts, used } = scanSources()

  const problems = checkLocales({ dicts, files })
  problems.push(...checkKeysExist(used, dicts[SOURCE]))
  let baseline = {}
  try { baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8')) } catch (err) { baseline = {} }
  const previous = baseline.files || {}

  const grown = []
  for (const [rel, n] of Object.entries(counts)) {
    if (n < 0) { problems.push('TRACKED 里的文件不存在：' + rel); continue }
    const before = Number.isFinite(previous[rel]) ? previous[rel] : n
    if (n > before) grown.push(rel + '：' + before + ' → ' + n)
  }

  if (update) {
    const payload = { generatedAt: new Date().toISOString().slice(0, 10), locales: files.map((f) => f.replace(/\.json$/, '')), files: counts }
    fs.writeFileSync(BASELINE, JSON.stringify(payload, null, 2) + '\n')
    console.log('baseline updated: ' + Object.keys(counts).length + ' files, ' +
      Object.values(counts).reduce((a, b) => a + b, 0) + ' CJK literals left')
    return problems.length ? 1 : 0
  }

  const total = Object.values(counts).filter((n) => n > 0).reduce((a, b) => a + b, 0)
  if (listMode) {
    for (const [rel, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
      console.log(String(n).padStart(4) + '  ' + rel)
    }
    console.log('total ' + total)
  }
  if (grown.length) {
    for (const line of grown) problems.push('硬编码中文变多了（请放进 locales/*.json）：' + line)
  }
  if (problems.length) {
    console.error('i18n 检查没通过：')
    for (const p of problems) console.error('  - ' + p)
    return 1
  }
  const remaining = Object.entries(counts).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 5)
  console.log('i18n 检查通过：' + files.length + ' 个语言包键名一致，' + TRACKED.length + ' 个文件共 ' + total + ' 处内联文案（基线只降不升）')
  if (remaining.length) console.log('  还欠：' + remaining.map(([f, n]) => f + ' ' + n).join(' · '))
  const unused = unusedKeys(used, dicts[SOURCE])
  if (unused.length) console.log('  语言包里有 ' + unused.length + ' 个键暂时没人用（可能是动态拼的键）')
  return 0
}

if (require.main === module) process.exitCode = main()

module.exports = { countCjkLiterals, countHtmlCopy, countFile, stripJsComments, collectKeys, checkLocales, scanSources, TRACKED }