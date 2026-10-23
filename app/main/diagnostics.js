/**
 * One-click diagnostics export (P0-5), split out of main.js (P1-1).
 *
 * The txt a user attaches to a bug report must never carry their photo, their
 * custom phrases or the city coordinates: settings go through
 * sanitizedSettings(), the layout is replaced by a card count, and only tails of
 * the two logs are included.
 */
'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { screen, shell } = require('electron')

const REDACTED = '[redacted]'

function createDiagnostics({ version, getStore, logger, getWeather, getTrayStatus, getShortcutReport, log, t }) {
  const tr = (key) => (typeof t === 'function' ? t('diag.' + key) : key)
  function sanitizedSettings() {
    const s = JSON.parse(JSON.stringify(getStore().readSettings()))
    if (s.weather) {
      if (s.weather.lat != null) s.weather.lat = REDACTED
      if (s.weather.lon != null) s.weather.lon = REDACTED
      if (s.weather.city) s.weather.city = REDACTED
      if (s.weather.label) s.weather.label = REDACTED
    }
    if (s.bubble && typeof s.bubble === 'object') {
      delete s.bubble.phrases
      const layout = s.bubble.layout
      delete s.bubble.layout
      if (layout && Array.isArray(layout.cards)) s.bubble.layoutCards = layout.cards.length
    }
    if (s.roleId && s.roleId !== 'default') s.roleId = 'custom'
    return s
  }

  function build() {
    const store = getStore()
    const weather = getWeather()
    let displays = []
    try {
      const primary = screen.getPrimaryDisplay()
      displays = screen.getAllDisplays().map((d) => ({
        primary: d.id === primary.id,
        scaleFactor: d.scaleFactor,
        workArea: d.workArea,
        bounds: d.bounds,
      }))
    } catch (err) {}
    const weatherLine = weather
      ? JSON.stringify({ ok: weather.ok, temp: weather.temp, code: weather.code, updatedAt: weather.updatedAt })
      : tr('noWeather')
    return [
      tr('title'),
      tr('generatedAt') + tr('sep') + new Date().toISOString(),
      '',
      tr('app'),
      tr('version') + tr('sep') + version,
      tr('electron') + tr('sep') + process.versions.electron + ' / Chromium ' + process.versions.chrome + ' / Node ' + process.versions.node,
      tr('system') + tr('sep') + process.platform + ' ' + process.arch + ' ' + os.release(),
      tr('dataDir') + tr('sep') + store.dir,
      tr('logFile') + tr('sep') + (logger.filePath() || tr('logFilePending')),
      '',
      tr('tray'),
      JSON.stringify({ tray: getTrayStatus(), shortcut: getShortcutReport() }, null, 2),
      '',
      tr('screen'),
      JSON.stringify(displays, null, 2),
      '',
      tr('weather'),
      weatherLine,
      '',
      tr('settings'),
      JSON.stringify(sanitizedSettings(), null, 2),
      '',
      tr('appLog'),
      logger.tail(logger.filePath(), 200, 256 * 1024),
      '',
      tr('cutoutTrace'),
      logger.tail(path.join(store.dir, 'cutout-trace.jsonl'), 60, 128 * 1024),
      '',
    ].join('\n')
  }

  /** Writes `diagnostics-<stamp>.txt` into the data dir and reveals it. */
  function exportFile() {
    const store = getStore()
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-')
    const file = path.join(store.dir, 'diagnostics-' + stamp + '.txt')
    const text = build()
    fs.writeFileSync(file, text, 'utf8')
    try { shell.showItemInFolder(file) } catch (err) {}
    log('diagnostics exported ' + file + ' chars=' + text.length)
    return { ok: true, path: file, bytes: Buffer.byteLength(text) }
  }

  return { build, export: exportFile, sanitizedSettings }
}

module.exports = { createDiagnostics, REDACTED }