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
  const mainJs = fs.readFileSync(path.join(__dirname, '..', 'app', 'main.js'), 'utf8')
  assert.ok(/pointerType === 'touch'/.test(petJs), '触摸不应触发 hover 样式')
  const petRule = petCss.match(/#pet\s*\{[\s\S]*?\}/)
  assert.ok(petRule, '#pet 规则存在')
  assert.ok(!/transition[\s\S]{0,80}filter/.test(petRule[0]), '#pet 不应过渡 filter')
  assert.ok(/#pet\s*\{[\s\S]*?transition:\s*transform/.test(petCss), '#pet 只过渡 transform')
  // 0.6.2: the bubble always sits above the pet; when the pet is too close to
  // the top it is pushed down so the bubble keeps its full size. The window is
  // only re-bounded when something actually changed.
  assert.ok(/const side = 'above'/.test(mainJs), '气泡固定出现在桌宠上方（不再翻到下面）')
  assert.ok(/const minTop = work\.y \+ reserve/.test(mainJs), '上方空间不够时把桌宠下移，保留气泡大小')
  assert.ok(/const changed = side !== bubbleSide/.test(mainJs) && /if \(changed\) \{/.test(mainJs), '尺寸未变时不调用 setBounds')
  assert.ok(/const floorTop = Math\.min\(maxTop, display\.workArea\.y \+ extraBubbleHeight\)/.test(mainJs), '拖拽也不能把桌宠拖进气泡预留区')
  assert.ok(/updatePetInteractive/.test(mainJs) && /pet:rects/.test(mainJs), '命中判定放在主进程轮询（渲染层 mousemove 会漏首个事件）')
  assert.ok(/petWin\.setIgnoreMouseEvents\(!inside/.test(mainJs), '命中时恢复可交互')
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
  const mainJs = fs.readFileSync(path.join(__dirname, '..', 'app', 'main.js'), 'utf8')
  const petJs = fs.readFileSync(path.join(__dirname, '..', 'app', 'pet.js'), 'utf8')
  const petCss = fs.readFileSync(path.join(__dirname, '..', 'app', 'pet.css'), 'utf8')
  assert.ok(!/Math\.max\(display\.workArea\.y,/.test(mainJs), '气泡加高不得把窗口顶部 clamp 到工作区（会顶动桌宠）')
  assert.ok(/windowBoundsForPet\(pet\.x, petTop, size, reserve\)/.test(mainJs), '有空间时桌宠屏幕矩形不变，只改窗口高度')
  assert.ok(/const minTop = work\.y \+ reserve/.test(mainJs), '空间不够时桌宠下移，气泡始终在上方')
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
  const mainJs = fs.readFileSync(path.join(__dirname, '..', 'app', 'main.js'), 'utf8')
  const modelJs = fs.readFileSync(path.join(__dirname, '..', 'app', 'bubble-model.js'), 'utf8')
  assert.ok(/aspect-ratio:\s*1026\s*\/\s*700/.test(petCss), '气泡框保持 1026:700 固定比例（不再拉伸）')
  assert.ok(!/preserveAspectRatio="none"/.test(petHtml), 'SVG 不再用 preserveAspectRatio=none 拉伸云朵')
  assert.ok(/left: var\(--bubble-vx/.test(petCss) && /top: var\(--bubble-vy/.test(petCss), '文字层按实测云朵中心定位')
  assert.ok(/measureBubbleCentre/.test(petJs), '云朵中心由渲染矩形实测')
  assert.ok(/--bubble-fit/.test(petCss) && /fitBubbleText/.test(petJs), '文字超框时按比例收缩而不是溢出')
  assert.ok(/white-space: normal/.test(petCss), '长文本先换行')
  assert.ok(/bubbleReserve\(\)/.test(petJs), '同一串气泡内用固定空间，卡片切换不 resize')
  assert.ok(!/resizeForBubble\(0\)/.test(petJs), '运行中不再把窗口缩成 0，杜绝透明窗口 resize 频闪')
  assert.ok(/wireBubbleClick/.test(petJs) && /bubble\.addEventListener\('click'/.test(petJs), '点击气泡收起')
  assert.ok(/band\(0\.05/.test(petJs) && /bubble-bshape/.test(petJs), '气泡命中区跟随绘制出的云朵，而不是矩形框')
  assert.ok(/setIgnoreMouseEvents\(true, \{ forward: true \}\)/.test(mainJs), '固定预留区默认鼠标穿透')
  assert.ok(/sendRects/.test(petJs) && /pet:rects/.test(fs.readFileSync(path.join(__dirname, '..', 'app', 'preload.js'), 'utf8')) && /updatePetInteractive/.test(mainJs), '渲染层上报命中区、主进程轮询光标决定可交互')

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
  ok('气泡：固定比例、实测居中、超框收缩、固定预留、喝水卡片内容')
}

console.log('\n' + pass + ' checks passed')
fs.rmSync(dir, { recursive: true, force: true })
