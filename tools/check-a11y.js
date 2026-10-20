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
for (const file of ['app/cutout.html', 'app/pet.html', 'app/settings.html', 'app/editor.html']) {
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
}

console.log('')
if (failures) {
  console.error(failures + ' accessibility check(s) failed')
  process.exitCode = 1
} else {
  console.log('a11y static checks passed')
}