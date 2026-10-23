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
    // 文案搬进语言包后，按钮可能只剩 data-i18n*（运行时才填字），也算有名字
    return !name && !attr(b, 'aria-label') && !attr(b, 'data-i18n') && !attr(b, 'data-i18n-aria-label')
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
  check('托盘/快捷键状态是纯文本说明', /<p id="trayStatus" class="field-hint"[^>]*>/.test(html) && /<p id="shortcutStatus" class="field-hint"[^>]*>/.test(html))
  check('状态说明不藏在 aria-hidden 里', !/id="trayStatus"[^>]*aria-hidden/.test(html) && !/id="shortcutStatus"[^>]*aria-hidden/.test(html))
  check('状态更新走 textContent（不会塞 HTML）', /trayEl\.textContent =/.test(js) && /keyEl\.textContent =/.test(js))
  check('导出诊断是带名称的按钮', /<button id="diagBtn" type="button"[^>]*(data-i18n="[^"]+"|>[^<]+<\/button>)/.test(html))
  check('导出结果写在 aria-live 之外不打断读屏', !/id="diagStatus"[^>]*aria-live/.test(html))
}

// ------------------------------------------- settings.html (P1-4 usability)
{
  const html = read('app/settings.html')
  const js = read('app/settings.js')
  const search = (html.match(/<input id="settingSearch"[^>]*>/i) || [''])[0]
  check(
    '搜索框有可访问名称',
    attr(search, 'aria-label') === '搜索设置项' || attr(search, 'data-i18n-aria-label') === 'settings.searchAria',
    attr(search, 'aria-label') || attr(search, 'data-i18n-aria-label')
  )
  check('搜索框是 search 类型且无自动大写', attr(search, 'type') === 'search' && attr(search, 'autocomplete') === 'off')
  check('搜索框说明用 aria-describedby 关联', !!attr(search, 'aria-describedby') && /id="searchHint"/.test(html))
  check('结果区不是假的列表角色', !/id="searchResults"[^>]*role="list"/.test(html))
  const results = (html.match(/<div id="searchResults"[^>]*>/i) || [''])[0]
  check('结果区有名称', !!attr(results, 'aria-label'))
  check('搜索框报告展开状态', /setAttribute\('aria-expanded', 'true'\)/.test(js) && /setAttribute\('aria-expanded', 'false'\)/.test(js))
  check('搜索结果是真按钮', /const row = document\.createElement\('button'\)/.test(js) && /row\.type = 'button'/.test(js))
  check('键盘能进结果并回车选中', /ArrowDown/.test(js) && /ev\.key === 'Enter'/.test(js))
  check('空结果给出文字提示而不是只有颜色', /settings\.findEmpty/.test(js) && /search-empty/.test(js))
  check('跳转后焦点落在目标控件', /node\.focus\(\{ preventScroll: true \}\)/.test(js))
  check('减少动效时取消平滑滚动', /prefers-reduced-motion: reduce/.test(js) && /'auto' : 'smooth'/.test(js))

  const confirm = (html.match(/<div id="resetConfirm"[^>]*>/i) || [''])[0]
  check('恢复默认的确认层是 alertdialog', attr(confirm, 'role') === 'alertdialog')
  check('确认层有名称与说明', !!attr(confirm, 'aria-labelledby') && !!attr(confirm, 'aria-describedby'))
  check('确认层默认收起且报告展开状态', /id="resetConfirm"[\s\S]{0,200}hidden/.test(html) && /aria-haspopup="dialog"/.test(html))
  check('确认层拿到焦点后可按 Esc 退出', /resetOk'\)\.focus/.test(js) && /ev\.key === 'Escape'/.test(js))
  check(
    '确认按钮有明确文案',
    (/id="resetOk"[^>]*>恢复默认</.test(html) || /id="resetOk"[^>]*data-i18n="settings\.resetConfirmOk"/.test(html)) &&
      (/id="resetCancel"[^>]*>先不动</.test(html) || /id="resetCancel"[^>]*data-i18n="settings\.resetCancel"/.test(html))
  )

  const chips = (html.match(/<div id="recentCities"[^>]*>/i) || [''])[0]
  check('最近城市一行有名称', !!attr(chips, 'aria-label') || !!attr(chips, 'data-i18n-aria-label'))
  check('最近城市标明当前选中', /setAttribute\('aria-pressed', String\(name === current\)\)/.test(js))
  check('每个设置项都有一句话说明', !/\n\s*<div class="field">(?:(?!<\/div>)[\s\S])*?class="field-label"(?:(?!<\/div>)[\s\S])*?<\/div>\s*<\/div>/.test(html) ||
    (html.match(/class="field-hint"/g) || []).length >= 10)
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
  check('引导卡按钮都有可访问名称', buttons(html).every((b) => !!stripTags(b) || !!attr(b, 'aria-label') || !!attr(b, 'data-i18n')))
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

// 高对比度（forced-colors）：系统会把背景/阴影抹平，靠系统色与边框分层。
for (const file of ['app/cutout.css', 'app/pet.css', 'app/settings.css', 'app/editor.css', 'app/onboard.css']) {
  const css = read(file)
  const at = css.indexOf('@media (forced-colors: active)')
  check(file + ' 有 forced-colors 分支', at >= 0)
  const branch = at < 0 ? '' : css.slice(at, css.indexOf('\n}', at) + 2)
  check(file + ' forced-colors 用系统色', /CanvasText|ButtonText|Highlight|Canvas/.test(branch))
}
{
  const petCss = read('app/pet.css')
  const fc = petCss.indexOf('@media (forced-colors: active)')
  const rule = fc < 0 ? '' : petCss.slice(fc)
  check('高对比度下云朵框不再被刷成黑底', rule.includes('forced-color-adjust: none') && rule.includes('fill: Canvas'))
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

//
// ------------------------------------------------- P1-5: water log (settings)
{
  const html = read('app/settings.html')
  const js = read('app/settings.js')
  const timeline = (html.match(/<ol id="waterTimeline"[^>]*>/i) || [''])[0]
  check('喝水时间轴是列表且有名称', !!timeline && !!attr(timeline, 'aria-labelledby'))
  check('时间轴的名称指向可见标签', /id="waterTodayLabel"/.test(html))
  const week = (html.match(/<ul id="waterWeek"[^>]*>/i) || [''])[0]
  check('本周杯数是列表且有名称', !!week && !!attr(week, 'aria-labelledby'))
  check('今天的柱条用 aria-current 标记', /setAttribute\('aria-current', 'true'\)/.test(js))
  const cup = (html.match(/<input id="cupMl"[^>]*>/i) || [''])[0]
  check('杯量输入有标签与说明', !!attr(cup, 'aria-describedby') && /for="cupMl"/.test(html))
  const exportBtn = (html.match(/<button id="exportWaterBtn"[^>]*>([^<]*)</i) || [])
  check(
    '导出按钮是带文案的真按钮',
    attr(html.match(/<button id="exportWaterBtn"[^>]*>/i)[0], 'type') === 'button' &&
      (/导出喝水记录/.test(exportBtn[1] || '') || /data-i18n="reminder\.exportCsv"/.test(html.match(/<button id="exportWaterBtn"[^>]*>/i)[0]))
  )
  check(
    '导出结果用文字说明而不是只弹窗',
    /waterExportHint/.test(html) && (/textContent = '已导出 ' \+/.test(js) || /waterExportHint'\)\.textContent = t\(/.test(js))
  )
  check('时间轴不只靠颜色区分', !/\.water-timeline li\s*\{[^}]*color:/.test(read('app/settings.css')))
}

console.log('')
if (failures) {
  console.error(failures + ' accessibility check(s) failed')
  process.exitCode = 1
} else {
  console.log('a11y static checks passed')
}