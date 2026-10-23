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
const { createI18n } = require('../../lib/i18n.js')

// 文案已全部走字典：单测显式注入 zh-CN 翻译器
const tr = createI18n({ locale: 'zh-CN', dict: require('../../locales/zh-CN.json') }).t

const { describe, advice, aqiGrade, parseDays, fetchAirQuality, WMO_ICON, TIMEOUT_MS, fetchWeather } = weather

test('describe：已知天气码给出文案与图标', () => {
  assert.deepEqual(describe(0, tr), { text: '晴', icon: '☀️' })
  assert.deepEqual(describe(61, tr), { text: '小雨', icon: '🌦️' })
  assert.deepEqual(describe(95, tr), { text: '雷阵雨', icon: '⛈️' })
})

test('describe：未知或缺失的码回退“未知天气”', () => {
  assert.equal(describe(999, tr).text, '未知天气')
  assert.equal(describe(undefined, tr).icon, '🌡️')
  assert.equal(describe('abc', tr).text, '未知天气')
})

test('advice：没有温度时返回空串（不硬编文案）', () => {
  assert.equal(advice(null, tr), '')
  assert.equal(advice({}, tr), '')
  assert.equal(advice({ temp: NaN }, tr), '')
})

test('advice：下雪优先于下雨', () => {
  assert.match(advice({ temp: -2, code: 73 }, tr), /下雪/)
  assert.match(advice({ temp: 2, code: 71, precip: 90 }, tr), /下雪/)
})

test('advice：阵雨(80-82)不是下雪——别把 8x 全当成雪', () => {
  for (const code of [80, 81, 82]) {
    assert.match(advice({ temp: 20, code, precip: 100 }, tr), /带伞/)
    assert.doesNotMatch(advice({ temp: 20, code, precip: 100 }, tr), /下雪/)
  }
  assert.match(advice({ temp: 0, code: 85 }, tr), /下雪/)
  assert.match(advice({ temp: -2, code: 77 }, tr), /下雪/)
})

test('advice：下雨码或高降水概率都提醒带伞', () => {
  assert.match(advice({ temp: 18, code: 61 }, tr), /带伞/)
  assert.match(advice({ temp: 18, code: 0, precip: 80 }, tr), /带伞/)
})

test('advice：体感温度决定冷/凉', () => {
  assert.match(advice({ temp: 0, feels: 2, code: 0 }, tr), /冷/)
  assert.match(advice({ temp: 12, feels: 10, code: 0 }, tr), /外套/)
})

test('advice：紫外线、酷热、大风', () => {
  assert.match(advice({ temp: 26, feels: 26, code: 0, uv: 9 }, tr), /防晒/)
  assert.match(advice({ temp: 30, feels: 34, code: 0 }, tr), /多喝水/)
  assert.match(advice({ temp: 20, feels: 20, code: 0, wind: 40 }, tr), /风好大/)
})

test('advice：舒适区间与兜底文案都非空', () => {
  assert.match(advice({ temp: 24, feels: 24, code: 0, uv: 2, wind: 5 }, tr), /舒服/)
  assert.ok(advice({ temp: 16, feels: 16, code: 0, uv: 1, wind: 1 }, tr).length > 0)
})

test('WMO_ICON：码表覆盖常见天气，每个码都有图标', () => {
  for (const code of [0, 3, 45, 61, 71, 80, 95, 99]) {
    assert.equal(typeof WMO_ICON[code], 'string', '缺少天气码 ' + code)
  }
  assert.equal(TIMEOUT_MS, 8000)
})

test('fetchWeather：缺经纬度时以错误拒绝，而不是发出请求', async () => {
  await assert.rejects(() => fetchWeather({ t: tr }), /缺少经纬度/)
  await assert.rejects(() => fetchWeather({ lat: 'x', lon: 1, t: tr }), /缺少经纬度/)
})

test('aqiGrade：按欧洲 AQI 分级，边界值落在上一档', () => {
  assert.equal(aqiGrade(0, tr).text, '优')
  assert.equal(aqiGrade(20, tr).text, '优')
  assert.equal(aqiGrade(21, tr).text, '良')
  assert.equal(aqiGrade(40, tr).text, '良')
  assert.equal(aqiGrade(61, tr).text, '较差')
  assert.equal(aqiGrade(95, tr).text, '很差')
  assert.equal(aqiGrade(180, tr).text, '极差')
})

test('aqiGrade：缺失/非法值返回 null（不能把 null 当成 0 说“优”）', () => {
  assert.equal(aqiGrade(null), null)
  assert.equal(aqiGrade(undefined), null)
  assert.equal(aqiGrade(''), null)
  assert.equal(aqiGrade(-1), null)
  assert.equal(aqiGrade('abc'), null)
})

test('parseDays：今天/明天/后天三天，含日出日落与降水概率', () => {
  const days = parseDays({
    time: ['2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26'],
    weather_code: [1, 61, 3, 0],
    temperature_2m_max: [18, 15, 17, 19],
    temperature_2m_min: [7, 6, 8, 9],
    precipitation_probability_max: [0, 80, 10, 0],
    sunrise: ['2026-10-23T06:42', '2026-10-24T06:43', '2026-10-25T06:44', '2026-10-26T06:45'],
    sunset: ['2026-10-23T17:21', '2026-10-24T17:20', '2026-10-25T17:19', '2026-10-26T17:18'],
  }, tr)
  assert.equal(days.length, 3)
  assert.equal(days[1].label, '明天')
  assert.equal(days[1].text, '小雨')
  assert.equal(days[1].high, 15)
  assert.equal(days[1].precip, 80)
  assert.equal(days[2].sunset, '17:19')
})

test('parseDays：空数据返回空数组（不抛）', () => {
  assert.deepEqual(parseDays(null, tr), [])
  assert.deepEqual(parseDays({}, tr), [])
})

test('fetchAirQuality：上游报错时返回 null，不把天气卡带崩', async (t) => {
  const real = globalThis.fetch
  t.after(() => { globalThis.fetch = real })
  globalThis.fetch = async () => { throw new Error('offline') }
  assert.equal(await fetchAirQuality(30.2, 120.1, tr), null)
  globalThis.fetch = async () => ({ ok: false, status: 502, json: async () => ({}) })
  assert.equal(await fetchAirQuality(30.2, 120.1, tr), null)
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ current: {} }) })
  assert.equal(await fetchAirQuality(30.2, 120.1, tr), null)
})

test('fetchAirQuality：正常响应映射成可展示结构', async (t) => {
  const real = globalThis.fetch
  t.after(() => { globalThis.fetch = real })
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ current: { european_aqi: 35.4, pm2_5: 12.2, pm10: 20 } }),
  })
  const air = await fetchAirQuality(30.2, 120.1, tr)
  assert.equal(air.aqi, 35)
  assert.equal(air.text, '良')
  assert.equal(air.pm25, 12)
  assert.match(air.tip, /出去走走/)
})
