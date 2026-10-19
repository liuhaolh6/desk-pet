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

console.log('\n' + pass + ' checks passed')
fs.rmSync(dir, { recursive: true, force: true })
