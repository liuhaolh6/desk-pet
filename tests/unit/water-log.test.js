'use strict'
/**
 * P1-5：喝水记录聚合的单测。时间一律用本地时区构造，避免 CI 机器时区不同。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const wl = require('../../lib/water-log.js')

/** Local noon of a given Y/M/D, so DST/timezone never shifts the day key. */
function noon(y, m, d, h = 12, min = 0) {
  return new Date(y, m - 1, d, h, min, 0, 0).getTime()
}

test('dayKey：本地日期，不补零', () => {
  assert.equal(wl.dayKey(noon(2026, 3, 9)), '2026-3-9')
  assert.equal(wl.dayKey(noon(2026, 12, 31, 23, 59)), '2026-12-31')
})

test('clockOf：HH:mm 两位补零', () => {
  assert.equal(wl.clockOf(noon(2026, 3, 9, 7, 5)), '07:05')
  assert.equal(wl.clockOf(noon(2026, 3, 9, 23, 59)), '23:59')
})

test('startOfDay：取本地零点', () => {
  const t = wl.startOfDay(noon(2026, 3, 9, 18, 30))
  const d = new Date(t)
  assert.equal(d.getHours(), 0)
  assert.equal(d.getMinutes(), 0)
  assert.equal(wl.dayKey(t), '2026-3-9')
})

test('cleanLog：丢掉坏数据并按时间排序', () => {
  const out = wl.cleanLog([
    { at: 200, ml: 100 },
    { at: 'x', ml: 5 },
    { at: 100 },
    null,
    { at: 150, ml: -3 },
  ])
  assert.deepEqual(out, [
    { at: 100, ml: 0 },
    { at: 150, ml: 0 },
    { at: 200, ml: 100 },
  ])
})

test('cleanLog：空输入不炸', () => {
  assert.deepEqual(wl.cleanLog(null), [])
  assert.deepEqual(wl.cleanLog(undefined), [])
  assert.deepEqual(wl.cleanLog('nope'), [])
})

test('summarize：今天的时间轴与总量', () => {
  const now = noon(2026, 3, 9, 15, 0)
  const log = [
    { at: noon(2026, 3, 9, 8, 30), ml: 200 },
    { at: noon(2026, 3, 9, 10, 15), ml: 150 },
    { at: noon(2026, 3, 9, 14, 0), ml: 250 },
  ]
  const out = wl.summarize(log, now)
  assert.equal(out.today.cups, 3)
  assert.equal(out.today.ml, 600)
  assert.deepEqual(out.today.items.map((i) => i.time), ['08:30', '10:15', '14:00'])
  assert.equal(out.today.date, '2026-3-9')
})

test('summarize：本周七天，最老在前，今天在最后', () => {
  const now = noon(2026, 3, 9, 15, 0)
  const out = wl.summarize([], now)
  assert.equal(out.week.length, 7)
  assert.equal(out.week[6].date, '2026-3-9')
  assert.equal(out.week[6].isToday, true)
  assert.equal(out.week[0].date, '2026-3-3')
  assert.ok(out.week.every((d) => d.cups === 0))
})

test('summarize：只统计最近七天，更早的记录忽略', () => {
  const now = noon(2026, 3, 9, 15, 0)
  const log = [
    { at: noon(2026, 3, 9, 9, 0), ml: 200 },   // 今天
    { at: noon(2026, 3, 8, 9, 0), ml: 200 },   // 昨天
    { at: noon(2026, 3, 2, 9, 0), ml: 200 },   // 8 天前，不算
  ]
  const out = wl.summarize(log, now)
  assert.equal(out.week[6].cups, 1)
  assert.equal(out.week[5].cups, 1)
  assert.equal(out.totalCups, 2)
  assert.equal(out.totalMl, 400)
})

test('summarize：ml 缺失时按 cupMl 计', () => {
  const now = noon(2026, 3, 9, 15, 0)
  const out = wl.summarize([{ at: noon(2026, 3, 9, 9, 0) }], now, { cupMl: 250 })
  assert.equal(out.today.ml, 250)
  assert.equal(out.cupMl, 250)
})

test('summarize：老 settings 的 today.cups 升级路径（无 log）', () => {
  const now = noon(2026, 3, 9, 15, 0)
  const out = wl.summarize([], now, { date: '2026-3-9', cups: 4, cupMl: 200 })
  assert.equal(out.today.cups, 4)
  assert.equal(out.today.ml, 800)
  assert.equal(out.today.items.length, 0)
  assert.equal(out.week[6].cups, 4)
  assert.equal(out.totalCups, 4)
})

test('summarize：老 today 不是今天就不算', () => {
  const now = noon(2026, 3, 9, 15, 0)
  const out = wl.summarize([], now, { date: '2026-3-8', cups: 4, cupMl: 200 })
  assert.equal(out.today.cups, 0)
  assert.equal(out.week[6].cups, 0)
})

test('summarize：有 log 时不用老 today 的计数（避免重复）', () => {
  const now = noon(2026, 3, 9, 15, 0)
  const log = [{ at: noon(2026, 3, 9, 9, 0), ml: 200 }]
  const out = wl.summarize(log, now, { date: '2026-3-9', cups: 4, cupMl: 200 })
  assert.equal(out.today.cups, 1)
})

test('toCsv：表头 + 每杯一行 + CRLF', () => {
  const csv = wl.toCsv([
    { at: noon(2026, 3, 9, 8, 30), ml: 200 },
    { at: noon(2026, 3, 9, 10, 5), ml: 150 },
  ], 200)
  const lines = csv.split('\r\n')
  assert.equal(lines[0], 'date,time,ml')
  assert.equal(lines[1], '2026-3-9,08:30,200')
  assert.equal(lines[2], '2026-3-9,10:05,150')
  assert.equal(lines[3], '')
  assert.ok(csv.endsWith('\r\n'))
})

test('toCsv：没有记录时只有表头', () => {
  assert.equal(wl.toCsv([], 200), 'date,time,ml\r\n')
})

test('toCsv：ml 缺失时回落到 cupMl', () => {
  const csv = wl.toCsv([{ at: noon(2026, 3, 9, 9, 0) }], 300)
  assert.equal(csv.split('\r\n')[1], '2026-3-9,09:00,300')
})

test('summarize: 今日时间轴跟随语言习惯（12h 带 AM/PM，CSV 仍 24h）', () => {
  const at = new Date(2026, 9, 23, 15, 4).getTime()
  const log = [{ at, ml: 200 }]
  const zh = (k) => ({ 'meta.timeStyle': '24h' }[k] || k)
  const en = (k) => ({ 'meta.timeStyle': '12h', 'date.am': 'AM', 'date.pm': 'PM' }[k] || k)
  assert.equal(wl.summarize(log, at, {}, zh).today.items[0].time, '15:04')
  assert.equal(wl.summarize(log, at, {}, en).today.items[0].time, '3:04 PM')
  assert.match(wl.toCsv(log), /,15:04,/, '导出保持 24 小时制，不受界面语言影响')
})
