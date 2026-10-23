/**
 * Headless smoke test: store + weather adapters. No Electron, no UI.
 *
 *   node tools/smoke.js
 */
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { createStore, merge, DEFAULT_SETTINGS, DEFAULT_ROLES } = require('../lib/store')
const { describe, WMO, advice } = require('../lib/weather')
const bubble = require('../app/bubble-model')
const soundModel = require('../app/sound-model')
const placement = require('../lib/placement')
const cutoutMath = require('../lib/cutout-math')
const pixels = require('../lib/cutout-pixels')
const pngCodec = require('../lib/png')
const cutout = require('../lib/cutout')

let pass = 0
function ok(name) { pass += 1; console.log('  ✓', name) }

/**
 * P1-1: the main process is split into app/main.js + app/main/*.js, so source
 * assertions have to look at all of them instead of one file.
 */
function mainSource() {
  const root = path.join(__dirname, '..', 'app')
  const files = [path.join(root, 'main.js')]
  const modDir = path.join(root, 'main')
  for (const name of fs.readdirSync(modDir).sort()) {
    if (name.endsWith('.js')) files.push(path.join(modDir, name))
  }
  return files.map((file) => fs.readFileSync(file, 'utf8')).join('\n')
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deskpet-'))
const store = createStore(dir)

// ---------------------------------------------------------------- store
{
  const s = store.readSettings()
  assert.equal(s.name, '小芳')
  assert.equal(s.size, 220)
  assert.equal(s.mode, 'normal')
  assert.equal(s.anchor, undefined, 'desktop build has no anchor field')
  ok('默认设置')
}

{
  const s = store.writeSettings({ name: '测试宠', size: 260, water: { intervalMinutes: 45 } })
  assert.equal(s.name, '测试宠')
  assert.equal(s.size, 260)
  assert.equal(s.water.intervalMinutes, 45)
  assert.equal(s.water.quietFrom, 23, '未触碰的默认值保留')
  const again = store.readSettings()
  assert.equal(again.name, '测试宠')
  ok('写入与读回一致')
}

{
  const roles = store.readRoles()
  assert.equal(roles.roles[0].id, 'default')
  const entry = store.addRole('测试角色', Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  assert.ok(entry.id)
  assert.ok(fs.existsSync(store.roleImagePath(entry.id)))
  assert.equal(store.readRoles().roles.length, 2)
  const del = store.deleteRole(entry.id)
  assert.equal(del.ok, true)
  assert.equal(store.readRoles().roles.length, 1)
  assert.equal(store.deleteRole('default').ok, false, '默认角色不可删')
  ok('角色增删与文件落盘')
}

{
  const bad = store.deleteRole('../evil')
  assert.equal(bad.ok, false)
  ok('非法角色 id 被拒绝')
}

{
  store.writeWeatherCache({ key: '1,2', at: Date.now(), value: { ok: true, temp: 10 } })
  assert.equal(store.readWeatherCache().value.temp, 10)
  ok('天气缓存读写')
}

// ---------------------------------------------------------------- weather
{
  assert.equal(describe(0).text, '晴')
  assert.equal(describe(61).text, '小雨')
  assert.equal(describe(999).text, '未知天气')
  assert.ok(Object.keys(WMO).length > 20)
  ok('WMO 天气码映射')
}

{
  // 贴心提醒（0.6.0）：按体感/降水/紫外线/风给一句温柔建议，缺数据时也不报错。
  assert.match(advice({ temp: 22, feels: 22, precip: 0 }), /舒服|刚刚好/)
  assert.match(advice({ temp: 8, feels: 8, precip: 0 }), /外套|凉/)
  assert.match(advice({ temp: 1, feels: -3, precip: 0 }), /冷|围巾/)
  assert.match(advice({ temp: 30, feels: 34, precip: 0 }), /热|喝水/)
  assert.match(advice({ temp: 25, feels: 25, precip: 80 }), /伞/)
  assert.match(advice({ temp: 25, feels: 25, code: 95 }), /伞/)
  assert.match(advice({ temp: -2, feels: -6, code: 73 }), /雪/)
  assert.match(advice({ temp: 26, feels: 27, uv: 10 }), /防晒/)
  assert.match(advice({ temp: 26, feels: 27, wind: 45 }), /风/)
  assert.equal(advice({ temp: null }), '')
  assert.equal(advice(null), '')
  ok('天气贴心提醒推导')
}

{
  // 24 条内置温馨提示 + 温柔口吻（不要命令式、不要冷冰冰的技术词）。
  const phrases = DEFAULT_SETTINGS.bubble.phrases
  assert.equal(phrases.length, 24, '内置 24 条温馨提示')
  assert.equal(new Set(phrases).size, 24, '24 条互不重复')
  assert.ok(phrases.every((p) => p.length >= 6 && p.length <= 30), '每条 6–30 字')
  assert.ok(phrases.every((p) => !/必须|立刻|马上|不准|禁止/.test(p)), '不用命令式措辞')
  assert.ok(phrases.filter((p) => /呀|啦|吧|哦|嘛|～|呢|？/.test(p)).length >= 22, '几乎每条都带语气词')
  ok('24 条温馨提示')
}

{
  const merged = merge(DEFAULT_SETTINGS, { bubble: { phrases: ['a'] } })
  assert.deepEqual(merged.bubble.phrases, ['a'])
  assert.equal(merged.bubble.autoHideSeconds, 20)
  assert.deepEqual(DEFAULT_ROLES.roles[0].id, 'default')
  ok('深合并保留兄弟字段')
}

// ---------------------------------------------------------------- bubble model
{
  const layout = bubble.defaultLayout()
  assert.equal(layout.cards.length, 3)
  assert.deepEqual(layout.cards.map((c) => c.id), ['weather', 'water', 'random'])
  assert.deepEqual(layout.queue, ['weather', 'water', 'random'])
  ok('默认气泡布局')
}

{
  const broken = bubble.normalizeLayout({ cards: 'nope', queue: ['x'] })
  assert.equal(broken.cards.length, 3, '损坏的布局回退到默认卡片')
  assert.deepEqual(broken.queue, ['weather', 'water', 'random'])
  ok('损坏布局回退')
}

{
  const partial = bubble.normalizeLayout({
    cards: [{ id: 'weather', name: '我的天气', rows: [[{ type: 'text', text: 'hi' }]] }],
    queue: ['weather'],
  })
  assert.equal(partial.cards[0].name, '我的天气')
  assert.equal(partial.cards[0].rows.length, 1)
  assert.equal(partial.cards[0].rows[0][0].text, 'hi')
  assert.equal(partial.cards.length, 3, '缺失的卡片补回来')
  ok('部分布局与默认合并')
}

{
  const mod = bubble.normalizeModule({ type: 'weather.temp', style: { size: 999, bold: 1, color: 'red' } })
  assert.equal(mod.type, 'weather.temp')
  assert.equal(mod.style.size, 32, '字号上限')
  assert.equal(mod.style.bold, true)
  assert.equal(mod.style.color, bubble.STYLE_DEFAULT.color, '非法颜色回退')
  assert.equal(bubble.normalizeModule({ type: 'nope' }).type, 'text', '未知类型回退到文本')
  ok('模块归一化与边界')
}

{
  const ctx = {
    weather: { ok: true, city: '北京', temp: 13, text: '晴', low: 7, high: 18, precip: 0, humidity: 79, icon: '☀️', updatedAt: Date.now(), stale: false },
    phrases: ['喝水呀'],
    name: '小芳',
    cups: 2,
  }
  assert.equal(bubble.resolveModule({ type: 'text', text: 'hello', style: {} }, ctx).text, 'hello')
  assert.equal(bubble.resolveModule({ type: 'weather.temp', style: {} }, ctx).text, '13°')
  assert.equal(bubble.resolveModule({ type: 'weather.range', style: {} }, ctx).text, '7~18°')
  assert.equal(bubble.resolveModule({ type: 'random', style: {} }, ctx).text, '喝水呀')
  assert.equal(bubble.resolveModule({ type: 'water.cups', style: {} }, ctx).text, '2')
  assert.equal(bubble.resolveModule({ type: 'weather.hint', style: {} }, ctx).text, '', '非离线时提示为空')
  const offline = bubble.resolveModule({ type: 'weather.hint', style: {} }, { weather: { ok: true, stale: true } })
  assert.equal(offline.text, '离线缓存')
  ok('模块取值（含离线提示）')
}

{
  const card = {
    id: 'weather',
    rows: [
      [{ type: 'text', text: '标题', style: { bold: true, size: 18 } }],
      [{ type: 'weather.hint', style: {} }],
    ],
  }
  const rows = bubble.pruneRows(bubble.resolveCard(card, { weather: { ok: true, stale: false } }))
  assert.equal(rows.length, 1, '空行被剪掉')
  assert.match(rows[0][0].css, /font-weight:600/, '样式转成 css')
  assert.match(rows[0][0].css, /font-size:18px/)
  ok('卡片渲染与空行剪枝')

  // Loading state: one friendly line, no em-dash wall, no glue-only rows.
  {
    const card = bubble.defaultLayout().cards.find((c) => c.id === 'weather')
    const rows = bubble.pruneRows(bubble.resolveCard(card, { weather: null }))
    const flat = rows.map((r) => r.map((m) => m.text).join('')).join(' / ')
    assert.ok(!/—/.test(flat), '天气还没到时不要出现一排破折号: ' + flat)
    assert.match(flat, /正在取天气…/, '天气还没到时给一句等待提示')
    assert.ok(rows.length <= 2, '天气还没到时卡片保持精简: ' + JSON.stringify(rows))
    const noCity = bubble.pruneRows(bubble.resolveCard(card, { weather: { ok: false, error: 'NO_LOCATION', message: '还没告诉我你在哪座城市呢' } }))
    const noCityText = noCity.map((r) => r.map((m) => m.text).join('')).join(' / ')
    assert.match(noCityText, /还没告诉我你在哪座城市呢/, '没设置城市时直接说清楚: ' + noCityText)
    assert.ok(!/正在取天气/.test(noCityText), '没设置城市时不要假装在加载: ' + noCityText)
  }
  ok('天气未加载时的占位')
}

// ------------------------------------------------------------------- sound
{
  const s = soundModel.normalizeSound(undefined)
  assert.equal(s.enabled, true)
  assert.equal(s.volume, 0.45)
  assert.deepEqual(Object.keys(s.events).sort(), ['bubble', 'click', 'water'])
  assert.equal(s.events.click.fragment, 'preset:ding')
  assert.equal(s.events.click.volume, null, '默认跟随总音量')
  ok('默认音效配置')
}

{
  const s = soundModel.normalizeSound({
    enabled: false,
    volume: 2,
    events: { click: { fragment: 'preset:pop', volume: -1, enabled: false }, water: { volume: 0.3 } },
  })
  assert.equal(s.volume, 1, '总音量被夹到 0..1')
  assert.equal(s.events.click.fragment, 'preset:pop')
  assert.equal(s.events.click.volume, 0, '单事件音量被夹到 0..1')
  assert.equal(s.events.click.enabled, false)
  assert.equal(s.events.water.volume, 0.3)
  assert.equal(s.events.water.fragment, 'preset:drop', '未指定的字段用默认值')
  ok('音效归一化与边界')
}

{
  const base = soundModel.normalizeSound({ volume: 0.5 })
  assert.equal(soundModel.eventVolume(base, 'click'), 0.5, '跟随总音量')
  const explicit = soundModel.normalizeSound({ volume: 0.5, events: { click: { volume: 0.8 } } })
  assert.equal(soundModel.eventVolume(explicit, 'click'), 0.8)
  const muted = soundModel.normalizeSound({ enabled: false })
  assert.equal(soundModel.eventVolume(muted, 'click'), 0)
  const eventOff = soundModel.normalizeSound({ events: { bubble: { enabled: false } } })
  assert.equal(soundModel.eventVolume(eventOff, 'bubble'), 0)
  assert.ok(soundModel.eventVolume(eventOff, 'click') > 0)
  ok('事件音量回退与静音')
}

{
  const files = [{ id: 's1', name: '我的提示音' }]
  assert.equal(soundModel.fragmentLabel('preset:ding'), '叮')
  assert.equal(soundModel.fragmentLabel('file:s1', files), '我的提示音')
  assert.equal(soundModel.fragmentLabel('file:nope', files), '（文件已删除）')
  assert.equal(soundModel.isKnownFragment('preset:pop'), true)
  assert.equal(soundModel.isKnownFragment('file:s1', files), true)
  assert.equal(soundModel.isKnownFragment('file:nope', files), false)
  ok('片段标签与有效性')
}

{
  const entry = store.addSound('测试音', 'wav', Buffer.from([1, 2, 3, 4]))
  assert.ok(entry.id)
  assert.equal(store.readSounds().files.length, 1)
  assert.ok(fs.existsSync(store.soundPath(entry.id)), '音频文件已落盘')
  assert.equal(store.soundPath('nope'), '')
  const del = store.deleteSound(entry.id)
  assert.equal(del.ok, true)
  assert.equal(store.readSounds().files.length, 0)
  assert.equal(fs.existsSync(store.soundPath(entry.id)), false, '删除时清理文件')
  assert.equal(store.deleteSound('nope').ok, false)
  ok('音效片段增删与文件落盘')
}

{
  const merged = merge(DEFAULT_SETTINGS, { sound: { events: { click: { volume: 0.9 } } } })
  assert.equal(merged.sound.events.click.volume, 0.9)
  assert.equal(merged.sound.events.water.fragment, 'preset:drop', '兄弟字段保留')
  assert.equal(merged.sound.volume, DEFAULT_SETTINGS.sound.volume)
  ok('音效深合并')
}

// ----------------------------------------------------------------- placement
const DISPLAYS = [
  { id: '1', primary: true, workArea: { x: 0, y: 0, width: 1920, height: 1080 } },
  { id: '2', primary: false, workArea: { x: 1920, y: 0, width: 1280, height: 1024 } },
]
const SIZE = 220
const PAD = 54

{
  const res = placement.resolveSaved(null, DISPLAYS, SIZE, PAD, 24)
  assert.equal(res.displayId, '1')
  assert.equal(res.moved, false)
  assert.equal(res.x, 1920 - SIZE - 24 - PAD, '右下角（窗口坐标）')
  assert.equal(res.y, 1080 - SIZE - 24)
  ok('无保存位置 → 主屏右下角')
}

{
  const saved = { x: 2000 + PAD, y: 120, displayId: '2' }
  const res = placement.resolveSaved(saved, DISPLAYS, SIZE, PAD, 24)
  assert.equal(res.displayId, '2')
  assert.equal(res.moved, false)
  assert.equal(res.x, saved.x)
  assert.equal(res.y, saved.y)
  ok('记住所属显示器')
}

{
  // saved display gone, point still inside the other screen
  const res = placement.resolveSaved({ x: 2000 + PAD, y: 120, displayId: 'removed' }, DISPLAYS, SIZE, PAD, 24)
  assert.equal(res.displayId, '2')
  assert.equal(res.moved, false)
  ok('显示器被拔掉 → 按坐标重新归属')
}

{
  const res = placement.resolveSaved({ x: 9000, y: 4000, displayId: 'removed' }, DISPLAYS, SIZE, PAD, 24)
  assert.equal(res.displayId, '2', '夹到最近的显示器')
  assert.equal(res.moved, true)
  assert.ok(res.x + PAD + SIZE <= 1920 + 1280, '仍在屏内')
  assert.ok(res.y + SIZE <= 1024)
  ok('离屏保存 → 夹回最近屏幕')
}

{
  const tiny = { x: 0, y: 0, width: 100, height: 100 }
  const clamped = placement.clampPet({ x: 50, y: 50, width: 220, height: 220 }, tiny)
  assert.deepEqual({ x: clamped.x, y: clamped.y }, { x: 0, y: 0 })
  ok('窗口大于屏幕时贴左上')
}

{
  const area = { x: 0, y: 0, width: 1920, height: 1080 }
  const near = placement.snapPet({ x: 12, y: 1080 - 220 - 9, width: 220, height: 220 }, area, 18)
  assert.equal(near.x, 0)
  assert.equal(near.snapped.left, true)
  assert.equal(near.y, 1080 - 220)
  assert.equal(near.snapped.bottom, true)
  const far = placement.snapPet({ x: 200, y: 200, width: 220, height: 220 }, area, 18)
  assert.equal(far.x, 200)
  assert.equal(far.y, 200)
  assert.deepEqual(far.snapped, { left: false, right: false, top: false, bottom: false })
  const off = placement.snapPet({ x: 12, y: 12, width: 220, height: 220 }, area, 0)
  assert.equal(off.x, 12, 'gap=0 时不吸附')
  const right = placement.snapPet({ x: 1920 - 220 - 15, y: 400, width: 220, height: 220 }, area, 18)
  assert.equal(right.snapped.right, true)
  assert.equal(right.x, 1920 - 220)
  ok('贴边吸附（四边与阈值）')
}

{
  assert.equal(placement.displayAt(DISPLAYS, { x: 2200, y: 300 }).id, '2')
  assert.equal(placement.displayAt(DISPLAYS, { x: 50, y: 50 }).id, '1')
  assert.equal(placement.displayForRect(DISPLAYS, { x: 1860, y: 100, width: 220, height: 220 }).id, '2',
    '大部分在屏幕 2 上')
  ok('显示器归属判定')
}

// ------------------------------------------------------------------ cutout
{
  // Absolute sigmoid scores, no per-image min/max stretch. A flat or dark
  // score map must not be "normalised" into a foreground mask.
  const alpha = cutoutMath.normalizeMask(new Float32Array([0.1, 0.3, 0.5, 0.9, -0.2, 1.4]), 6)
  assert.ok(alpha)
  assert.ok(Math.abs(alpha[0] - 0.1) < 1e-6)
  assert.ok(Math.abs(alpha[2] - 0.5) < 1e-6)
  assert.equal(alpha[4], 0, '负值夹到 0')
  assert.equal(alpha[5], 1, '超界夹到 1')
  assert.ok(cutoutMath.normalizeMask(new Float32Array([0.2, 0.2, 0.2]), 3), '平坦输出不再返回 null')
  ok('蒙版绝对分数映射（无 min-max 漂移）')
}

{
  const w = 7
  const h = 7
  const scores = new Float32Array(w * h)
  scores[1 * w + 1] = 0.9
  scores[1 * w + 2] = 0.3
  scores[2 * w + 2] = 0.3
  scores[6 * w + 0] = 0.3 // isolated medium response, below the seed threshold
  const mask = cutoutMath.hysteresisMask(scores, w, h, 0.22, 0.55)
  assert.equal(mask[1 * w + 1], 1)
  assert.equal(mask[1 * w + 2], 1, '低阈值但连到核心的区域保留')
  assert.equal(mask[2 * w + 2], 1)
  assert.equal(mask[6 * w + 0], 0, '孤立的中间响应不当作前景')
  ok('双阈值滞回分割')
}

{
  const alpha = new Float32Array(25)
  alpha[6] = 0.9
  alpha[7] = 0.9
  alpha[11] = 0.9
  alpha[12] = 0.9
  alpha[24] = 0.8 // far from the 2x2 blob
  const keep = cutoutMath.largestComponent(alpha, 5, 5, 0.5)
  assert.ok(keep)
  assert.equal(keep[6], 1)
  assert.equal(keep[12], 1)
  assert.equal(keep[24], 0, '丢掉零散前景')
  const diag = new Float32Array(9)
  diag[0] = 1
  diag[4] = 1
  const diagonal = cutoutMath.largestComponent(diag, 3, 3, 0.5)
  assert.equal(diagonal[0], 1)
  assert.equal(diagonal[4], 1, '8 邻接下对角线相连')
  ok('保留主要人像连通域（8 邻接）')
}

{
  const w = 9
  const h = 9
  const mask = new Uint8Array(w * h)
  for (let y = 2; y < 7; y++) for (let x = 2; x < 7; x++) mask[y * w + x] = 1
  mask[0] = 1 // speck
  const opened = cutoutMath.openMask(mask, w, h)
  assert.equal(opened[0], 0, '开运算去掉孤立噪点')
  assert.equal(opened[4 * w + 4], 1, '主体保留')
  const gapped = new Uint8Array(w * h)
  for (let y = 2; y < 7; y++) { gapped[y * w + 2] = 1; gapped[y * w + 4] = 1 }
  const closed = cutoutMath.closeMask(gapped, w, h)
  assert.equal(closed[4 * w + 3], 1, '闭运算桥接 1px 断缝')
  ok('开/闭运算清理蒙版')
}

{
  const w = 7
  const h = 7
  const mask = new Uint8Array(w * h).fill(1)
  for (let y = 2; y < 5; y++) for (let x = 2; x < 5; x++) mask[y * w + x] = 0
  mask[0] = 0 // touches the frame: not a hole
  const filled = cutoutMath.fillHoles(mask, w, h, 100)
  assert.equal(filled[3 * w + 3], 1, '内部小洞被填上')
  assert.equal(filled[0], 0, '贴着边框的背景不算洞')
  ok('填充内部小洞')
}

{
  const w = 20
  const h = 20
  const mask = new Uint8Array(w * h)
  for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) mask[y * w + x] = 1
  for (let y = 0; y < 4; y++) for (let x = 15; x < 19; x++) mask[y * w + x] = 1 // 16 px satellite
  mask[19 * w + 19] = 1 // 1 px speck
  const keep = cutoutMath.retainComponents(mask, w, h, { minRatio: 0.01, minPixels: 16 })
  assert.ok(keep)
  assert.equal(keep[5 * w + 5], 1, '主主体保留')
  assert.equal(keep[1 * w + 16], 1, '≥1% 的副连通域（手/耳）保留')
  assert.equal(keep[19 * w + 19], 0, '过小的噪点丢弃')
  assert.equal(cutoutMath.retainComponents(new Uint8Array(w * h), w, h), null, '空蒙版返回 null')
  ok('多连通域保留与空蒙版')
}

{
  const rgba = Buffer.from([200, 100, 50, 128, 0, 0, 0, 0])
  const bgra = pixels.rgbaToPremultipliedBGRA(rgba, 2, 1)
  assert.deepEqual(Array.from(bgra), [25, 50, 100, 128, 0, 0, 0, 0], '写入预乘 BGRA')
  const back = pixels.bgraToRGBA(bgra, 2, 1, true)
  assert.ok(Math.abs(back[0] - 200) <= 1 && Math.abs(back[1] - 100) <= 1 && Math.abs(back[2] - 50) <= 1)
  assert.equal(back[3], 128)
  ok('预乘 BGRA 与 straight RGBA 互转')
}

{
  const original = Buffer.from([200, 100, 50, 128, 1, 2, 3, 255, 0, 0, 0, 0, 9, 8, 7, 0])
  const file = pngCodec.encodePNG(2, 2, original)
  const decoded = pngCodec.decodePNG(file)
  assert.deepEqual(Array.from(decoded.data), Array.from(original), 'PNG 编解码逐字节一致')
  assert.equal(decoded.width, 2)
  assert.equal(decoded.height, 2)
  ok('PNG 直通 alpha 编解码')
}

{
  // The M11 bug: 50% alpha colour washed out because straight alpha was fed
  // to a premultiplied API. Compose must keep (200,100,50,128).
  const w = 64
  const h = 64
  const src = Buffer.alloc(w * h * 4)
  for (let y = 16; y < 48; y++) {
    for (let x = 16; x < 48; x++) {
      const p = (y * w + x) * 4
      src[p] = 200
      src[p + 1] = 100
      src[p + 2] = 50
      src[p + 3] = 128
    }
  }
  const mask = new Float32Array(w * h).fill(1)
  const out = pixels.composeMaskedCanvas({
    src, sw: w, sh: h, mask, mw: w, mh: h,
    bounds: { x: 0, y: 0, width: w, height: h },
    fit: { x: 0, y: 0, width: w, height: h, scale: 1 },
    canvas: w,
    feather: 0,
  })
  const center = (32 * w + 32) * 4
  assert.ok(Math.abs(out[center] - 200) <= 1, 'straight 红通道不冲白')
  assert.ok(Math.abs(out[center + 1] - 100) <= 1)
  assert.ok(Math.abs(out[center + 2] - 50) <= 1)
  assert.ok(Math.abs(out[center + 3] - 128) <= 1)
  const corner = 0
  assert.deepEqual([out[corner], out[corner + 1], out[corner + 2], out[corner + 3]], [0, 0, 0, 0],
    '完全透明区保持 0')
  const a = out[center + 3] / 255
  const onWhite = [0, 1, 2].map((i) => Math.round(out[center + i] * a + 255 * (1 - a)))
  const onBlack = [0, 1, 2].map((i) => Math.round(out[center + i] * a))
  assert.deepEqual(onWhite, [227, 177, 152], '白底合成不变成纯白')
  assert.deepEqual(onBlack, [100, 50, 25], '黑底合成不变成灰雾')
  ok('50% alpha 色块在合成/白底/黑底保持颜色')
}

{
  // Resampling a transparent image must not fog the clear area or bleed white.
  const w = 64
  const h = 64
  const src = Buffer.alloc(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    const p = i * 4
    src[p] = 255
    src[p + 1] = 255
    src[p + 2] = 255
    src[p + 3] = 0
  }
  for (let y = 16; y < 48; y++) {
    for (let x = 16; x < 48; x++) {
      const p = (y * w + x) * 4
      src[p] = 200
      src[p + 1] = 100
      src[p + 2] = 50
      src[p + 3] = 255
    }
  }
  const small = pixels.resampleStraight(src, w, h, 32, 32)
  assert.deepEqual([small[0], small[1], small[2], small[3]], [0, 0, 0, 0], '透明区缩放后仍 alpha=0')
  const inner = (16 * 32 + 16) * 4
  assert.deepEqual([small[inner], small[inner + 1], small[inner + 2], small[inner + 3]], [200, 100, 50, 255])
  ok('透明区缩放不发雾、不染白')
}

{
  // Edge pixels must take colour from the subject, not from the background
  // they happen to sit on (classic green/blue halo).
  const size = 200
  const src = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const p = (y * size + x) * 4
      const inside = (x - 100) * (x - 100) + (y - 100) * (y - 100) <= 70 * 70
      src[p] = inside ? 200 : 0
      src[p + 1] = inside ? 40 : 200
      src[p + 2] = inside ? 40 : 0
      src[p + 3] = 255
    }
  }
  const mask = new Uint8Array(size * size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if ((x - 100) * (x - 100) + (y - 100) * (y - 100) <= 70 * 70) mask[y * size + x] = 1
    }
  }
  const out = pixels.composeMaskedCanvas({
    src, sw: size, sh: size, mask, mw: size, mh: size,
    bounds: { x: 0, y: 0, width: size, height: size },
    fit: { x: 0, y: 0, width: size, height: size, scale: 1 },
    canvas: size,
    feather: 2,
  })
  let mid = 0
  let greenish = 0
  for (let i = 0; i < size * size; i++) {
    const a = out[i * 4 + 3]
    if (a >= 32 && a <= 223) {
      mid++
      if (out[i * 4 + 1] > out[i * 4]) greenish++
    }
  }
  assert.ok(mid > 0)
  assert.equal(greenish, 0, '边缘颜色来自主体，而不是绿色背景')
  ok('边缘去色污（背景色不渗入）')
}

{
  // End-to-end geometry: disc mask -> 610 canvas. Background must stay clear,
  // the subject solid, and the edge soft over 2–4 px.
  const size = 320
  const src = Buffer.alloc(size * size * 4)
  for (let i = 0; i < size * size; i++) {
    const p = i * 4
    src[p] = 180
    src[p + 1] = 150
    src[p + 2] = 130
    src[p + 3] = 255
  }
  const mask = new Uint8Array(size * size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - 160
      const dy = y - 160
      if (dx * dx + dy * dy <= 90 * 90) mask[y * size + x] = 1
    }
  }
  const bounds = { x: 40, y: 40, width: 240, height: 240 }
  const fit = cutoutMath.fitRect(bounds.width, bounds.height, 610)
  const out = pixels.composeMaskedCanvas({
    src, sw: size, sh: size, mask, mw: size, mh: size, bounds, fit, canvas: 610, feather: 2,
  })
  const bands = pixels.alphaBands(out)
  assert.ok(bands.zeroPct > 40, '画布大部分透明')
  assert.ok(bands.nonEdgeMidPct < 5, '半透明像素集中在边缘')
  let darkFringe = 0
  for (let i = 0; i < 610 * 610; i++) {
    const a = out[i * 4 + 3]
    if (a > 32 && a < 250 && out[i * 4] < 100) darkFringe++
  }
  assert.equal(darkFringe, 0, '羽化过渡带不能是黑色（要用真实图像颜色）')
  const fg = new Uint8Array(610 * 610)
  for (let i = 0; i < fg.length; i++) fg[i] = out[i * 4 + 3] > 127 ? 1 : 0
  const core = cutoutMath.erode(cutoutMath.erode(cutoutMath.erode(fg, 610, 610), 610, 610), 610, 610)
  let coreCount = 0
  let solid = 0
  for (let i = 0; i < core.length; i++) {
    if (!core[i]) continue
    coreCount++
    if (out[i * 4 + 3] >= 250) solid++
  }
  assert.ok(coreCount > 0)
  assert.ok((solid / coreCount) * 100 >= 98, '主体内部不透明 ≥98%')
  const boundary = new Uint8Array(fg.length)
  const eroded = cutoutMath.erode(fg, 610, 610)
  let boundaryPixels = 0
  for (let i = 0; i < fg.length; i++) {
    boundary[i] = fg[i] !== eroded[i] ? 1 : 0
    if (boundary[i]) boundaryPixels++
  }
  const edgeWidth = bands.soft + bands.medium
  assert.ok(edgeWidth / boundaryPixels >= 1.8 && edgeWidth / boundaryPixels <= 4.2,
    '边缘过渡带 2–4px，实测 ' + (edgeWidth / boundaryPixels).toFixed(2))
  ok('610 合成：背景透明/主体不透明/软边过渡')
}

{
  const alpha = new Float32Array([
    0, 0, 0, 0,
    0, 1, 1, 0,
    0, 1, 1, 0,
    0, 0, 0, 0,
  ])
  const b = cutoutMath.maskBounds(alpha, 4, 4, 0.5)
  assert.deepEqual(b, { x: 1, y: 1, width: 2, height: 2 })
  ok('透明蒙版包围盒')
}

{
  const fit = cutoutMath.fitRect(1080, 1920, 610)
  assert.equal(fit.height, 573)
  assert.equal(fit.width, 323)
  assert.equal(fit.y, 31)
  assert.equal(fit.x, 144)
  ok('610 画布底部居中适配')
}

{
  const entry = store.addRole('回退角色', Buffer.from([0x89, 0x50, 0x4e, 0x47]), { cutout: false, mode: 'fallback' })
  const saved = store.readRoles().roles.find((r) => r.id === entry.id)
  assert.equal(saved.cutout, false, '回退角色记录 cutout:false')
  assert.equal(saved.mode, 'fallback')
  const cut = store.addRole('抠图角色', Buffer.from([0x89, 0x50, 0x4e, 0x47]), { cutout: true, mode: 'cutout' })
  assert.equal(store.readRoles().roles.find((r) => r.id === cut.id).cutout, true)
  store.deleteRole(entry.id)
  store.deleteRole(cut.id)
  ok('角色记录抠图/回退标记')
}

{
  const w = 640
  const h = 960
  const rgba = Buffer.alloc(w * h * 4, 255)
  const lb = cutout.buildModelInput(rgba, w, h, 'letterbox')
  assert.equal(lb.mode, 'letterbox')
  assert.deepEqual(lb.box, { x: 53, y: 0, width: 213, height: 320 })
  assert.equal(lb.input.length, 3 * 320 * 320)
  assert.ok(lb.input[5] < -1.5, 'letterbox 左侧 padding 为黑')
  assert.ok(lb.input[160] > 1, '有效区是白色内容')
  const sq = cutout.buildModelInput(rgba, w, h, 'squash')
  assert.equal(sq.mode, 'squash')
  assert.deepEqual(sq.box, { x: 0, y: 0, width: 320, height: 320 })

  const box = { x: 53, y: 0, width: 213, height: 320 }
  const scores = new Float32Array(320 * 320)
  for (let y = 0; y < 320; y++) {
    for (let x = 0; x < 320; x++) {
      if (x < 53 || x >= 266) scores[y * 320 + x] = 1 // padding only
    }
  }
  for (let y = 150; y < 170; y++) for (let x = 150; x < 170; x++) scores[y * 320 + x] = 1
  const out = cutout.scoresFromBox(scores, box)
  assert.equal(out.length, 320 * 320)
  assert.equal(out[160 * 320 + 160], 1, '有效区中心保留')
  assert.equal(out[5], 0, 'padding 被裁掉，不参与蒙版')
  ok('letterbox 预处理与蒙版反变换')
}

{
  const model = path.join(__dirname, '..', 'assets', 'models', 'u2net_human_seg.onnx')
  assert.ok(fs.existsSync(model), '离线模型已随仓库提供')
  assert.ok(fs.statSync(model).size > 10 * 1024 * 1024, '模型不应是空/占位文件')
  ok('离线抠图模型存在且非占位')
}

{
  // Pet window flicker regressions (0.5.5): touch must not trigger the hover
  // drop-shadow, and the sprite must not animate `filter` on a transparent
  // window. Window resizes must only grow while a bubble is visible.
  const petJs = fs.readFileSync(path.join(__dirname, '..', 'app', 'pet.js'), 'utf8')
  const petCssRaw = fs.readFileSync(path.join(__dirname, '..', 'app', 'pet.css'), 'utf8')
  const petCss = petCssRaw.replace(/\/\*[\s\S]*?\*\//g, '')
  const mainJs = mainSource()
  assert.ok(/pointerType === 'touch'/.test(petJs), '触摸不应触发 hover 样式')
  const petRule = petCss.match(/#pet\s*\{[\s\S]*?\}/)
  assert.ok(petRule, '#pet 规则存在')
  assert.ok(!/transition[\s\S]{0,80}filter/.test(petRule[0]), '#pet 不应过渡 filter')
  assert.ok(/#pet\s*\{[\s\S]*?transition:\s*transform/.test(petCss), '#pet 只过渡 transform')
  // 0.6.2: the bubble always sits above the pet; when the pet is too close to
  // the top it is pushed down so the bubble keeps its full size. The window is
  // only re-bounded when something actually changed.
  const layoutJs = fs.readFileSync(path.join(__dirname, '..', 'app', 'main', 'window-layout.js'), 'utf8')
  assert.ok(/const side = 'above'/.test(layoutJs), '气泡固定出现在桌宠上方（不再翻到下面）')
  assert.ok(/const minTop = work\.y \+ wantReserve/.test(layoutJs), '上方空间不够时把桌宠下移，保留气泡大小')
  assert.ok(/const changed = side !== bubbleSide/.test(layoutJs) && /if \(changed\) \{/.test(layoutJs), '尺寸未变时不调用 setBounds')
  assert.ok(/const floorTop = Math\.min\(maxTop, display\.workArea\.y \+ layout\.reserve\)/.test(mainJs), '拖拽也不能把桌宠拖进气泡预留区')
  assert.ok(/bubbleHidden/.test(fs.readFileSync(path.join(__dirname, '..', 'app', 'preload.js'), 'utf8')) && /pet:bubble-hidden/.test(mainJs), '收起气泡只退出状态、不缩窗口')
  assert.ok(/function updateInteractive/.test(layoutJs) && /pet:rects/.test(mainJs), '命中判定放在主进程轮询（渲染层 mousemove 会漏首个事件）')
  assert.ok(/setIgnoreMouseEvents\(!inside/.test(layoutJs), '命中时恢复可交互')
  assert.ok(/showTouchUi/.test(petJs), '触摸需要无 hover 的菜单入口')
  assert.ok(/\.pet-wrap\.touch-ui \.menu-btn/.test(petCss), 'touch-ui 下菜单按钮可见可点')
  assert.ok(/lastTouchAt/.test(petJs), '触摸后短时间忽略兼容鼠标事件')
  const hoverBlocks = petCss.match(/\.pet-wrap\.hover[^{]*\{[^}]*\}/g) || []
  assert.ok(hoverBlocks.length > 0, 'hover 规则存在')
  assert.ok(hoverBlocks.every((b) => !/filter\s*:/.test(b)), 'hover 不应改 filter')
  assert.ok(/transition:\s*transform\s+0\.16s\s+var\(--ease-out\)/.test(petCss), '#pet 只用单调 ease-out 过渡')
  assert.ok(!/ease-spring/.test((petCss.match(/#pet\s*\{[^}]*\}/) || [''])[0]), '#pet 不用会过冲的 ease-spring')
  const flipRule = (petCss.match(/\.pet-flip\s*\{[^}]*\}/) || [''])[0]
  assert.ok(/filter:\s*drop-shadow/.test(flipRule), '阴影在被缩放的精灵之外（.pet-flip）')
  const petRule2 = (petCss.match(/#pet\s*\{[^}]*\}/) || [''])[0]
  assert.ok(!/filter\s*:/.test(petRule2), '#pet 自身不带 filter')
  assert.ok(/requestAnimationFrame\(flushDrag\)/.test(petJs), '拖动按帧合并 IPC')
  assert.ok(/elapsed < 110/.test(petJs), '按压保持到过渡走完再回弹')
  const storeJs = fs.readFileSync(path.join(__dirname, '..', 'lib', 'store.js'), 'utf8')
  assert.ok(/settingsCache/.test(storeJs), 'settings 读取有缓存（拖动每帧都要读）')
  ok('桌宠窗口：无过冲缩放、阴影不随缩放、拖动按帧合并、settings 有缓存')
}

{
  // Bubble reserve must never move the pet (0.5.7): the old top-clamp shifted the
  // whole pet down by the bubble height when it sat near the top of the screen.
  const mainJs = mainSource()
  const petJs = fs.readFileSync(path.join(__dirname, '..', 'app', 'pet.js'), 'utf8')
  const petCss = fs.readFileSync(path.join(__dirname, '..', 'app', 'pet.css'), 'utf8')
  assert.ok(!/Math\.max\(display\.workArea\.y,/.test(mainJs), '气泡加高不得把窗口顶部 clamp 到工作区（会顶动桌宠）')
  const layoutJs = fs.readFileSync(path.join(__dirname, '..', 'app', 'main', 'window-layout.js'), 'utf8')
  assert.ok(/windowBoundsForPet\(pet\.x, petTop, size, wantReserve\)/.test(layoutJs), '有空间时桌宠屏幕矩形不变，只改窗口高度')
  assert.ok(/const minTop = work\.y \+ wantReserve/.test(layoutJs), '空间不够时桌宠下移，气泡始终在上方')
  assert.ok(/ipcMain\.handle\('pet:bubble'/.test(mainJs), 'pet:bubble 回传授予的空间与侧别')
  assert.ok(/applyBubbleRoom/.test(petJs), '渲染层按授予的空间/侧别定位气泡')
  assert.ok(/aspect-ratio:\s*1026/.test(petCss), '气泡框保持固定比例')
  const preloadJs = fs.readFileSync(path.join(__dirname, '..', 'app', 'preload.js'), 'utf8')
  assert.ok(/setBubble: \(visible, height\) => ipcRenderer\.invoke\('pet:bubble'/.test(preloadJs), 'preload 用 invoke 拿回执')
  ok('桌宠窗口：气泡固定在上方，有空间不动桌宠、空间不够则下移')
}

{
  // 0.6.1 bubble contract: fixed-aspect frame, text in the measured safe area,
  // fixed reserve (no window resize between cards), and the enriched water card.
  const petCss = fs.readFileSync(path.join(__dirname, '..', 'app', 'pet.css'), 'utf8')
  const petJs = fs.readFileSync(path.join(__dirname, '..', 'app', 'pet.js'), 'utf8')
  const petHtml = fs.readFileSync(path.join(__dirname, '..', 'app', 'pet.html'), 'utf8')
  const mainJs = mainSource()
  const modelJs = fs.readFileSync(path.join(__dirname, '..', 'app', 'bubble-model.js'), 'utf8')
  assert.ok(/aspect-ratio:\s*1026\s*\/\s*700/.test(petCss), '气泡框保持 1026:700 固定比例（不再拉伸）')
  assert.ok(!/preserveAspectRatio="none"/.test(petHtml), 'SVG 不再用 preserveAspectRatio=none 拉伸云朵')
  assert.ok(/left: var\(--bubble-vx/.test(petCss) && /top: var\(--bubble-vy/.test(petCss), '文字层按实测云朵中心定位')
  assert.ok(/measureBubbleCentre/.test(petJs), '云朵中心由渲染矩形实测')
  assert.ok(/--bubble-fit/.test(petCss) && /fitBubbleText/.test(petJs), '文字超框时按比例收缩而不是溢出')
  assert.ok(/white-space: normal/.test(petCss), '长文本先换行')
  assert.ok(/FIT_FLOOR\s*=\s*0\.6/.test(petJs), '长文案字号下限 60%（P0-2，不再缩到 45%）')
  assert.ok(!/Math\.max\(0\.45,/.test(petJs), '旧的 0.45 下限已移除')
  assert.ok(/function overflowAmount/.test(petJs) && /firstElementChild/.test(petJs), '溢出用渲染矩形实测（居中安全区两端溢出的内容也要算）')
  assert.ok(/keepRatio/.test(petJs) && /over\.h \/ h/.test(petJs), '截断按实际超出比例整体收缩，而不是每次只剪 10%')
  assert.ok(
    /if \(clickTimer\) \{[\s\S]{0,60}clearTimeout\(clickTimer\)/.test(petJs),
    '真拖动开始时取消待触发的单击计时（否则 dragging 里会冒出 bubble-show）',
  )
  assert.ok(/function clampBubbleText/.test(petJs) && /dataset\.full/.test(petJs), '到下限后逐字截断，并将全文存在 data-full 供重渲染还原')
  assert.ok(/span\.title = full/.test(petJs) && /setAttribute\('aria-label', full\)/.test(petJs), '截断后的全文仍留在 title / aria-label')
  assert.ok(/clampBubbleText\(\)[\s\S]{0,40}\}/.test(petJs), '每次排版都先还原再截断（换卡不叠加省略）')
  assert.ok(/bubbleReserve\(\)/.test(petJs), '同一串气泡内用固定空间，卡片切换不 resize')
  assert.ok(!/resizeForBubble\(0\)/.test(petJs), '运行中不再把窗口缩成 0，杜绝透明窗口 resize 频闪')
  assert.ok(/wireBubbleClick/.test(petJs) && /bubble\.addEventListener\('click'/.test(petJs), '点击气泡收起')
  assert.ok(/band\(0\.05/.test(petJs) && /bubble-bshape/.test(petJs), '气泡命中区跟随绘制出的云朵，而不是矩形框')
  assert.ok(/setIgnoreMouseEvents\(true, \{ forward: true \}\)/.test(mainJs), '固定预留区默认鼠标穿透')
  assert.ok(/sendRects/.test(petJs) && /pet:rects/.test(fs.readFileSync(path.join(__dirname, '..', 'app', 'preload.js'), 'utf8')) && /function updateInteractive/.test(fs.readFileSync(path.join(__dirname, '..', 'app', 'main', 'window-layout.js'), 'utf8')), '渲染层上报命中区、主进程轮询光标决定可交互')

  for (const key of ['water.progress', 'water.interval', 'water.quiet', 'water.last', 'water.tip']) {
    assert.ok(modelJs.includes("key: '" + key + "'"), '新增喝水模块 ' + key)
  }
  assert.equal(bubble.valueOf('water.progress', { cups: 3 }), '●●●○○○○○', '喝水进度按 8 格绘制')
  assert.equal(bubble.valueOf('water.interval', { interval: 60 }), '每 60 分钟')
  assert.equal(bubble.valueOf('water.quiet', { quiet: { from: 23, to: 8 } }), '安静 23 点到 8 点')
  assert.equal(bubble.valueOf('water.quiet', { quiet: null }), '不设安静时段')
  assert.equal(bubble.valueOf('water.last', { lastDrinkAt: 0 }), '今天还没喝呢')
  assert.equal(bubble.valueOf('water.tip', { waterTip: '慢慢喝，别急呀' }), '慢慢喝，别急呀')
  const waterCard = bubble.defaultLayout().cards.find((c) => c.id === 'water')
  assert.ok(waterCard.rows.length >= 5, '喝水卡片默认 5 行（标题/进度/下次/间隔/叮嘱）')
  ok('气泡：固定比例、实测居中、超框收缩 + 截断、固定预留、喝水卡片内容')
}

{
  // M17 P0-1: first-run welcome card.
  const root = path.join(__dirname, '..')
  const html = fs.readFileSync(path.join(root, 'app', 'onboard.html'), 'utf8')
  const css = fs.readFileSync(path.join(root, 'app', 'onboard.css'), 'utf8')
  const js = fs.readFileSync(path.join(root, 'app', 'onboard.js'), 'utf8')
  const mainJs = mainSource()
  const preloadJs = fs.readFileSync(path.join(root, 'app', 'preload.js'), 'utf8')
  const settingsHtml = fs.readFileSync(path.join(root, 'app', 'settings.html'), 'utf8')
  const settingsJs = fs.readFileSync(path.join(root, 'app', 'settings.js'), 'utf8')

  assert.equal(DEFAULT_SETTINGS.onboarded, false, '全新安装默认还没看过引导')
  assert.ok(/ipcMain\.on\('onboard:open'/.test(mainJs) && /ipcMain\.on\('onboard:dismiss'/.test(mainJs), '主进程处理打开/关掉欢迎引导')
  assert.ok(/writeSettings\(\{ onboarded: true \}\)/.test(mainJs), '关掉时记下已经看过')
  assert.ok(/store\.readSettings\(\)\.onboarded !== true/.test(mainJs), '只在那之前自动弹一次')
  assert.ok(/DESKPET_NO_ONBOARD/.test(mainJs), '自动化测试可以关掉自动弹出')
  assert.ok(/openOnboard: \(\) => ipcRenderer\.send\('onboard:open'\)/.test(preloadJs), 'preload 暴露 openOnboard')
  assert.ok(/dismissOnboard: \(\) => ipcRenderer\.send\('onboard:dismiss'\)/.test(preloadJs), 'preload 暴露 dismissOnboard')
  assert.ok(/id="onboardBtn"/.test(settingsHtml), '设置 → 其他 能再看一次')
  assert.ok(/api\.openOnboard\(\)/.test(settingsJs), '设置里的按钮接到 openOnboard')
  assert.ok(/role="dialog"/.test(html) && /aria-labelledby="obTitle"/.test(html), '引导卡是带名称的对话框')
  assert.equal((html.match(/<li class="step">/g) || []).length, 3, '正好三步说明')
  assert.ok(/autofocus/.test(html) && /Escape/.test(js), '键盘默认落在主按钮，Esc 也能关')
  assert.ok(/prefers-reduced-motion/.test(css) && /:focus-visible/.test(css), '引导卡尊重减少动效 + 焦点可见')
  assert.ok(!/min-width:\s*[3-9][0-9][0-9]px/.test(css), '不设死宽度，320px 下也能重排')
  ok('欢迎引导：首启一次、可重看、键盘可关')
}

{
  // M17 P0-3: the tray icon is not guaranteed to be visible, so a global
  // shortcut and a settings row must keep 设置/退出 reachable.
  const root = path.join(__dirname, '..')
  const mainJs = mainSource()
  const preloadJs = fs.readFileSync(path.join(root, 'app', 'preload.js'), 'utf8')
  const settingsHtml = fs.readFileSync(path.join(root, 'app', 'settings.html'), 'utf8')
  const settingsJs = fs.readFileSync(path.join(root, 'app', 'settings.js'), 'utf8')
  const petHtml = fs.readFileSync(path.join(root, 'app', 'pet.html'), 'utf8')

  assert.ok(/globalShortcut/.test(mainJs), '主进程引入 globalShortcut')
  assert.ok(/const ACCELERATOR = 'CommandOrControl\+Alt\+P'/.test(mainJs) && /globalShortcut\.register\(ACCELERATOR, actions\.togglePet\)/.test(mainJs), 'Ctrl+Alt+P 注册为显示/隐藏桌宠')
  assert.ok(/globalShortcut\.unregisterAll\(\)/.test(mainJs), '退出前注销全局快捷键')
  assert.ok(/function togglePet/.test(mainJs) && /click: actions\.togglePet/.test(mainJs), '托盘菜单和快捷键共用同一个显示/隐藏入口')
  assert.ok(/try \{\s*tray = new Tray\(image\)/.test(mainJs), '托盘创建失败不能让主进程崩掉')
  assert.ok(/status = \{ ok: false/.test(mainJs) && /status = image\.isEmpty\(\)/.test(mainJs), '托盘失败/图标为空都记下原因')
  assert.ok(/ipcMain\.handle\('app:status'/.test(mainJs) && /getAppStatus: \(\) => ipcRenderer\.invoke\('app:status'\)/.test(preloadJs), '渲染层能读到托盘与快捷键状态')
  assert.ok(/id="trayStatus"/.test(settingsHtml) && /id="shortcutStatus"/.test(settingsHtml), '设置 → 其他 有托盘/快捷键两行说明')
  assert.ok(/renderAppStatus/.test(settingsJs) && /api\.getAppStatus\(\)/.test(settingsJs), '设置页打开时填入真实状态')
  assert.ok(/托盘这次没显示出来/.test(settingsJs) && /浮出菜单/.test(settingsJs), '托盘失效时说明桌宠的悬浮菜单仍可用')
  assert.ok(/data-action="settings"/.test(petHtml) && /data-action="quit"/.test(petHtml), '桌宠悬浮菜单确实带设置和退出')
  ok('托盘兜底：Ctrl+Alt+P 显示/隐藏、托盘失败可恢复、设置页说明状态')
}

{
  // M17 P0-5: one-click diagnostics export, redacted.
  const root = path.join(__dirname, '..')
  const mainJs = mainSource()
  const preloadJs = fs.readFileSync(path.join(root, 'app', 'preload.js'), 'utf8')
  const settingsHtml = fs.readFileSync(path.join(root, 'app', 'settings.html'), 'utf8')
  const settingsJs = fs.readFileSync(path.join(root, 'app', 'settings.js'), 'utf8')

  assert.ok(/function build\(\)/.test(mainJs) && /createDiagnostics/.test(mainJs) && /ipcMain\.handle\('app:diagnostics'/.test(mainJs), '主进程提供诊断导出')
  assert.ok(/s\.weather\.lat = REDACTED/.test(mainJs) && /s\.weather\.lon = REDACTED/.test(mainJs) && /s\.weather\.city = REDACTED/.test(mainJs), '城市与坐标打码')
  assert.ok(/delete s\.bubble\.phrases/.test(mainJs) && /delete s\.bubble\.layout/.test(mainJs), '自定义短语和不透明的气泡布局不导出')
  assert.ok(/logger\.tail\(logger\.filePath\(\), 200/.test(mainJs) && /cutout-trace\.jsonl/.test(mainJs), '带上 app.log 与 cutout-trace 的尾巴')
  assert.ok(/shell\.showItemInFolder\(file\)/.test(mainJs), '导出后直接打开所在文件夹')
  assert.ok(/id="diagBtn"/.test(settingsHtml) && /exportDiagnostics: \(\) => ipcRenderer\.invoke\('app:diagnostics'\)/.test(preloadJs), '设置页按钮接到 preload')
  assert.ok(/api\.exportDiagnostics\(\)/.test(settingsJs) && /btn\.disabled = true/.test(settingsJs), '导出时按钮禁用、结果写回说明行')
  assert.ok(!/writeFileSync\([^)]*role|copyFileSync/.test(mainJs.slice(mainJs.indexOf('function exportFile'))), '导出过程不复制角色照片')
  ok('诊断导出：一键写 txt、坐标/短语脱敏、带日志尾巴')
}

{
  // M18 P1-1: main.js was split into app/main/*.js; main.js only wires the
  // modules together. Assertions above read the whole set via mainSource().
  const root = path.join(__dirname, '..')
  const modDir = path.join(root, 'app', 'main')
  const mods = fs.readdirSync(modDir).filter((f) => f.endsWith('.js')).sort()
  assert.deepEqual(mods, ['boot.js', 'catalog.js', 'cutout-service.js', 'diagnostics.js', 'fullscreen.js', 'geometry.js', 'ipc.js', 'log.js', 'nudge-pump.js', 'reminder.js', 'tray.js', 'water-ipc.js', 'weather-pump.js', 'window-layout.js', 'windows.js'], 'app/main/ 下的模块名单')
  const mainJs = fs.readFileSync(path.join(root, 'app', 'main.js'), 'utf8')
  for (const name of mods) {
    const file = path.join(modDir, name)
    const text = fs.readFileSync(file, 'utf8')
    assert.ok(/module\.exports = \{/.test(text), name + ' 有导出')
    // ipc.js is a flat list of ~40 handlers; it gets its own (looser) cap so
    // the rest stay small.
    const cap = name === 'ipc.js' ? 430 : 320
    assert.ok(text.split('\n').length <= cap, name + ' 不超过 ' + cap + ' 行')
  }
  assert.ok(/require\('\.\/main\/log'\)/.test(mainJs), 'main.js 引用 log 模块')
  assert.ok(/require\('\.\/main\/geometry'\)/.test(mainJs), 'main.js 引用 geometry 模块')
  assert.ok(/require\('\.\/main\/tray'\)/.test(mainJs) && /createTrayHost\(/.test(mainJs), 'main.js 引用 tray 模块并接线')
  assert.ok(/require\('\.\/main\/diagnostics'\)/.test(mainJs) && /createDiagnostics\(/.test(mainJs), 'main.js 引用 diagnostics 模块并接线')
  assert.ok(/require\('\.\/main\/weather-pump'\)/.test(mainJs) && /createWeatherPump\(/.test(mainJs), 'main.js 引用 weather-pump 并接线')
  assert.ok(/require\('\.\/main\/reminder'\)/.test(mainJs) && /createReminders\(/.test(mainJs), 'main.js 引用 reminder 并接线')
  assert.ok(/require\('\.\/main\/cutout-service'\)/.test(mainJs) && /createCutoutService\(/.test(mainJs), 'main.js 引用 cutout-service 并接线')
  assert.ok(/require\('\.\/main\/ipc'\)/.test(mainJs) && /registerIpc\(\{/.test(mainJs), 'main.js 调用 ipc 注册器')
  assert.ok(!/function registerIpc/.test(mainJs), '旧的 IPC 注册已从 main.js 移出')
  // P1-1 阶段 4：窗口、目录、启动三段也搬出去了，main.js 只剩装配。
  assert.ok(/require\('\.\/main\/windows'\)/.test(mainJs) && /createWindows\(\{/.test(mainJs), 'main.js 引用 windows 工厂并装配')
  assert.ok(/require\('\.\/main\/catalog'\)/.test(mainJs) && /createCatalog\(\{/.test(mainJs), 'main.js 引用 catalog（角色/声音目录）并装配')
  assert.ok(/require\('\.\/main\/boot'\)/.test(mainJs) && /bootDataDir\(\{/.test(mainJs), 'main.js 调用 boot 选数据目录')
  assert.ok(!/new BrowserWindow\(/.test(mainJs), '浏览器窗口全部在 windows.js 里创建')
  assert.ok(!/function pickDataDir|requestSingleInstanceLock/.test(mainJs), '数据目录/单实例锁已移出 main.js')
  assert.ok(!/function roleUrl|function handleRoleProtocol|function broadcastSettings/.test(mainJs), '协议与广播已移出 main.js')
  assert.ok(!/function refreshWeather|function startReminders|function runCutoutDecoded/.test(mainJs), '天气/提醒/抠图实现已移出 main.js')
  assert.ok(mainJs.split('\n').length <= 300, 'main.js 压到 300 行以内（当前 ' + mainJs.split('\n').length + '）')
  assert.ok(!/function buildDiagnostics/.test(mainJs), '旧的诊断实现已从 main.js 移出')
  assert.ok(!/function createTray\(/.test(mainJs), '旧的托盘实现已从 main.js 移出')
  ok('P1-1 拆分：main.js 只接线，模块各自导出且 ≤320 行')
}

{
  // M18 P1-1 stage 1: geometry/log/tray/diagnostics are the first four modules.
  const geo = require(path.join(__dirname, '..', 'app', 'main', 'geometry.js'))
  assert.equal(geo.windowWidth(220), 328, '桌子宽度 = 桌宠 + 两侧留白')
  assert.equal(geo.bubbleReserveFor(328), Math.ceil((316 * 700) / 1026) + 8, '气泡预留按渲染层的同一公式')
  assert.equal(geo.clamp(999, 80, 480), 480, 'clamp 上限')
  assert.equal(geo.clamp(10, 80, 480), 80, 'clamp 下限')
  const log = require(path.join(__dirname, '..', 'app', 'main', 'log.js'))
  assert.equal(typeof log.createLogger, 'function', 'logger 工厂可导入')
  ok('P1-1 模块：geometry 纯函数与 logger 工厂可直接 require')
}

{
  // M19 P1-2: explicit window state machine (app/window-state.js).
  const ws = require(path.join(__dirname, '..', 'app', 'window-state.js'))
  assert.deepEqual(ws.STATES, ['idle', 'bubble', 'menu', 'dragging', 'cutout'], '五态名单')

  // The table is public on purpose: the matrix below is derived from it, so a new
  // state/event cannot be added without this test noticing.
  for (const from of ws.STATES) {
    for (const event of ws.EVENTS) {
      const machine = ws.createWindowState()
      // Move into `from` along a legal path, then fire the event under test.
      const path = { idle: [], bubble: ['bubble-show'], menu: ['menu-open'], dragging: ['drag-start'], cutout: ['cutout-open'] }[from]
      for (const step of path) assert.equal(machine.transition(step).ok, true, from + ' 可由 ' + step + ' 到达')
      assert.equal(machine.state, from)
      const expected = (ws.TABLE[event] && ws.TABLE[event][from]) || null
      const res = machine.transition(event)
      assert.equal(res.ok, !!expected, from + ' + ' + event + ' 合法性')
      if (expected) assert.equal(machine.state, expected, from + ' + ' + event + ' → ' + expected)
      else assert.equal(machine.state, from, '非法事件不改状态')
    }
  }

  // Illegal transitions are counted with context instead of throwing.
  const m = ws.createWindowState()
  const bad = m.transition('drag-end')
  assert.equal(bad.ok, false)
  assert.equal(bad.reason, 'illegal')
  assert.equal(m.illegal, 1)
  assert.equal(m.lastIllegal.from, 'idle')
  assert.equal(m.transition('nope').reason, 'unknown-event')
  assert.equal(m.illegal, 2)

  // The sequences that used to regress in 0.6.3/0.6.4 must stay legal.
  const seq = ws.createWindowState()
  assert.equal(seq.transition('bubble-show').state, 'bubble')
  assert.equal(seq.transition('menu-open').state, 'menu')
  assert.equal(seq.transition('drag-start').state, 'dragging', '菜单里也能开始拖')
  assert.equal(seq.transition('drag-end').state, 'idle')
  assert.equal(seq.transition('bubble-show').state, 'bubble')
  assert.equal(seq.transition('bubble-hide').state, 'idle')
  assert.equal(seq.transition('cutout-open').state, 'cutout')
  assert.equal(seq.transition('cutout-close').state, 'idle')
  assert.equal(seq.illegal, 0, '正常路径零非法转移')
  assert.equal(seq.history.length, 8, '历史最多留 20 条，本例 8 条')

  // onChange fires only on real transitions (consumers react to it).
  const seen = []
  const cb = ws.createWindowState({ onChange: (c) => seen.push(c.prev + '>' + c.next) })
  cb.transition('bubble-show')
  cb.transition('bubble-hide')
  cb.transition('bubble-hide') // illegal, no callback
  assert.deepEqual(seen, ['idle>bubble', 'bubble>idle'], 'onChange 只在合法转移时触发')

  const mainJs2 = fs.readFileSync(path.join(__dirname, '..', 'app', 'main.js'), 'utf8')
  assert.ok(/createWindowState\(/.test(mainJs2), 'main.js 接入状态机')
  assert.ok(!/let petDragging/.test(mainJs2), '旧的 petDragging 布尔已移交给状态机')
  assert.ok(/winState\.is\('dragging'\)/.test(fs.readFileSync(path.join(__dirname, '..', 'app', 'main', 'ipc.js'), 'utf8') +
    fs.readFileSync(path.join(__dirname, '..', 'app', 'main', 'window-layout.js'), 'utf8')), '点击穿透读状态机的 dragging')
  assert.ok(/setMenu: \(open\) => ipcRenderer\.send\('pet:menu'/.test(fs.readFileSync(path.join(__dirname, '..', 'app', 'preload.js'), 'utf8')), 'preload 爆出 setMenu')
  ok('P1-2 状态机：全矩阵转移、非法计数、菜单/拖动/抠图序列与接线')
}

{
  // P1-1 stage 2: window layout module — pure hit test plus a fake-window run
 // of the reserve maths (same numbers the real window produces).
  const layoutMod = require(path.join(__dirname, '..', 'app', 'main', 'window-layout.js'))
  const bounds = { x: 100, y: 200, width: 328, height: 400 }
  assert.equal(layoutMod.hitTest({ x: 150, y: 250 }, bounds, [{ x: 40, y: 40, w: 100, h: 100 }]), true, '命中矩形内')
  assert.equal(layoutMod.hitTest({ x: 139, y: 250 }, bounds, [{ x: 40, y: 40, w: 100, h: 100 }]), false, '矩形左边界外 1px')
  assert.equal(layoutMod.hitTest({ x: 240, y: 340 }, bounds, [{ x: 40, y: 40, w: 100, h: 100 }]), true, '含右下边界')
  assert.equal(layoutMod.hitTest({ x: 250, y: 250 }, bounds, [{ x: 40, y: 40, w: 100, h: 100 }, { x: 150, y: 0, w: 10, h: 10 }]), false, '多个矩形都不中')
  assert.equal(layoutMod.hitTest({ x: 0, y: 0 }, bounds, []), false, '没有矩形时不命中')

  const placementLib = require(path.join(__dirname, '..', 'lib', 'placement'))
  let winBounds = { x: 146, y: 120, width: 328, height: 400 }
  const win = {
    getBounds: () => ({ ...winBounds }),
    setBounds: (b) => { winBounds = { ...b } },
    setBackgroundColor: () => {},
    setIgnoreMouseEvents: () => {},
    isDestroyed: () => false,
  }
  const work = { x: 0, y: 0, width: 1920, height: 1040 }
  const fakeScreen = {
    getPrimaryDisplay: () => ({ id: 1, workArea: work }),
    getAllDisplays: () => [{ id: 1, workArea: work }],
    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    getDisplayNearestPoint: () => ({ id: 1, workArea: work }),
    getDisplayMatching: () => ({ id: 1, workArea: work }),
  }
  const lay = layoutMod.createWindowLayout({
    screen: fakeScreen,
    placement: placementLib,
    readSettings: () => ({ size: 220 }),
    log: () => {},
    winState: { is: (s) => s === 'idle' },
    getWindow: () => win,
    onMirror: () => {},
  })
  lay.begin({ x: 200, y: 300, reserve: 180 })
  assert.deepEqual(lay.petScreenRect(220), { x: 200, top: 300, bottom: 520 }, '有 petPos 时直接用记录的位置')
  assert.deepEqual(lay.windowBoundsForPet(200, 300, 220, 180), { x: 146, y: 120, width: 328, height: 400 }, '窗口 = 桌宠 - 左右留白 / 向上预留')
  assert.equal(lay.mirrorSide(), 'none', '居中不贴边')

  const grown = lay.applyBubbleHeight(170)
  assert.deepEqual(grown, { reserve: 170, side: 'above' }, '气泡固定在上方')
  assert.equal(winBounds.height, 220 + 170, '窗口高 = 桌宠 + 预留')
  assert.equal(winBounds.y, 300 - 170, '向上长，桌宠不动')
  assert.deepEqual(lay.petPos, { x: 200, y: 300 }, '桌宠不该被顶走')

  const shrunk = lay.applyBubbleHeight(0)
  assert.equal(shrunk.reserve, 0, '收气泡时预留归零')
  assert.equal(winBounds.height, 220, '窗口收回到桌宠高度')

  lay.applyBubbleHeight(20)
  assert.equal(lay.reserve, 0, '小于 40px 的残留视为无气泡')

  // Near the top edge the pet is pushed down instead of the bubble flipping.
  lay.begin({ x: 200, y: 20, reserve: 0 })
  winBounds = { x: 146, y: 20, width: 328, height: 220 }
  lay.applyBubbleHeight(180)
  assert.equal(lay.petPos.y, 180, '贴近顶部时桌宠下移到预留线')
  assert.equal(winBounds.y, 0, '窗口顶部仍在工作区内')

  // Click-through: dragging is interactive without waiting for the cursor poll.
  const dragLay = layoutMod.createWindowLayout({
    screen: fakeScreen, placement: placementLib, readSettings: () => ({ size: 220 }), log: () => {},
    winState: { is: (s) => s === 'dragging' }, getWindow: () => win, onMirror: () => {},
  })
  dragLay.updateInteractive()
  assert.equal(dragLay.interactive, true, '拖动中始终可交互')

  const mainJs3 = fs.readFileSync(path.join(__dirname, '..', 'app', 'main.js'), 'utf8')
  const ipcJs3 = fs.readFileSync(path.join(__dirname, '..', 'app', 'main', 'ipc.js'), 'utf8')
  assert.ok(/createWindowLayout\(/.test(mainJs3), 'main.js 接入 window-layout')
  assert.ok(/ipcMain\.handle\('pet:reserve'/.test(ipcJs3), '预留与可见性分开：pet:reserve 只负责 strip')
  assert.ok(/let bubbleVisible = false/.test(ipcJs3), '可见性去重，重复的 bubble-show 不再重复转移')
  const preloadReserve = fs.readFileSync(path.join(__dirname, '..', 'app', 'preload.js'), 'utf8')
  assert.ok(/setReserve: \(height\) => ipcRenderer\.invoke\('pet:reserve'/.test(preloadReserve), 'preload 暴露 setReserve')
  const petJsStage2 = fs.readFileSync(path.join(__dirname, '..', 'app', 'pet.js'), 'utf8')
  assert.ok(/async function reserveSpace/.test(petJsStage2) && /async function showBubbleFrame/.test(petJsStage2), '保留量/可见性拆成两个函数')
  assert.ok(!/let petPos/.test(mainJs3) && !/function applyBubbleHeight/.test(mainJs3), '旧的布局状态与函数已移出 main.js')
  ok('P1-1 阶段 2：命中纯函数、预留增长/收缩、贴边下推、拖动可交互')
}

{
  // M18 P1-1 stage 3: weather pump + reminders are pure modules with an
  // injectable clock, so the rules can be asserted without Electron or a network.
  const pumpMod = require(path.join(__dirname, '..', 'app', 'main', 'weather-pump.js'))
  const reminderMod = require(path.join(__dirname, '..', 'app', 'main', 'reminder.js'))
  const sent = []
  const fakeWindows = [{ isDestroyed: () => false, webContents: { send: (ch, v) => sent.push([ch, v]) } }]
  let settings = { weather: {} }
  const writes = []
  const fakeStore = {
    readSettings: () => settings,
    writeWeatherCache: (entry) => writes.push(entry),
    readWeatherCache: () => ({ value: { ok: true, temp: 21 } }),
  }
  const pump = pumpMod.createWeatherPump({
    store: fakeStore, fetchWeather: async () => ({ ok: true, temp: 30 }), advice: (w) => 'advice:' + w.temp,
    getWindows: () => fakeWindows, clamp: (n, lo, hi) => Math.min(hi, Math.max(lo, n)), now: () => 1000,
  })
  pump.refresh('test')
  assert.equal(pump.current().error, 'NO_LOCATION', '没城市时给 NO_LOCATION')
  assert.equal(pump.current().error, 'NO_LOCATION', 'NO_LOCATION 也写进 current()')
  assert.equal(sent[sent.length - 1][0], 'weather:changed', '无城市时也广播')

  settings = { weather: { lat: 30, lon: 120, city: '上海', refreshMinutes: 1 } }
  const failing = pumpMod.createWeatherPump({
    // Throws synchronously: `refresh` then finishes in one turn and the result
    // is observable without awaiting (the real fetch does await).
    store: fakeStore, fetchWeather: () => { throw new Error('offline') }, advice: (w) => 'advice:' + w.temp,
    getWindows: () => fakeWindows, clamp: (n, lo, hi) => Math.min(hi, Math.max(lo, n)), now: () => 1000,
  })
  const stale = failing.refresh('test')
  assert.equal(failing.current().stale, true, '取数失败时回退缓存并标 stale')
  assert.equal(failing.current().advice, 'advice:21', '旧缓存补上建议句')
  assert.deepEqual(failing.current().hourly, [], '旧缓存补上空小时条')
  assert.ok(stale && typeof stale.then === 'function', 'refresh 仍返回 promise', 0)
  assert.equal(failing.schedule(), 5, '刷新间隔下限夹到 5 分钟')
  assert.ok(failing.intervalMs() >= 5 * 60000 - 5, '定时器确实按夹取后的间隔跑')
  failing.stop()
  assert.equal(failing.intervalMs(), 0, 'stop() 清掉定时器')

  let clock = 0
  const waterSettings = { mode: 'normal', water: { intervalMinutes: 60, lastDrinkAt: 0 } }
  const reminders = reminderMod.createReminders({
    store: { readSettings: () => waterSettings },
    clamp: (n, lo, hi) => Math.min(hi, Math.max(lo, n)),
    isPetVisible: () => true,
    sendToPet: (ch) => sent.push(['pet:' + ch, null]),
    notify: () => sent.push(['notify', null]),
    now: () => clock,
  })
  assert.equal(reminders.tick(), 'not-due', '还没到点时不提醒')
  clock = 61 * 60000
  assert.equal(reminders.tick(), 'reminded', '到点后提醒一次')
  assert.equal(sent[sent.length - 1][0], 'pet:remind:water', '桌宠可见时走进气泡')
  assert.equal(reminders.tick(), 'throttled', '10 分钟内的第二次请求被限流')
  assert.equal(reminderMod.REMIND_FLOOR_MS, 600000, '限流窗口 10 分钟')
  waterSettings.mode = 'quiet'
  clock = 4 * 3600000
  assert.equal(reminders.tick(), 'quiet-mode', '勿扰模式完全不提醒')
  waterSettings.mode = 'normal'
  waterSettings.water.quietFrom = 22
  waterSettings.water.quietTo = 8
  const quiet = reminderMod.createReminders({
    store: { readSettings: () => waterSettings }, clamp: (n, lo, hi) => Math.min(hi, Math.max(lo, n)),
    isPetVisible: () => false, sendToPet: () => {}, notify: () => {}, now: () => new Date(2026, 9, 22, 23, 30).getTime(),
  })
  assert.equal(quiet.tick(), 'quiet-hours', '跨午夜的免打扰区间判定正确')
  assert.equal(reminderMod.createReminders({
    store: { readSettings: () => waterSettings }, clamp: (n, lo, hi) => Math.min(hi, Math.max(lo, n)),
    isPetVisible: () => false, sendToPet: () => {}, notify: () => {}, now: () => new Date(2026, 9, 22, 12, 0).getTime(),
  }).inQuietHours({ quietFrom: 13, quietTo: 14 }), false, '同一天的免打扰区间之外不静音')
  ok('P1-1 阶段 3：天气回退/夹取，喝水提醒的到点、限流、勿扰与跨午夜')
}

{
  // P1-4: settings usability — search, one-line hints, per-panel reset, recent cities.
  const root = path.join(__dirname, '..')
  const settingsHtml = fs.readFileSync(path.join(root, 'app', 'settings.html'), 'utf8')
  const settingsJs = fs.readFileSync(path.join(root, 'app', 'settings.js'), 'utf8')
  const settingsCss = fs.readFileSync(path.join(root, 'app', 'settings.css'), 'utf8')
  const preloadJs = fs.readFileSync(path.join(root, 'app', 'preload.js'), 'utf8')
  const mainJs = mainSource()

  // Defaults are a public, read-only contract now.
  const snapshot = store.defaults()
  assert.equal(snapshot.name, '小芳')
  assert.deepEqual(snapshot.weather.recent, [], '最近城市默认空')
  snapshot.name = '被改坏了'
  snapshot.weather.recent.push('深圳')
  assert.equal(store.defaults().name, '小芳', 'defaults() 每次给一份新副本')
  assert.deepEqual(store.defaults().weather.recent, [], '副本里改数组不影响默认值')
  assert.ok(/DEFAULT_SETTINGS\.weather\.recent/.test(fs.readFileSync(path.join(root, 'lib', 'store.js'), 'utf8')) ||
    /recent: \[\]/.test(fs.readFileSync(path.join(root, 'lib', 'store.js'), 'utf8')), '默认设置里带 recent')

  const deduped = store.writeSettings({ weather: { recent: ['深圳', ' 深圳 ', '', '杭州', '深圳', '成都', '西安', '重庆'] } })
  assert.deepEqual(deduped.weather.recent, ['深圳', '杭州', '成都', '西安', '重庆'], '手写进 settings.json 的重复/空城市会被规整')
  assert.deepEqual(store.readSettings().weather.recent, ['深圳', '杭州', '成都', '西安', '重庆'], '读回来也是规整过的')
  store.writeSettings({ weather: { recent: [] } })

  assert.ok(/ipcMain\.handle\('settings:defaults'/.test(mainJs), '主进程提供只读默认值')
  assert.ok(/getDefaults: \(\) => ipcRenderer\.invoke\('settings:defaults'\)/.test(preloadJs), 'preload 暴露 getDefaults')

  // Search box + results container.
  assert.ok(/id="settingSearch"/.test(settingsHtml) && /type="search"/.test(settingsHtml), '侧边栏有搜索框')
  assert.ok(/id="searchResults"/.test(settingsHtml) && /aria-label="设置项搜索结果"/.test(settingsHtml), '有结果列表且带名称')
  assert.ok(/aria-describedby="searchHint"/.test(settingsHtml) && /id="searchHint"/.test(settingsHtml), '搜索框连着示例提示')

  // Every indexed target must still exist in the page.
  const ids = new Set(Array.from(settingsHtml.matchAll(/id="([A-Za-z0-9_-]+)"/g)).map((m) => m[1]))
  const indexed = Array.from(settingsJs.matchAll(/\{ panel: '([a-z]+)', id: '([A-Za-z0-9_-]+)'/g))
  assert.ok(indexed.length >= 20, '搜索索引覆盖主要设置项（' + indexed.length + ' 项）')
  const missing = indexed.filter((m) => !ids.has(m[2])).map((m) => m[2])
  assert.deepEqual(missing, [], '索引里的控件都还在页面上')
  const panelsSeen = new Set(indexed.map((m) => m[1]))
  assert.deepEqual(Array.from(panelsSeen).sort(), ['appearance', 'bubble', 'other', 'reminder', 'role', 'sound', 'weather'], '七个面板都能被搜到')

  // Matching: label beats aliases beats panel name.
  assert.ok(/if \(label\.includes\(q\)\) score = 3/.test(settingsJs) && /else if \(keys\.includes\(q\)\) score = 2/.test(settingsJs), '打分：标题 > 同义词 > 面板名')
  assert.ok(/scored\.slice\(0, 8\)/.test(settingsJs), '结果最多 8 条')
  assert.ok(/function revealSetting/.test(settingsJs) && /scrollIntoView\(\{ block: 'center'/.test(settingsJs) && /field-flash/.test(settingsJs), '点结果会切面板、滚动定位、闪一下')
  assert.ok(/prefers-reduced-motion: reduce/.test(settingsJs), '减少动效时不平滑滚动')
  assert.ok(/addEventListener\('keydown'[\s\S]{0,400}ArrowDown/.test(settingsJs) && /Escape/.test(settingsJs), '搜索框支持方向键和 Esc')

  // Per-panel reset.
  assert.ok(/id="resetPanelBtn"/.test(settingsHtml) && /id="resetConfirm"/.test(settingsHtml), '顶栏有恢复默认按钮和确认层')
  assert.ok(/role="alertdialog"/.test(settingsHtml) && /aria-labelledby="resetConfirmText"/.test(settingsHtml), '确认层是带名称的告警对话框')
  assert.ok(/id="resetCancel"/.test(settingsHtml) && /id="resetOk"/.test(settingsHtml), '确认层有取消和确认')
  const patchBody = (settingsJs.match(/function panelResetPatch\(panel\) \{([\s\S]*?)\n  \}\n/) || [])[1] || ''
  for (const panel of ['appearance', 'bubble', 'reminder', 'weather', 'sound']) {
    assert.ok(patchBody.includes("'" + panel + "'"), '能恢复「' + panel + '」这一页')
  }
  assert.ok(!/panel === 'role'/.test(patchBody), '角色页是图片，不提供恢复默认')
  assert.ok(/save\(patch, true,/.test(settingsJs), '恢复后立即写盘')
  assert.ok(/if \(!panelResetPatch\(panel\)\) \{ setStatus\('这一页没有可以恢复的默认值'/.test(settingsJs), '没有默认值时明确告知')

  // One-line hints on every field.
  const panelChunks = settingsHtml.split('<section class="panel').slice(1)
  const withoutHint = []
  panelChunks.forEach((chunk) => {
    chunk.split('<div class="field">').slice(1).forEach((field) => {
      const label = (field.match(/class="field-label"[^>]*>([^<]+)</) || [])[1] || '?'
      if (!/class="field-hint"|<em>/.test(field)) withoutHint.push(label.trim())
    })
  })
  assert.deepEqual(withoutHint, [], '每个设置项都有一句话说明')

  // Recent cities.
  assert.ok(/id="recentCities"/.test(settingsHtml) && /aria-label="最近用过的城市"/.test(settingsHtml), '天气页有最近城市一行')
  assert.ok(/function noteRecentCity/.test(settingsJs) && /\.slice\(0, 5\)/.test(settingsJs), '最近城市最多记 5 个')
  assert.ok(/\[clean\]\.concat\(\(weather\.recent \|\| \[\]\)\.filter\(\(item\) => item !== clean\)\)/.test(settingsJs), '重复城市提到最前而不是重复出现')
  assert.ok(/noteRecentCity\(item\.name\)/.test(settingsJs), '选中城市后记一笔')
  assert.ok(/setAttribute\('aria-pressed', String\(name === current\)\)/.test(settingsJs), '当前城市在最近列表里是按下态')

  // Styles exist for the new pieces.
  for (const cls of ['.search-result', '.reset-confirm', '.chip-city', '.field-flash', '.ghost-small']) {
    assert.ok(settingsCss.includes(cls), '样式里有 ' + cls)
  }
  assert.ok(/@media \(prefers-reduced-motion: reduce\)/.test(settingsCss), '减少动效的兜底还在')
  ok('P1-4 设置可用性：搜索、每项一句说明、按页恢复默认、最近城市')
}

// ------------------------------------------------- P1-5: water log
{
  const root = path.join(__dirname, '..')
  const preloadJs = fs.readFileSync(path.join(root, 'app', 'preload.js'), 'utf8')
  const petJs = fs.readFileSync(path.join(root, 'app', 'pet.js'), 'utf8')
  const settingsHtml = fs.readFileSync(path.join(root, 'app', 'settings.html'), 'utf8')
  const settingsJs = fs.readFileSync(path.join(root, 'app', 'settings.js'), 'utf8')
  const settingsCss = fs.readFileSync(path.join(root, 'app', 'settings.css'), 'utf8')
  const reminderJs = fs.readFileSync(path.join(root, 'app', 'main', 'reminder.js'), 'utf8')
  const ipcJs = fs.readFileSync(path.join(root, 'app', 'main', 'ipc.js'), 'utf8')
  const waterIpcJs = fs.readFileSync(path.join(root, 'app', 'main', 'water-ipc.js'), 'utf8')
  const storeJs = fs.readFileSync(path.join(root, 'lib', 'store.js'), 'utf8')
  const waterLog = require(path.join(root, 'lib', 'water-log.js'))

  // Pure module.
  assert.equal(typeof waterLog.summarize, 'function', 'water-log 导出 summarize')
  assert.equal(typeof waterLog.toCsv, 'function', 'water-log 导出 toCsv')
  assert.equal(typeof waterLog.dayKey, 'function', 'water-log 导出 dayKey')

  // Settings shape + upgrade path.
  const s0 = store.readSettings()
  assert.equal(s0.water.cupMl, 200, '默认一杯 200ml')
  assert.equal(s0.water.snoozeUntil, 0, '默认没有延后')
  assert.deepEqual(s0.water.log, [], '默认没有记录')
  const next = store.writeSettings({ water: { log: [
    { at: 300, ml: 100 }, { at: 100, ml: 'bad' }, { at: 200, ml: 250 },
  ] } })
  assert.deepEqual(next.water.log.map((i) => i.at), [100, 200, 300], '记录按时间排序，坏数据被清掉')
  store.writeSettings({ water: { cupMl: 5 } })
  assert.equal(store.readSettings().water.cupMl, 50, '杯量下限 50ml')
  store.writeSettings({ water: { cupMl: 200, log: [], snoozeUntil: 0 } })

  // Reminder honours the snooze before the interval.
  assert.ok(/snoozed/.test(reminderJs), '提醒会识别 snooze')
  assert.ok(
    reminderJs.indexOf("'snoozed'") < reminderJs.indexOf('const interval = clamp'),
    'snooze 判定在间隔判定之前'
  )

  // Main process wiring.
  for (const channel of ["'pet:water-snooze'", "'water:stats'", "'water:export'"]) {
    assert.ok(waterIpcJs.includes(channel), 'water-ipc 有 ' + channel)
  }
  assert.ok(/registerWaterIpc\(/.test(ipcJs), 'ipc.js 调用 registerWaterIpc')
  assert.ok(/waterLog\.dayKey\(/.test(waterIpcJs), '记一杯时用同一个 dayKey')
  assert.ok(/snoozeUntil: 0/.test(waterIpcJs), '喝了水会清掉 snooze')
  assert.ok(/water-.*\.csv/.test(waterIpcJs), '导出文件名是 water-<stamp>.csv')

  // Preload surface.
  for (const api of ['waterSnooze', 'getWaterStats', 'exportWaterCsv']) {
    assert.ok(new RegExp(api + ':').test(preloadJs), 'preload 暴露 ' + api)
  }

  // Pet bubble: the defer button snoozes instead of just hiding.
  assert.ok(/稍后 10 分钟/.test(petJs), '气泡上有「稍后 10 分钟」')
  assert.ok(/api\.waterSnooze\(10\)/.test(petJs), '点「稍后 10 分钟」会写入 snooze')

  // Settings panel.
  for (const id of ['waterTimeline', 'waterWeek', 'cupMl', 'exportWaterBtn']) {
    assert.ok(settingsHtml.includes('id="' + id + '"'), '设置页有 ' + id)
  }
  assert.ok(/refreshWaterStats\(\)/.test(settingsJs), '有刷新喝水记录的入口')
  assert.ok(/panelId === 'reminder'/.test(settingsJs), '切到提醒页时刷新')
  for (const cls of ['.water-timeline', '.water-week', '.ghost-small']) {
    assert.ok(settingsCss.includes(cls), '样式里有 ' + cls)
  }
  ok('P1-5 喝水记录：稍后 10 分钟、今日时间轴、本周杯数、CSV 导出')
}

// ------------------------------------------------- P1-6: weather +
{
  const modelJs = fs.readFileSync(path.join(__dirname, '..', 'app', 'bubble-model.js'), 'utf8')
  const editorJs = fs.readFileSync(path.join(__dirname, '..', 'app', 'editor.js'), 'utf8')
  const weatherJs = fs.readFileSync(path.join(__dirname, '..', 'lib', 'weather.js'), 'utf8')
  assert.ok(/forecast_days=3/.test(weatherJs), '天气请求取三天')
  assert.ok(/air-quality-api\.open-meteo\.com/.test(weatherJs), '空气质量来自独立 host')
  assert.ok(/function aqiGrade/.test(weatherJs), 'aqiGrade 纯函数')
  assert.ok(/function parseDays/.test(weatherJs), 'parseDays 纯函数')
  assert.ok(/function fetchAirQuality/.test(weatherJs), 'fetchAirQuality 单独失败')
  assert.ok(weatherJs.includes('air,') && weatherJs.includes('const air = await fetchAirQuality'), 'result 带 air 字段')
  assert.ok(weatherJs.includes('days,') && weatherJs.includes('const days = parseDays'), 'result 带 days 字段')
  assert.ok(/aqiGrade, parseDays, fetchAirQuality/.test(weatherJs), '导出纯函数供单测')

  for (const type of ['air.quality', 'air.pm', 'weather.days']) {
    assert.ok(modelJs.includes("key: '" + type + "'"), '模块类型 ' + type)
    assert.ok(modelJs.includes("case '" + type + "'"), 'valueOf 处理 ' + type)
  }
  const card = bubble.defaultLayout().cards.find((c) => c.id === 'weather')
  const flat = card.rows.flat()
  assert.ok(flat.some((m) => m.type === 'air.quality'), '默认天气卡带空气质量行')
  assert.ok(flat.some((m) => m.type === 'weather.days'), '默认天气卡带未来两天行')
  assert.ok(weatherJs.length > 0 && editorJs.includes("mk('air.quality')"), '编辑器丰富预设含空气质量')
  ok('P1-6 天气增强：空气质量、未来三天、逐日日出日落')
}

// ------------------------------------------------- P1-7: 主动说话
{
  const nudges = require(path.join(__dirname, '..', 'lib', 'nudges.js'))
  const ipcJs = fs.readFileSync(path.join(__dirname, '..', 'app', 'main', 'ipc.js'), 'utf8')
  const preloadJs = fs.readFileSync(path.join(__dirname, '..', 'app', 'preload.js'), 'utf8')
  const petJs = fs.readFileSync(path.join(__dirname, '..', 'app', 'pet.js'), 'utf8')
  const settingsHtml = fs.readFileSync(path.join(__dirname, '..', 'app', 'settings.html'), 'utf8')
  const settingsJs = fs.readFileSync(path.join(__dirname, '..', 'app', 'settings.js'), 'utf8')
  const mainJs = fs.readFileSync(path.join(__dirname, '..', 'app', 'main.js'), 'utf8')
  const pumpJs = fs.readFileSync(path.join(__dirname, '..', 'app', 'main', 'nudge-pump.js'), 'utf8')
  const fgJs = fs.readFileSync(path.join(__dirname, '..', 'app', 'main', 'fullscreen.js'), 'utf8')

  assert.equal(typeof nudges.decide, 'function', 'lib/nudges 导出 decide')
  assert.equal(typeof nudges.isNightHour, 'function', 'lib/nudges 导出 isNightHour')
  assert.equal(store.readSettings().nudge.enabled, true, '默认开启主动说话')
  assert.equal(store.readSettings().nudge.longUse, true, '默认开启久坐提醒')

  for (const ch of ['pet:activity', 'nudge:probe']) {
    assert.ok(ipcJs.includes(ch), 'ipc 注册 ' + ch)
  }
  for (const fn of ['reportActivity', 'onNudge', 'probeNudge']) {
    assert.ok(preloadJs.includes(fn + ':'), 'preload 暴露 ' + fn)
  }
  assert.ok(/showNudge/.test(petJs) && /onNudge\(\(data\) => showNudge\(data\)\)/.test(petJs), '宠物渲染主动说话')
  assert.ok(/reportActivity/.test(petJs) && /wireActivity/.test(petJs), '宠物上报互动')
  for (const id of ['nudgeEnabled', 'nudgeLongUse', 'nudgeLateNight', 'nudgeAway']) {
    assert.ok(settingsHtml.includes('id="' + id + '"'), '设置页有 ' + id)
    assert.ok(settingsJs.includes("$('" + id + "')"), '设置页接线 ' + id)
  }
  assert.ok(/createNudgePump/.test(mainJs) && /nudges\.start\(\)/.test(mainJs), '主进程启动说话泵')
  assert.ok(/isForegroundFullscreen/.test(mainJs), '全屏时不说话')

  // 泵只做调度：决策全在纯函数里；全屏探测失败按“不是全屏”处理，不能永远不说话。
  assert.ok(/require\('\.\.\/\.\.\/lib\/nudges\.js'\)/.test(pumpJs), '泵复用纯决策')
  assert.ok(/isBusy/.test(pumpJs) && /nudge skipped: foreground is fullscreen/.test(pumpJs), '全屏时跳过并记录')
  assert.ok(/ttl|TTL_MS/i.test(fgJs) && /execFile/.test(fgJs), '全屏探测有缓存且不阻塞')
  assert.ok(/nudge skipped/.test(pumpJs), '跳过有日志')

  // 三个触发器各自可关：任一关掉后 decide 不再返回该 kind。
  const now = new Date(2026, 9, 23, 14, 0, 0).getTime()
  const MIN = 60000
  assert.equal(nudges.decide({ now, sessionStart: now - 60 * MIN, lastInteraction: now - MIN }).kind, 'long-use')
  assert.equal(nudges.decide({ now, cfg: { longUse: false }, sessionStart: now - 60 * MIN, lastInteraction: now - MIN }), null)
  assert.equal(nudges.decide({ now, lastInteraction: now - 150 * MIN }).kind, 'away')
  assert.equal(nudges.decide({ now, cfg: { away: false }, lastInteraction: now - 150 * MIN }), null)
  ok('P1-7 主动说话：久坐/深夜/久未互动三触发器 + 全屏闭嘴 + 设置开关')
}

console.log('\n' + pass + ' checks passed')
fs.rmSync(dir, { recursive: true, force: true })
