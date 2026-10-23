'use strict'
/**
 * P1-1 阶段 3：喝水提醒的到期判定与投放。
 *
 * The rule set is unchanged from main.js: quiet mode wins, quiet hours win,
 * `intervalMinutes` (5..600) sets the gap since the last drink, and a 10 minute
 * floor stops two windows from firing back to back after a settings change.
 * Delivery prefers the pet bubble and falls back to a system Notification when
 * the pet is hidden.
 */

const REMIND_FLOOR_MS = 10 * 60000

/**
 * @param {object} deps
 * @param {object} deps.store
 * @param {Function} deps.clamp
 * @param {Function} deps.isPetVisible () => boolean
 * @param {Function} deps.sendToPet    (channel) => void
 * @param {Function} deps.notify       ({title, body}) => void  (Notification)
 * @param {Function} [deps.now]
 * @param {Function} [deps.tickMs]
 */
function createReminders(deps) {
  const { store, clamp, isPetVisible, sendToPet, notify, now = Date.now, tickMs = 60000 } = deps
  let timer = null
  let lastRemindAt = 0

  function inQuietHours(w) {
    const from = clamp(Number(w.quietFrom), 0, 23) * 60
    const to = clamp(Number(w.quietTo), 0, 23) * 60
    if (from === to) return false
    const d = new Date(now())
    const mins = d.getHours() * 60 + d.getMinutes()
    return from < to ? (mins >= from && mins < to) : (mins >= from || mins < to)
  }

  /** One tick; returns what happened so tests and diagnostics can assert on it. */
  function tick() {
    const s = store.readSettings()
    if (s.mode === 'quiet') return 'quiet-mode'
    if (inQuietHours(s.water || {})) return 'quiet-hours'
    // P1-5: 「稍后 10 分钟」wins over the normal interval — it is an explicit
    // "not now" from the user, so it must not be silenced by not-due first.
    if (Number(s.water.snoozeUntil) > now()) return 'snoozed'
    const interval = clamp(Number(s.water.intervalMinutes) || 60, 5, 600) * 60000
    const last = Number(s.water.lastDrinkAt) || 0
    if (now() - last < interval) return 'not-due'
    if (now() - lastRemindAt < REMIND_FLOOR_MS) return 'throttled'
    lastRemindAt = now()
    if (isPetVisible()) sendToPet('remind:water')
    else notify({ title: s.name || '桌宠', body: '该喝水啦，慢慢喝～' })
    return 'reminded'
  }

  function start() {
    if (timer) clearInterval(timer)
    timer = setInterval(tick, tickMs)
    return timer
  }

  function stop() {
    if (timer) clearInterval(timer)
    timer = null
  }

  return { start, stop, tick, inQuietHours, lastRemindAt: () => lastRemindAt }
}

module.exports = { createReminders, REMIND_FLOOR_MS }