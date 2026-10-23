'use strict'
/**
 * P1-1 阶段 3：天气的取数、缓存回退与定时刷新。
 *
 * Everything that used to live in `refreshWeather` / `sendWeather` /
 * `scheduleWeather` in main.js. No Electron imports: the window list comes in
 * through `getWindows`, so this module can be exercised from plain Node.
 */

/**
 * @param {object} deps
 * @param {object} deps.store         lib/store instance
 * @param {Function} deps.fetchWeather lib/weather.fetchWeather
 * @param {Function} deps.advice      lib/weather.advice
 * @param {Function} deps.getWindows  () => BrowserWindow[]
 * @param {Function} deps.clamp       numeric clamp
 * @param {Function} [deps.log]
 * @param {Function} deps.t           translator (keys live in locales/*.json)
 * @param {Function} [deps.now]       Date.now, injectable for tests
 */
function createWeatherPump(deps) {
  const { store, fetchWeather, advice, getWindows, clamp, log, t = (key) => key, now = Date.now } = deps
  let current = null
  let timer = null

  function send() {
    for (const win of getWindows()) {
      if (!win.isDestroyed()) win.webContents.send('weather:changed', current)
    }
  }

  async function refresh(reason) {
    const s = store.readSettings()
    const w = s.weather || {}
    if (w.lat == null || w.lon == null) {
      current = { ok: false, error: 'NO_LOCATION', message: t('weather.noLocationMessage') }
      send()
      return current
    }
    try {
      current = await fetchWeather({ lat: w.lat, lon: w.lon, city: w.city, label: w.label, t })
      store.writeWeatherCache({ key: w.lat + ',' + w.lon, at: now(), value: current })
    } catch (err) {
      const cache = store.readWeatherCache()
      if (cache && cache.value) {
        current = Object.assign({}, cache.value, { stale: true, error: String(err.message || err) })
        // Older caches predate the advice line / hourly strip: fill what we can.
        if (!current.advice) current.advice = advice(current, t)
        if (!Array.isArray(current.hourly)) current.hourly = []
      } else current = { ok: false, error: 'FETCH_FAILED', message: String(err.message || err) }
      if (log) log('weather refresh failed (' + reason + ')', String(err && err.message || err))
    }
    send()
    return current
  }

  function schedule() {
    if (timer) clearInterval(timer)
    const s = store.readSettings()
    const minutes = clamp(Number(s.weather && s.weather.refreshMinutes) || 15, 5, 180)
    timer = setInterval(() => { refresh('timer') }, minutes * 60000)
    return minutes
  }

  function stop() {
    if (timer) clearInterval(timer)
    timer = null
  }

  return {
    refresh,
    send,
    schedule,
    stop,
    current: () => current,
    /** Test seam: let a caller pin a value without hitting the network. */
    set: (value) => { current = value },
    intervalMs: () => (timer ? Number(timer._idleTimeout) || 0 : 0),
  }
}

module.exports = { createWeatherPump }