'use strict'
/**
 * P1-5：喝水记录聚合（纯函数，不依赖 Electron / fs，可以直接单测）。
 *
 * 记录只存时间戳 + 毫升数；这里负责「今天几点喝了几杯」「本周每天几杯」和
 * CSV 文本。日期一律按**本地时区**切分，和设置页/桌面一致。
 */

// 星期几由调用方翻译（`date.weekday.<0-6>`），这里只保留索引语义
const WEEK_ORDER = [0, 1, 2, 3, 4, 5, 6]

/** The same unpadded `Y-M-D` key that `water.today.date` already uses. */
function dayKey(ts) {
  const d = new Date(ts)
  return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate()
}

function startOfDay(ts) {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function pad2(n) {
  return (n < 10 ? '0' : '') + n
}

function clockOf(ts) {
  const d = new Date(ts)
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes())
}

/** Keep only sane entries, oldest first (the store normalises too; be safe). */
function cleanLog(log) {
  const list = []
  for (const item of Array.isArray(log) ? log : []) {
    const at = Number(item && item.at)
    if (!Number.isFinite(at) || at <= 0) continue
    const ml = Number(item && item.ml)
    list.push({ at: Math.floor(at), ml: Number.isFinite(ml) && ml > 0 ? Math.floor(ml) : 0 })
  }
  list.sort((a, b) => a.at - b.at)
  return list
}

/**
 * @param {Array<{at:number, ml:number}>} log
 * @param {number} nowTs
 * @param {{date?:string, cups?:number, cupMl?:number}} [fallback]
 *   `water.today` from settings: upgrade path for logs written before P1-5.
 */
function summarize(log, nowTs, fallback, t) {
  const now = Number(nowTs) || Date.now()
  const cupMl = Number(fallback && fallback.cupMl) || 200
  const items = cleanLog(log)
  const todayKey = dayKey(now)
  const today = { date: todayKey, cups: 0, ml: 0, items: [] }
  for (const item of items) {
    if (dayKey(item.at) !== todayKey) continue
    const ml = item.ml || cupMl
    today.cups += 1
    today.ml += ml
    today.items.push({ at: item.at, time: clockOf(item.at), ml })
  }
  // Upgrade path: a settings.json from 0.6.x has today.cups but no log at all.
  if (!items.length && fallback && fallback.date === todayKey && Number(fallback.cups) > 0) {
    today.cups = Number(fallback.cups)
    today.ml = today.cups * cupMl
  }

  const week = []
  const base = startOfDay(now)
  for (let i = 6; i >= 0; i--) {
    const ts = new Date(base)
    ts.setDate(ts.getDate() - i)
    const key = dayKey(ts.getTime())
    const dow = ts.getDay()
    week.push({ date: key, dow, label: typeof t === 'function' ? t('date.weekday.' + WEEK_ORDER[dow]) : String(dow), isToday: key === todayKey, cups: 0, ml: 0 })
  }
  const byDate = new Map(week.map((d) => [d.date, d]))
  for (const item of items) {
    const day = byDate.get(dayKey(item.at))
    if (!day) continue
    const ml = item.ml || cupMl
    day.cups += 1
    day.ml += ml
  }
  const todayRow = byDate.get(todayKey)
  if (todayRow) {
    todayRow.cups = today.cups
    todayRow.ml = today.ml
  }
  const totalCups = week.reduce((sum, day) => sum + day.cups, 0)
  const totalMl = week.reduce((sum, day) => sum + day.ml, 0)
  return { today, week, totalCups, totalMl, cupMl }
}

/**
 * CSV, one row per drink: `date,time,ml`. CRLF line ends so Excel on Windows
 * opens it without the "one giant row" problem.
 */
function toCsv(log, cupMl) {
  const ml = Number(cupMl) || 200
  const rows = ['date,time,ml']
  for (const item of cleanLog(log)) {
    rows.push(dayKey(item.at) + ',' + clockOf(item.at) + ',' + (item.ml || ml))
  }
  return rows.join('\r\n') + '\r\n'
}

module.exports = { dayKey, startOfDay, clockOf, cleanLog, summarize, toCsv }