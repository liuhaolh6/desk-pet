/**
 * `lib/weather.js` — 天气文案与 WMO 映射（纯函数部分）。
 *
 * 只测不碰网络的分支：`describe()` 的码表、`advice()` 的优先级、以及入参校验。
 * `fetchWeather()` 的解析逻辑依赖 HTTP，留给运行时验证。
 */
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const weather = require('../../lib/weather.js')

const { describe, advice, WMO, TIMEOUT_MS, fetchWeather } = weather

test('describe：已知天气码给出文案与图标', () => {
  assert.deepEqual(describe(0), { text: '晴', icon: '☀️' })
  assert.deepEqual(describe(61), { text: '小雨', icon: '🌦️' })
  assert.deepEqual(describe(95), { text: '雷阵雨', icon: '⛈️' })
})

test('describe：未知或缺失的码回退“未知天气”', () => {
  assert.equal(describe(999).text, '未知天气')
  assert.equal(describe(undefined).icon, '🌡️')
  assert.equal(describe('abc').text, '未知天气')
})

test('advice：没有温度时返回空串（不硬编文案）', () => {
  assert.equal(advice(null), '')
  assert.equal(advice({}), '')
  assert.equal(advice({ temp: NaN }), '')
})

test('advice：下雪优先于下雨', () => {
  assert.match(advice({ temp: -2, code: 73 }), /下雪/)
  assert.match(advice({ temp: 2, code: 71, precip: 90 }), /下雪/)
})

test('advice：下雨码或高降水概率都提醒带伞', () => {
  assert.match(advice({ temp: 18, code: 61 }), /带伞/)
  assert.match(advice({ temp: 18, code: 0, precip: 80 }), /带伞/)
})

test('advice：体感温度决定冷/凉', () => {
  assert.match(advice({ temp: 0, feels: 2, code: 0 }), /冷/)
  assert.match(advice({ temp: 12, feels: 10, code: 0 }), /外套/)
})

test('advice：紫外线、酷热、大风', () => {
  assert.match(advice({ temp: 26, feels: 26, code: 0, uv: 9 }), /防晒/)
  assert.match(advice({ temp: 30, feels: 34, code: 0 }), /多喝水/)
  assert.match(advice({ temp: 20, feels: 20, code: 0, wind: 40 }), /风好大/)
})

test('advice：舒适区间与兜底文案都非空', () => {
  assert.match(advice({ temp: 24, feels: 24, code: 0, uv: 2, wind: 5 }), /舒服/)
  assert.ok(advice({ temp: 16, feels: 16, code: 0, uv: 1, wind: 1 }).length > 0)
})

test('WMO：码表覆盖常见天气，且每项都是 [文案, 图标]', () => {
  for (const code of [0, 3, 45, 61, 71, 80, 95, 99]) {
    assert.ok(Array.isArray(WMO[code]) && WMO[code].length === 2, '缺少天气码 ' + code)
  }
  assert.equal(TIMEOUT_MS, 8000)
})

test('fetchWeather：缺经纬度时以错误拒绝，而不是发出请求', async () => {
  await assert.rejects(() => fetchWeather({}), /缺少经纬度/)
  await assert.rejects(() => fetchWeather({ lat: 'x', lon: 1 }), /缺少经纬度/)
})