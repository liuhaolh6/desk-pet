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

const REDACTED = '[已脱敏]'

function createDiagnostics({ version, getStore, logger, getWeather, getTrayStatus, getShortcutReport, log }) {
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
      : '（还没取过天气）'
    return [
      '# 桌宠诊断信息',
      '生成时间：' + new Date().toISOString(),
      '',
      '## 应用',
      '版本：' + version,
      'Electron：' + process.versions.electron + ' / Chromium ' + process.versions.chrome + ' / Node ' + process.versions.node,
      '系统：' + process.platform + ' ' + process.arch + ' ' + os.release(),
      '数据目录：' + store.dir,
      '日志文件：' + (logger.filePath() || '（还没定下来）'),
      '',
      '## 托盘与快捷键',
      JSON.stringify({ tray: getTrayStatus(), shortcut: getShortcutReport() }, null, 2),
      '',
      '## 屏幕',
      JSON.stringify(displays, null, 2),
      '',
      '## 天气缓存（不含坐标）',
      weatherLine,
      '',
      '## 设置（坐标与自定义短语已脱敏）',
      JSON.stringify(sanitizedSettings(), null, 2),
      '',
      '## app.log 末尾 200 行',
      logger.tail(logger.filePath(), 200, 256 * 1024),
      '',
      '## cutout-trace.jsonl 末尾 60 行',
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