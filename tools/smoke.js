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
const { describe, WMO } = require('../lib/weather')
const bubble = require('../app/bubble-model')
const soundModel = require('../app/sound-model')

let pass = 0
function ok(name) { pass += 1; console.log('  ✓', name) }

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deskpet-'))
const store = createStore(dir)

// ---------------------------------------------------------------- store
{
  const s = store.readSettings()
  assert.equal(s.name, '小芳桌宠')
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

console.log('\n' + pass + ' checks passed')
fs.rmSync(dir, { recursive: true, force: true })
