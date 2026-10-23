'use strict'
/**
 * P1-5：喝水的四个通道（记一杯 / 稍后 10 分钟 / 记录统计 / 导出 CSV）。
 *
 * 单独成文件的原因和 `weather-pump.js` 一样：`ipc.js` 已经接近 400 行，
 * 而这一块只依赖 store + 纯函数，抽出来后可以单独读、单独改。
 */

const waterLog = require('../../lib/water-log.js')
const { WATER_LOG_MAX } = require('../../lib/store.js')

/**
 * @param {object} deps
 * @param {object} deps.ipcMain
 * @param {object} deps.store
 * @param {object} deps.path
 * @param {object} deps.fs
 * @param {object} deps.shell
 * @param {Function} deps.clamp
 * @param {Function} [deps.log]
 * @param {Function} [deps.now]
 */
function registerWaterIpc(deps) {
  const { ipcMain, store, path, fs, shell, clamp, t, now = Date.now } = deps
  const log = deps.log || (() => {})

  ipcMain.on('pet:water-done', () => {
    const s = store.readSettings()
    const at = now()
    const key = waterLog.dayKey(at)
    const w = s.water || {}
    const cupMl = Number(w.cupMl) || 200
    const list = (Array.isArray(w.log) ? w.log : []).concat([{ at, ml: cupMl }])
    const cups = w.today && w.today.date === key ? Number(w.today.cups) + 1 : 1
    store.writeSettings({
      water: { lastDrinkAt: at, snoozeUntil: 0, log: list.slice(-WATER_LOG_MAX), today: { date: key, cups } },
    })
  })

  // 「稍后 10 分钟」is an explicit "not now": stored separately from
  // lastDrinkAt so the reminder can honour it without counting a cup.
  ipcMain.on('pet:water-snooze', (ev, minutes) => {
    const mins = clamp(Number(minutes) || 10, 1, 120)
    store.writeSettings({ water: { snoozeUntil: now() + mins * 60000 } })
    log('water snoozed ' + mins + 'min')
  })

  ipcMain.handle('water:stats', () => {
    const w = store.readSettings().water || {}
    return waterLog.summarize(w.log, now(), {
      date: w.today && w.today.date,
      cups: w.today && w.today.cups,
      cupMl: w.cupMl,
    }, t)
  })

  // Writes `water-<stamp>.csv` next to settings.json and reveals it: no native
  // dialog, so it can be exercised from a script and never blocks the app.
  ipcMain.handle('water:export', () => {
    const w = store.readSettings().water || {}
    const stamp = new Date(now()).toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-')
    const file = path.join(store.dir, 'water-' + stamp + '.csv')
    try {
      fs.writeFileSync(file, waterLog.toCsv(w.log, w.cupMl), 'utf8')
    } catch (err) {
      return { ok: false, error: String(err.message || err) }
    }
    try { shell.showItemInFolder(file) } catch (err) {}
    const rows = Array.isArray(w.log) ? w.log.length : 0
    log('water csv exported ' + file + ' rows=' + rows)
    return { ok: true, path: file, rows }
  })
}

module.exports = { registerWaterIpc }