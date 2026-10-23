/**
 * `lib/nudges.js` —— 主动说话的三个触发器（纯决策，不碰 Electron）。
 */
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const TEXTS = { 'late-night': 'late', 'long-use': 'long', away: 'away' }

const { decide, norm, isNightHour, DEFAULTS } = require('../../lib/nudges.js')

const MIN = 60000
// 2026-10-23 14:00 本地时间
const BASE = new Date(2026, 9, 23, 14, 0, 0).getTime()
const at3 = (h) => new Date(2026, 9, 23, h, 0, 0).getTime()

test('norm：缺省值齐全，失败的数值回退默认', () => {
  const cfg = norm()
  assert.equal(cfg.enabled, true)
  assert.equal(cfg.longUseMinutes, 50)
  assert.equal(cfg.awayMinutes, 120)
  assert.equal(cfg.gapMinutes, 45)
  assert.equal(norm({ longUseMinutes: 0 }).longUseMinutes, 50)
  assert.equal(norm({ longUseMinutes: 'abc' }).longUseMinutes, 50)
  assert.equal(norm({ enabled: false }).enabled, false)
})

test('isNightHour：支持跨零点区间，首尾相接不算夜晚', () => {
  assert.equal(isNightHour(23, 23, 5), true)
  assert.equal(isNightHour(2, 23, 5), true)
  assert.equal(isNightHour(5, 23, 5), false)
  assert.equal(isNightHour(12, 23, 5), false)
  assert.equal(isNightHour(12, 9, 9), false)
  assert.equal(isNightHour(10, 9, 18), true)
})

test('关闭总开关后什么都不说', () => {
  const out = decide({ texts: TEXTS, now: BASE, cfg: { enabled: false }, sessionStart: BASE - 3 * 60 * MIN, lastInteraction: BASE - 1000 })
  assert.equal(out, null)
})

test('安静模式（quiet mode）下不说', () => {
  const out = decide({ texts: TEXTS, now: BASE, quiet: true, sessionStart: BASE - 2 * 60 * MIN, lastInteraction: BASE - 1000 })
  assert.equal(out, null)
})

test('久坐：满 50 分钟开口，未满不开口', () => {
  const early = decide({ texts: TEXTS, now: BASE, sessionStart: BASE - 49 * MIN, lastInteraction: BASE - 1000 })
  assert.equal(early, null)
  const due = decide({ texts: TEXTS, now: BASE, sessionStart: BASE - 50 * MIN, lastInteraction: BASE - 1000 })
  assert.equal(due.kind, 'long-use')
  assert.equal(due.text, 'long')
})

test('久坐：关掉 longUse 后不再触发', () => {
  const out = decide({ texts: TEXTS, now: BASE, cfg: { longUse: false }, sessionStart: BASE - 90 * MIN, lastInteraction: BASE - 1000 })
  assert.notEqual(out && out.kind, 'long-use')
})

test('久坐：长时间完全没互动时让位给「好久不见」', () => {
  const out = decide({ texts: TEXTS, now: BASE, sessionStart: BASE - 90 * MIN, lastInteraction: BASE - 130 * MIN })
  assert.equal(out.kind, 'away')
})

test('久未互动：满 2 小时说「好久没见」，未满不说', () => {
  assert.equal(decide({ texts: TEXTS, now: BASE, lastInteraction: BASE - 119 * MIN }), null)
  const out = decide({ texts: TEXTS, now: BASE, lastInteraction: BASE - 120 * MIN })
  assert.equal(out.kind, 'away')
})

test('深夜：23 点且刚有互动才提醒，白天不提醒', () => {
  const late = at3(23) + 5 * MIN
  const out = decide({ texts: TEXTS, now: late, sessionStart: late - 10 * MIN, lastInteraction: late - MIN })
  assert.equal(out.kind, 'late-night')
  assert.equal(decide({ texts: TEXTS, now: BASE, sessionStart: BASE - 10 * MIN, lastInteraction: BASE - MIN }, null), null)
})

test('深夜：人已经离开 40 分钟就不再对着空房间说话', () => {
  const late = at3(23) + 30 * MIN
  const out = decide({ texts: TEXTS, now: late, cfg: { away: false, longUse: false }, sessionStart: late - 90 * MIN, lastInteraction: late - 40 * MIN })
  assert.equal(out, null)
})

test('深夜优先于久坐', () => {
  const late = at3(23) + 10 * MIN
  const out = decide({ texts: TEXTS, now: late, sessionStart: late - 120 * MIN, lastInteraction: late - MIN })
  assert.equal(out.kind, 'late-night')
})

test('两次主动说话之间至少隔 gapMinutes', () => {
  const lastNudgeAt = BASE - 10 * MIN
  const out = decide({ texts: TEXTS, now: BASE, sessionStart: BASE - 60 * MIN, lastInteraction: BASE - MIN, lastNudgeAt })
  assert.equal(out, null)
  const later = decide({ texts: TEXTS, now: BASE + 40 * MIN, sessionStart: BASE - 60 * MIN, lastInteraction: BASE + 39 * MIN, lastNudgeAt })
  assert.ok(later)
})

test('刚启动、还没建立会话时不说话', () => {
  assert.equal(decide({ texts: TEXTS, now: BASE }), null)
})

test('返回结构带 at，方便上层记时间', () => {
  const out = decide({ texts: TEXTS, now: BASE, sessionStart: BASE - 60 * MIN, lastInteraction: BASE - MIN })
  assert.equal(out.at, BASE)
  assert.equal(typeof out.text, 'string')
  assert.ok(out.text.length > 0)
})

test('默认配置是「全开」的', () => {
  assert.equal(DEFAULTS.enabled && DEFAULTS.longUse && DEFAULTS.lateNight && DEFAULTS.away, true)
})