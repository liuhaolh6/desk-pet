#!/usr/bin/env node
/**
 * Static accessibility regression check for the renderer windows.
 *
 * This is NOT a WCAG audit: it only guards the structural things that are easy
 * to break again (language, focusable preview with a text alternative, live
 * region, accessible names on buttons, shortcut metadata, reduced-motion and
 * focus-visible styles, keyboard handler wiring). Real screen-reader and
 * high-contrast testing still has to happen on a desktop.
 *
 *   node tools/check-a11y.js
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')

let failures = 0
function check(name, ok, detail) {
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail === undefined ? '' : '  (' + detail + ')'))
  if (!ok) failures++
}

function read(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
}

function tagWithId(html, id) {
  const re = new RegExp('<[^>]*\\bid="' + id + '"[^>]*>', 'i')
  const m = html.match(re)
  return m ? m[0] : ''
}

function attr(tag, name) {
  const m = tag.match(new RegExp('\\b' + name + '\\s*=\\s*"([^"]*)"', 'i'))
  return m ? m[1] : null
}

function buttons(html) {
  return html.match(/<button\b[^>]*>[\s\S]*?<\/button>/gi) || []
}

function stripTags(html) {
  return html.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim()
}

// ------------------------------------------------------------------ shared
for (const file of ['app/cutout.html', 'app/pet.html', 'app/settings.html', 'app/editor.html', 'app/onboard.html']) {
  const html = read(file)
  check(file + ' 声明 lang', /<html[^>]*\slang="[^"]+"/i.test(html))
}

// --------------------------------------------------------------- cutout.html
const cutoutHtml = read('app/cutout.html')
{
  const stage = tagWithId(cutoutHtml, 'stage')
  check('预览区可聚焦', /\btabindex="/.test(stage))
  check('预览区有 aria-label', !!attr(stage, 'aria-label'))
  check('预览区关联替代文本', attr(stage, 'aria-describedby') === 'previewAlt')
}
{
  const alt = tagWithId(cutoutHtml, 'previewAlt')
  check('#previewAlt 存在且为 live region', alt !== '' && attr(alt, 'aria-live') === 'polite')
  const css = read('app/cutout.css')
  check('.sr-only 样式存在', /\.sr-only\s*\{/.test(css))
  check(':focus-visible 样式存在', /:focus-visible/.test(css))
  check('prefers-reduced-motion 生效', /prefers-reduced-motion/.test(css))
}
{
  const html = cutoutHtml
  const viewButtons = html.match(/<button\b[^>]*data-view="[^"]*"[^>]*>/gi) || []
  check('视图切换按钮存在', viewButtons.length >= 2)
  check('视图切换按钮有 aria-pressed', viewButtons.every((b) => attr(b, 'aria-pressed') !== null))
  const group = html.match(/<div[^>]*class="seg-group"[^>]*>/i)
  check('视图切换有 role=group + aria-label', !!group && attr(group[0], 'role') === 'group' && !!attr(group[0], 'aria-label'))
  const shortcuts = {
    eraseBtn: 'E',
    restoreBtn: 'R',
    undoBtn: 'Control+Z',
    rotateLeftBtn: 'Q',
    rotateRightBtn: 'W',
    flipBtn: 'F',
  }
  for (const [id, key] of Object.entries(shortcuts)) {
    const tag = tagWithId(html, id)
    check('#' + id + ' aria-keyshortcuts=' + key, attr(tag, 'aria-keyshortcuts') === key)
  }
  const brush = tagWithId(html, 'brush')
  check('#brush 有 aria-label', !!attr(brush, 'aria-label'))
  const labelledRanges = (html.match(/<input\b[^>]*type="range"[^>]*>/gi) || [])
  check('所有滑杆都有可访问名称', labelledRanges.every((b) => attr(b, 'aria-label') !== null || html.includes('for="' + attr(b, 'id') + '"')))
}
{
  const missing = buttons(cutoutHtml).filter((b) => {
    const name = stripTags(b)
    return !name && !attr(b, 'aria-label')
  })
  check('所有按钮都有可访问名称', missing.length === 0, missing.length ? missing.length + ' 个缺少名称' : '')
}

// ---------------------------------------------------------------- cutout.js
{
  const js = read('app/cutout.js')
  check('代码更新 #previewAlt', js.includes("$('previewAlt')"))
  check('代码维护 aria-pressed', js.includes('aria-pressed'))
  check('键盘支持 Escape 退出', js.includes("ev.key === 'Escape'"))
  check('键盘支持 Ctrl/Cmd+Z', js.includes('ev.ctrlKey') && js.includes('metaKey'))
  check('键盘支持笔刷与构图', js.includes("'['") && js.includes("'q'") && js.includes("'f'"))
}

// ---------------------------------------------------------------------- pet
{
  const petHtml = read('app/pet.html')
  const petJs = read('app/pet.js')
  const petTag = (petHtml.match(/<img[^>]*\bid="pet"[^>]*>/i) || [''])[0]
  check('桌宠图片有可访问名称（HTML 或 JS）', !!attr(petTag, 'alt') || /pet\.alt\s*=/.test(petJs))
  const petCss = read('app/pet.css')
  check('桌宠菜单可被键盘聚焦并显示', /\.pet-wrap:focus-within\s+\.menu-btn/.test(petCss))
}

// --------------------------------------------------- settings.html (P0-3 rows)
{
  const html = read('app/settings.html')
  const js = read('app/settings.js')
  check('托盘/快捷键状态是纯文本说明', /<p id="trayStatus" class="field-hint">/.test(html) && /<p id="shortcutStatus" class="field-hint">/.test(html))
  check('状态说明不藏在 aria-hidden 里', !/id="trayStatus"[^>]*aria-hidden/.test(html) && !/id="shortcutStatus"[^>]*aria-hidden/.test(html))
  check('状态更新走 textContent（不会塞 HTML）', /trayEl\.textContent =/.test(js) && /keyEl\.textContent =/.test(js))
  check('导出诊断是带名称的按钮', /<button id="diagBtn" type="button">[^<]+<\/button>/.test(html))
  check('导出结果写在 aria-live 之外不打断读屏', !/id="diagStatus"[^>]*aria-live/.test(html))
}

// ------------------------------------------------------------- onboard.html
{
  const html = read('app/onboard.html')
  const css = read('app/onboard.css')
  const js = read('app/onboard.js')
  const card = (html.match(/<main[^>]*class="card"[^>]*>/i) || [''])[0]
  check('引导卡是有名称的 dialog', attr(card, 'role') === 'dialog' && !!attr(card, 'aria-labelledby') && !!attr(card, 'aria-describedby'))
  check('#doneBtn 默认获得焦点', /\bid="doneBtn"[^>]*\bautofocus\b/.test(html))
  check('引导卡可用 Esc 关掉', js.includes("ev.key !== 'Escape'") && js.includes('dismissOnboard'))
  check('引导卡按钮都有可访问名称', buttons(html).every((b) => !!stripTags(b) || !!attr(b, 'aria-label')))
  check('onboard.css 有 :focus-visible', /:focus-visible/.test(css))
  check('onboard.css 有 forced-colors', /@media\s*\(forced-colors:\s*active\)/.test(css))
}

// ------------------------------------------------------- contrast (1.4.3 AA)
{
  const hexToRgb = (hex) => {
    const h = hex.replace('#', '')
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
  }
  const lum = ([r, g, b]) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  const ratio = (a, b) => {
    const l1 = lum(hexToRgb(a)), l2 = lum(hexToRgb(b))
    const hi = Math.max(l1, l2), lo = Math.min(l1, l2)
    return (hi + 0.05) / (lo + 0.05)
  }
  const tokens = read('app/tokens.css')
  const token = (name) => {
    const m = tokens.match(new RegExp('--' + name + ':\\s*(#[0-9a-fA-F]{6})'))
    return m ? m[1] : null
  }
  for (const [name, tokenName] of [['muted', 'surface'], ['muted', 'surface-3'], ['muted', 'bg'], ['ink-2', 'surface-3']]) {
    const color = token(name)
    const bg = token(tokenName)
    const r = color && bg ? ratio(color, bg) : 0
    check('--' + name + ' 对 --' + tokenName + '(' + bg + ') ≥4.5', r >= 4.5, Math.round(r * 100) / 100)
  }
  const bubble = read('app/bubble-model.js')
  const defaults = Array.from(bubble.matchAll(/color:\s*'(#[0-9a-fA-F]{6})'/g)).map((m) => m[1])
  const bad = defaults.filter((c) => ratio(c, '#ffffff') < 4.5)
  check('气泡默认文字色对白 ≥4.5', bad.length === 0, bad.join(',') || defaults.length + ' 个默认色')
}

// ------------------------------------------------- reduced motion + targets
for (const file of ['app/cutout.css', 'app/pet.css', 'app/settings.css', 'app/editor.css', 'app/onboard.css']) {
  const css = read(file)
  check(file + ' 支持 prefers-reduced-motion', /@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(css))
}
{
  const settingsCss = read('app/settings.css')
  const cutoutCss = read('app/cutout.css')
  const editorCss = read('app/editor.css')
  check('settings 滑杆 ≥24px', /input\[type=range\][\s\S]{0,400}?height:\s*24px/.test(settingsCss))
  check('cutout 缩放滑杆 ≥24px', /\.range input\s*\{[^}]*height:\s*24px/.test(cutoutCss))
  check('editor 图标按钮 ≥24px', /\.row-actions button\s*\{[^}]*min-height:\s*24px/.test(editorCss))
  check('音效行复选框标签 ≥24px', /\.sound-row > label\.check\s*\{[^}]*min-height:\s*24px/.test(settingsCss))
  const settingsJs = read('app/settings.js')
  check('音效控件有可访问名称', (settingsJs.match(/setAttribute\('aria-label'/g) || []).length >= 3)
}

console.log('')
if (failures) {
  console.error(failures + ' accessibility check(s) failed')
  process.exitCode = 1
} else {
  console.log('a11y static checks passed')
}