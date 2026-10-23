'use strict'
/**
 * P1-1 阶段 4：窗口工厂。
 *
 * 桌宠窗、设置、编辑器、抠图、首次引导五个窗口的创建与生命周期都在这里；
 * `main.js` 只保留 `createWindows(deps)` 一次装配，然后通过 `windows.pet()` 这类
 * 取窗口。看着像多一层，但它解决两件事：
 *
 * 1. `let petWin = null` 那六个变量不再散在主文件里，窗口关闭后自动置空；
 * 2. `layout` 与窗口互相需要（layout 要发镜像、窗口要用 layout 算位置），
 *    用 `onMirror: () => windows.sendMirror()` 这种晚绑定闭包断开循环。
 */

const path = require('node:path')
const { clamp, WIN_PAD, windowWidth } = require('./geometry')

/**
 * @param {object} deps
 * @param {object} deps.BrowserWindow
 * @param {object} deps.screen
 * @param {object} deps.app
 * @param {object} deps.store
 * @param {object} deps.layout
 * @param {object} deps.winState
 * @param {string} deps.assets
 * @param {string} deps.portableExe
 * @param {function} deps.log
 * @param {function} deps.getWeather
 * @param {function} deps.onCutoutClosed 抠图窗关闭时清理输入令牌
 * @param {object} deps.i18n     主进程 i18n（窗口标题走 `t()`，P2-6 阶段二）
 */
function createWindows(deps) {
  const {
    BrowserWindow, screen, app, store, layout, winState,
    assets, portableExe, log, getWeather, onCutoutClosed, i18n,
  } = deps
  // 缺翻译器时退键名（永不退中文），开发期一眼看出漏翻
  const title = (key) => (i18n && typeof i18n.t === 'function' ? i18n.t(key) : key)

  let petWin = null
  let settingsWin = null
  let editorWin = null
  let cutoutWin = null
  let onboardWin = null

  function sendMirror() {
    if (!petWin || petWin.isDestroyed()) return
    try { petWin.webContents.send('pet:mirror', layout.mirrorSide()) } catch (err) {}
  }

  /** Show/hide the pet. Shared by the tray entry, its left click and the shortcut. */
  function togglePet() {
    if (!petWin) return createPetWindow()
    if (petWin.isVisible()) petWin.hide()
    else { petWin.show(); petWin.focus() }
  }

  function createPetWindow() {
    const s = store.readSettings()
    const size = clamp(Number(s.size) || 220, 80, 480)
    const pos = layout.resolveWindowPosition(size)
    // P2-4 stage 2: no bubble strip any more - the window is exactly pet + pad.
    const nearest = screen.getDisplayNearestPoint({ x: pos.x + WIN_PAD + Math.floor(size / 2), y: pos.y })
    const work = nearest.workArea
    const winY = Math.max(work.y, Math.min(pos.y, work.y + work.height - size))
    // The saved/window x already excludes the window padding.
    layout.begin({ x: pos.x + WIN_PAD, y: winY, reserve: 0 })

    const opaque = process.env.DESKPET_OPAQUE === '1'
    petWin = new BrowserWindow({
      x: pos.x,
      y: winY,
      width: windowWidth(size),
      height: size,
      frame: false,
      transparent: !opaque,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: !!s.alwaysOnTop,
      backgroundColor: opaque ? '#203170' : '#00000000',
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    })

    petWin.setAlwaysOnTop(!!s.alwaysOnTop, 'screen-saver')
    // 0.6.1: the window keeps a fixed bubble strip reserved, so most of its area
    // is transparent. Click-through by default (forwarded so the renderer still
    // sees moves); the renderer flips it back on while over the pet/bubble/menu.
    try { petWin.setIgnoreMouseEvents(true, { forward: true }) } catch (err) {}
    layout.start()
    petWin.loadFile(path.join(__dirname, '..', 'pet.html'))
    petWin.on('closed', () => { petWin = null })
    petWin.webContents.on('console-message', (event, level, message, line, source) => {
      log('pet-console', level, message, source + ':' + line)
    })
    petWin.webContents.on('did-fail-load', (event, code, desc, url) => {
      log('pet-load-failed', code, desc, url)
    })
    petWin.once('show', () => {
      log('pet-show bounds=' + JSON.stringify(petWin.getBounds()) + ' visible=' + petWin.isVisible())
    })

    petWin.webContents.on('did-finish-load', () => {
      log('pet-loaded bounds=' + JSON.stringify(petWin.getBounds()))
      try { petWin.show() } catch (err) {}
      try { petWin.moveTop() } catch (err) {}
      log('pet-visible=' + petWin.isVisible() + ' onTop=' + petWin.isAlwaysOnTop())
      petWin.webContents.send('settings:changed', store.readSettings())
      const weather = getWeather ? getWeather() : null
      if (weather) petWin.webContents.send('weather:changed', weather)
      sendMirror()
    })
  }

  function applySettingsSideEffects(prev, next) {
    if (!petWin) return
    const size = clamp(Number(next.size) || 220, 80, 480)
    const g = petWin.getBounds()
    if (windowWidth(size) !== g.width) {
      // P2-4 stage 2: the window is pet-sized, so only the width changes.
      const prevSize = clamp(Number(prev && prev.size) || size, 80, 480)
      const pos = layout.petPos
      if (pos && prevSize !== size) pos.y = pos.y + prevSize - size
      const y = pos ? pos.y : g.y + g.height - size
      petWin.setBounds({ x: g.x, y, width: windowWidth(size), height: size })
      sendMirror()
    }
    if (!prev || prev.alwaysOnTop !== next.alwaysOnTop) {
      petWin.setAlwaysOnTop(!!next.alwaysOnTop, 'screen-saver')
    }
    if (prev && prev.autostart !== next.autostart) {
      try {
        // Keep the sandbox flag in the login item, otherwise autostart hits the
        // same startup crash as a plain double-click on this machine.
        const args = process.argv.includes('--no-sandbox') ? ['--no-sandbox'] : []
        app.setLoginItemSettings({ openAtLogin: !!next.autostart, path: portableExe || process.execPath, args })
      } catch (err) {}
    }
  }

  // ------------------------------------------------------------ settings view
  function openSettings() {
    if (settingsWin) { settingsWin.show(); settingsWin.focus(); return }
    settingsWin = new BrowserWindow({
      width: 520,
      height: 660,
      minWidth: 460,
      minHeight: 560,
      title: title('window.settings'),
      backgroundColor: '#f7f9fd',
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
    settingsWin.loadFile(path.join(__dirname, '..', 'settings.html'))
    settingsWin.on('closed', () => { settingsWin = null })
  }

  function openEditor() {
    if (editorWin) { editorWin.show(); editorWin.focus(); return }
    editorWin = new BrowserWindow({
      width: 960,
      height: 700,
      minWidth: 780,
      minHeight: 540,
      title: title('window.editor'),
      backgroundColor: '#f7f9fd',
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
    editorWin.loadFile(path.join(__dirname, '..', 'editor.html'))
    editorWin.on('closed', () => { editorWin = null })
  }

  function openCutout() {
    if (cutoutWin) { cutoutWin.show(); cutoutWin.focus(); return }
    cutoutWin = new BrowserWindow({
      width: 780,
      height: 760,
      minWidth: 680,
      minHeight: 600,
      title: title('window.cutout'),
      backgroundColor: '#f7f9fd',
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
    cutoutWin.loadFile(path.join(__dirname, '..', 'cutout.html'))
    winState.transition('cutout-open')
    cutoutWin.on('closed', () => {
      cutoutWin = null
      if (onCutoutClosed) onCutoutClosed()
      winState.transition('cutout-close')
    })
  }

  /**
   * First-run welcome card (M17 P0-1).
   *
   * Shown once, from the tray/menu or on boot while `onboarded` is still false.
   * It is a real, focusable window (not a bubble) so keyboard and screen-reader
   * users can actually read the three steps. `force` is what the settings panel
   * and the CDP a11y audit use to open it again after it has been dismissed.
   */
  function openOnboard(force) {
    if (onboardWin && !onboardWin.isDestroyed()) { onboardWin.show(); onboardWin.focus(); return }
    const s = store.readSettings()
    if (!force && s.onboarded === true) return

    const size = clamp(Number(s.size) || 220, 80, 480)
    const pet = layout.petScreenRect(size)
    const display = screen.getDisplayNearestPoint({
      x: pet.x + Math.floor(size / 2),
      y: pet.top + Math.floor(size / 2),
    })
    const work = display.workArea
    const width = 480
    // Keep the whole card on screen even on small laptops, but tall enough that
    // the three steps fit without a scrollbar at the default text size.
    const height = Math.max(400, Math.min(580, work.height - 48))
    const x = Math.round(work.x + Math.max(0, (work.width - width) / 2))
    const y = Math.round(work.y + Math.max(8, (work.height - height) / 2))

    onboardWin = new BrowserWindow({
      x,
      y,
      width,
      height,
      useContentSize: true,
      title: title('window.onboard'),
      backgroundColor: '#fbf6f8',
      autoHideMenuBar: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
    onboardWin.once('ready-to-show', () => {
      try { onboardWin.show(); onboardWin.focus() } catch (err) {}
    })
    onboardWin.loadFile(path.join(__dirname, '..', 'onboard.html'))
    onboardWin.webContents.on('console-message', (event, level, message, line, source) => {
      log('onboard-console', level, message, source + ':' + line)
    })
    onboardWin.on('closed', () => { onboardWin = null })
  }

  /** 知道啦 / Esc / 去设置 都走这里：记下已经看过，然后关窗。 */
  function dismissOnboard() {
    try { store.writeSettings({ onboarded: true }) } catch (err) { log('onboard flag failed', String(err)) }
    if (onboardWin && !onboardWin.isDestroyed()) onboardWin.close()
  }

  return {
    pet: () => petWin,
    settings: () => settingsWin,
    editor: () => editorWin,
    cutout: () => cutoutWin,
    onboard: () => onboardWin,
    createPet: createPetWindow,
    applySettingsEffects: applySettingsSideEffects,
    togglePet,
    sendMirror,
    openSettings,
    openEditor,
    openCutout,
    openOnboard,
    dismissOnboard,
  }
}

module.exports = { createWindows }