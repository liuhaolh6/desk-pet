/**
 * `app/bubble-model.js` — 气泡卡片的数据模型（纯函数，无 DOM/Electron）。
 *
 * 这些用例把编辑器与渲染共用的“归一化 + 取值”行为钉死：样式夹取、非法输入
 * 回退、空行裁剪、缺天气时的占位文本。UI 层面的排版不在这里测。
 */
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const model = require('../../app/bubble-model.js')

const { newModule, normalizeStyle, normalizeModule, normalizeRow, normalizeCard, normalizeLayout, resolveCard, valueOf, styleToString, defaultLayout, STYLE_DEFAULT } = model

test('newModule：文字模块保留文本，其他类型把 text 清空', () => {
  const text = newModule('text', '你好')
  assert.equal(text.type, 'text')
  assert.equal(text.text, '你好')
  assert.deepEqual(text.style, STYLE_DEFAULT)

  const temp = newModule('weather.temp', '不该保留')
  assert.equal(temp.type, 'weather.temp')
  assert.equal(temp.text, '')
})

test('newModule：未知类型回退成 text', () => {
  const mod = newModule('nope.nope', '还是文字')
  assert.equal(mod.type, 'text')
  assert.equal(mod.text, '还是文字')
})

test('normalizeStyle：字号夹在 9–32 并取整', () => {
  assert.equal(normalizeStyle({ size: 3 }).size, 9)
  assert.equal(normalizeStyle({ size: 99 }).size, 32)
  assert.equal(normalizeStyle({ size: 12.6 }).size, 13)
  assert.equal(normalizeStyle({ size: 'abc' }).size, STYLE_DEFAULT.size)
})

test('normalizeStyle：颜色只接受 #hex，非法回退默认', () => {
  assert.equal(normalizeStyle({ color: 'red' }).color, STYLE_DEFAULT.color)
  assert.equal(normalizeStyle({ color: '#abc' }).color, '#abc')
  assert.equal(normalizeStyle({ bg: '#ffffff' }).bg, '#ffffff')
  assert.equal(normalizeStyle({ bg: 'gradient' }).bg, '')
  assert.equal(normalizeStyle().bold, false)
  assert.equal(normalizeStyle({ bold: 1 }).bold, true)
})

test('normalizeModule：未知类型回退 text，null 丢弃，文本截断到 200 字', () => {
  assert.equal(normalizeModule({ type: 'nope' }).type, 'text')
  assert.equal(normalizeModule(null), null)
  const mod = normalizeModule({ id: 'keep-me', type: 'text', text: 'x'.repeat(500) })
  assert.equal(mod.id, 'keep-me')
  assert.equal(mod.text.length, 200)
})

test('normalizeRow：最多 8 个模块，过滤非法项，非数组返回空', () => {
  const many = Array.from({ length: 10 }, (_, i) => ({ type: 'text', text: 'm' + i }))
  assert.equal(normalizeRow(many).length, 8)
  assert.equal(normalizeRow([null, { type: 'nope' }]).length, 1, '未知类型回退成 text，null 被丢掉')
  assert.deepEqual(normalizeRow('not-an-array'), [])
})

test('normalizeCard：名称 ≤20 字、行数 ≤6、action 只能是布尔', () => {
  const card = normalizeCard({
    name: '卡'.repeat(40),
    rows: Array.from({ length: 8 }, () => [{ type: 'text', text: 'x' }]),
    action: 'yes',
  })
  assert.equal(card.name.length, 20)
  assert.equal(card.rows.length, 6)
  assert.equal(card.action, false)
})

test('normalizeLayout：队列只保留仍存在的卡片，缺省时回退默认队列', () => {
  const layout = normalizeLayout({
    cards: [{ id: 'weather', name: '天气', rows: [[{ type: 'text', text: '晴' }]] }],
    queue: ['weather', 'deleted-card'],
  })
  assert.deepEqual(layout.queue, ['weather'])

  const fallback = normalizeLayout(null)
  assert.equal(fallback.version, 1)
  assert.ok(fallback.cards.length >= 1)
  assert.ok(fallback.queue.length >= 1)
  assert.ok(fallback.queue.every((id) => fallback.cards.some((c) => c.id === id)))
})

test('normalizeLayout：未出现的默认卡片会被补回来', () => {
  const layout = normalizeLayout({ cards: [{ id: 'weather', rows: [[{ type: 'text', text: '晴' }]] }] })
  const ids = layout.cards.map((c) => c.id)
  assert.ok(ids.includes('weather'))
  assert.ok(ids.length >= defaultLayout().cards.length)
})

test('resolveCard：只有连接符（·、/）的行被丢掉', () => {
  const card = {
    rows: [
      [{ type: 'text', text: '·' }],
      [{ type: 'text', text: '你好' }],
    ],
  }
  const rows = resolveCard(card, {})
  assert.equal(rows.length, 1)
  assert.equal(rows[0][0].text, '你好')
})

test('resolveCard：动态模块全为空时整行丢掉（不显示空标签）', () => {
  const card = {
    rows: [
      [{ type: 'text', text: '体感' }, { type: 'weather.feels' }],
      [{ type: 'text', text: '早上好' }],
    ],
  }
  const rows = resolveCard(card, { weather: null })
  assert.equal(rows.length, 1)
  assert.equal(rows[0][0].text, '早上好')
})

test('valueOf：名字缺省为「桌宠」', () => {
  assert.equal(valueOf('name', {}), '桌宠')
  assert.equal(valueOf('name', { name: '小芳' }), '小芳')
})

test('valueOf：天气各字段的格式', () => {
  const ctx = {
    weather: {
      ok: true, temp: 13.4, feels: 11.2, low: 7, high: 18, precip: 0.2,
      humidity: 79, wind: 12.4, code: 0, text: '晴', icon: '☀️', city: '北京',
    },
  }
  assert.equal(valueOf('weather.icon', ctx), '☀️')
  assert.equal(valueOf('weather.temp', ctx), '13°')
  assert.equal(valueOf('weather.text', ctx), '晴')
  assert.equal(valueOf('weather.feels', ctx), '体感 11°')
  assert.equal(valueOf('weather.range', ctx), '7~18°')
  assert.equal(valueOf('weather.precip', ctx), '0%')
  assert.equal(valueOf('weather.humidity', ctx), '79%')
  assert.equal(valueOf('weather.wind', ctx), '风 12km/h')
  assert.equal(valueOf('weather.city', ctx), '北京')
})

test('valueOf：天气未就绪时只给一句提示，数字字段留空', () => {
  assert.equal(valueOf('weather.city', { weather: { ok: false, message: '定位中' } }), '定位中')
  assert.equal(valueOf('weather.city', {}), '正在取天气…')
  assert.equal(valueOf('weather.temp', { weather: { ok: false } }), '')
  assert.equal(valueOf('weather.tip', {}), '')
})

test('valueOf：紫外线、明天、未来几小时', () => {
  const ctx = {
    weather: {
      ok: true, uv: 5.6,
      tomorrow: { low: 6, high: 15, text: '多云' },
      hourly: [
        { hour: 15, temp: 14, icon: '⛅' },
        { hour: 16, temp: 15, icon: '☁️' },
      ],
    },
  }
  assert.equal(valueOf('weather.uv', ctx), '紫外线 6')
  assert.equal(valueOf('weather.tomorrow', ctx), '明天 6°~15° 多云')
  assert.equal(valueOf('weather.hourly', ctx), '15点 14° ⛅ → 16点 15° ☁️')
})

test('valueOf：天气未来两天压成一行，缺数据时留空', () => {
  const ctx = {
    weather: {
      ok: true,
      days: [
        { label: '今天', high: 18, low: 7 },
        { label: '明天', high: 15, low: 6, icon: '🌦️' },
        { label: '后天', high: 17, low: 8, icon: '☁️' },
      ],
    },
  }
  assert.equal(valueOf('weather.days', ctx), '明天 6~15° 🌦️ · 后天 8~17° ☁️')
  assert.equal(valueOf('weather.days', { weather: { ok: true } }), '')
  assert.equal(valueOf('weather.days', { weather: { ok: true, days: [{ label: '今天' }] } }), '')
})

test('valueOf：空气模块在缺空气数据时不显示（断网也不出现空洞）', () => {
  const withAir = { weather: { ok: true, air: { aqi: 35, text: '良', pm25: 12 } } }
  assert.equal(valueOf('air.quality', withAir), '空气良（35）')
  assert.equal(valueOf('air.pm', withAir), 'PM2.5 12')
  assert.equal(valueOf('air.quality', { weather: { ok: true } }), '')
  assert.equal(valueOf('air.pm', { weather: { ok: true, air: { aqi: 35 } } }), '')
  assert.equal(valueOf('air.quality', { weather: { ok: false, air: { aqi: 35, text: '良' } } }), '')
})

test('默认天气卡带一行空气 + 未来两天，且都是低对比度小字', () => {
  const card = defaultLayout().cards.find((c) => c.id === 'weather')
  const flat = card.rows.flat()
  const types = flat.map((m) => m.type)
  assert.ok(types.includes('air.quality'))
  assert.ok(types.includes('weather.days'))
  const air = flat.find((m) => m.type === 'air.quality')
  assert.equal(air.style.size, 11)
  assert.equal(air.style.color, '#5d6a86')
})

test('valueOf：离线缓存提示只在 stale 时出现', () => {
  assert.equal(valueOf('weather.hint', { weather: { ok: true, stale: true } }), '离线缓存')
  assert.equal(valueOf('weather.hint', { weather: { ok: true } }), '')
})

test('valueOf：喝水的进度、间隔与下次时间', () => {
  assert.equal(valueOf('water.progress', { cups: 3 }), '●●●○○○○○')
  assert.equal(valueOf('water.progress', { cups: 99 }), '●●●●●●●●')
  assert.equal(valueOf('water.interval', { interval: 60 }), '每 60 分钟')
  assert.equal(valueOf('water.interval', {}), '还没设提醒')
  assert.equal(valueOf('water.cups', {}), '0')
  assert.match(valueOf('water.next', { nextAt: Date.now() + 20 * 60000 }), /^再过 \d+ 分钟$/)
  assert.equal(valueOf('water.next', { nextAt: Date.now() - 60000 }), '该喝啦')
  assert.equal(valueOf('water.next', {}), '')
})

test('valueOf：安静时段与上次喝水', () => {
  assert.equal(valueOf('water.quiet', { quiet: { from: '23', to: '8' } }), '安静 23 点到 8 点')
  assert.equal(valueOf('water.quiet', {}), '不设安静时段')
  assert.equal(valueOf('water.last', {}), '今天还没喝呢')
  assert.match(valueOf('water.last', { lastDrinkAt: Date.now() }), /^上次 \d{2}:\d{2}$/)
})

test('styleToString：默认样式返回空串，逐项生成声明', () => {
  assert.equal(styleToString(), '')
  assert.equal(styleToString({ size: 15 }), 'font-size:15px')
  assert.equal(styleToString({ bold: true, italic: true }), 'font-weight:600;font-style:italic')
  assert.equal(styleToString({ bg: '#fff' }), 'background:#fff;border-radius:4px;padding:0 3px')
  assert.equal(styleToString({ size: STYLE_DEFAULT.size, color: STYLE_DEFAULT.color }), '')
})