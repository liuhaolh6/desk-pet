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
 * @param {Function} [deps.t]       i18n translator (P2-6); defaults to identity
 */
function createTrayHost({ assets, readSettings, log, actions, t = (key) => key }) {
  let tray = null
  let status = { ok: false, reason: t('tray.status.pending') }
  let shortcutStatus = { ok: false, accelerator: SHORTCUT_LABEL, reason: t('tray.shortcut.pending') }

  function create() {
    let iconPath = path.join(assets, 'tray.png')
    if (!fs.existsSync(iconPath)) iconPath = path.join(assets, 'icon.png')
    let image = nativeImage.createFromPath(iconPath)
    if (image.isEmpty()) image = nativeImage.createEmpty()
    try {
      tray = new Tray(image)
    } catch (err) {
      tray = null
      status = { ok: false, reason: t('tray.status.failed', { message: (err && err.message) || String(err) }) }
      log('tray create failed', (err && err.stack) || String(err))
      return
    }
    const s = readSettings()
    tray.setToolTip(t('app.tooltip', { name: s.name }))
    const menu = Menu.buildFromTemplate([
      { label: t('tray.toggle'), click: actions.togglePet },
      { label: t('tray.settings'), click: actions.openSettings },
      { label: t('tray.bubble'), click: actions.openEditor },
      { label: t('tray.weather'), click: () => actions.refreshWeather('tray') },
      { type: 'separator' },
      { label: t('tray.quit'), click: actions.quit },
    ])
    tray.setContextMenu(menu)
    tray.on('click', actions.togglePet)
    status = image.isEmpty()
      ? { ok: false, reason: t('tray.status.emptyIcon') }
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
        : { ok: false, accelerator: SHORTCUT_LABEL, reason: t('tray.shortcut.taken') }
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

  function setTooltip(name) { if (tray) tray.setToolTip(t('app.tooltip', { name })) }

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