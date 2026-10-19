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

console.log('\n' + pass + ' checks passed')
fs.rmSync(dir, { recursive: true, force: true })
