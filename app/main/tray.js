/**
 * Tray icon + the Ctrl+Alt+P escape hatch (P0-3), split out of main.js (P1-1).
 *
 * The tray is known to be invisible on some machines (see M17-NOTES §8), so the
 * app records what actually happened and 设置 → 其他 tells the user which doors
 * are still open: the pet hover menu and the global shortcut. Nothing here may
 * throw — a missing tray must never take the pet down.
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { Tray, Menu, nativeImage, globalShortcut } = require('electron')

const ACCELERATOR = 'CommandOrControl+Alt+P'
const SHORTCUT_LABEL = 'Ctrl+Alt+P'

/**
 * @param {object} deps
 * @param {string} deps.assets      assets directory (tray.png / icon.png)
 * @param {() => object} deps.readSettings
 * @param {Function} deps.log
 * @param {object} deps.actions     togglePet / openSettings / openEditor / refreshWeather / quit
 */
function createTrayHost({ assets, readSettings, log, actions }) {
  let tray = null
  let status = { ok: false, reason: '还没创建' }
  let shortcutStatus = { ok: false, accelerator: SHORTCUT_LABEL, reason: '还没注册' }

  function create() {
    let iconPath = path.join(assets, 'tray.png')
    if (!fs.existsSync(iconPath)) iconPath = path.join(assets, 'icon.png')
    let image = nativeImage.createFromPath(iconPath)
    if (image.isEmpty()) image = nativeImage.createEmpty()
    try {
      tray = new Tray(image)
    } catch (err) {
      tray = null
      status = { ok: false, reason: '托盘没能创建出来：' + ((err && err.message) || String(err)) }
      log('tray create failed', (err && err.stack) || String(err))
      return
    }
    const s = readSettings()
    tray.setToolTip(s.name + ' · 桌宠')
    const menu = Menu.buildFromTemplate([
      { label: '显示 / 隐藏', click: actions.togglePet },
      { label: '设置…', click: actions.openSettings },
      { label: '布置气泡…', click: actions.openEditor },
      { label: '看看天气', click: () => actions.refreshWeather('tray') },
      { type: 'separator' },
      { label: '先退出啦', click: actions.quit },
    ])
    tray.setContextMenu(menu)
    tray.on('click', actions.togglePet)
    status = image.isEmpty()
      ? { ok: false, reason: '托盘图标是空的，系统那边可能看不到它' }
      : { ok: true, reason: '' }
    log('tray created empty=' + image.isEmpty() + ' icon=' + iconPath + ' menu=' + menu.items.map((i) => i.label || i.type).join('|'))
    try { log('tray bounds=' + JSON.stringify(tray.getBounds())) } catch (err) { log('tray bounds unavailable', String(err)) }
  }

  /**
   * P0-3: Ctrl+Alt+P as the guaranteed way back to the pet when the tray icon is
   * invisible. Registration can fail when another app owns the chord, so the
   * outcome is remembered and surfaced in 设置 → 其他.
   */
  function registerShortcut() {
    try {
      const ok = globalShortcut.register(ACCELERATOR, actions.togglePet)
      shortcutStatus = ok
        ? { ok: true, accelerator: SHORTCUT_LABEL, reason: '' }
        : { ok: false, accelerator: SHORTCUT_LABEL, reason: '这个组合被别的程序占用了' }
    } catch (err) {
      shortcutStatus = { ok: false, accelerator: SHORTCUT_LABEL, reason: (err && err.message) || String(err) }
    }
    log('shortcut ' + ACCELERATOR + ' ok=' + shortcutStatus.ok + (shortcutStatus.reason ? ' reason=' + shortcutStatus.reason : ''))
  }

  /** Shortcut state with the OS re-read, shared by 设置页 and 诊断导出. */
  function shortcutReport() {
    let registered = false
    try { registered = globalShortcut.isRegistered(ACCELERATOR) } catch (err) { registered = false }
    return Object.assign({}, shortcutStatus, { registered })
  }

  function setTooltip(name) { if (tray) tray.setToolTip(name + ' · 桌宠') }

  return {
    create,
    registerShortcut,
    shortcutReport,
    setTooltip,
    ready: () => !!tray,
    status: () => status,
  }
}

module.exports = { createTrayHost, ACCELERATOR, SHORTCUT_LABEL }