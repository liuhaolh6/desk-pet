/**
 * desk-pet —— Electron main process（装配层）。
 *
 * A frameless, transparent, always-on-top window that holds the pet sprite.
 * The window grows upward when a speech bubble is visible so the transparent
 * area never swallows clicks meant for the desktop.
 *
 * P1-1: 具体实现按职责拆在 `app/main/` 下——日志、几何、命中、窗口、IPC、托盘、
 * 天气泵、提醒、抠图、诊断。这个文件只做四件事：读启动参数、选数据目录、
 * 实例化各模块、按顺序把事件接上。目标是 ≤300 行。
 */
'use strict'

const path = require('node:path')
const fs = require('node:fs')
const {
  app, BrowserWindow, ipcMain, screen, dialog,
  nativeImage, Notification, protocol, shell, utilityProcess, globalShortcut,
} = require('electron')

const { createStore } = require('../lib/store')
const { fetchWeather, geocode, advice } = require('../lib/weather')
const placement = require('../lib/placement')
const cutout = require('../lib/cutout')

const VERSION = require('../package.json').version
const ASSETS = path.join(__dirname, '..', 'assets')

const { createLogger } = require('./main/log')
const { clamp, WIN_PAD } = require('./main/geometry')
const { createTrayHost } = require('./main/tray')
const { createDiagnostics } = require('./main/diagnostics')
const { createWindowState } = require('./window-state')
const { createWindowLayout } = require('./main/window-layout')
const { createWeatherPump } = require('./main/weather-pump')
const { createReminders } = require('./main/reminder')
const { createCutoutService } = require('./main/cutout-service')
const { createNudgePump } = require('./main/nudge-pump')
const { isForegroundFullscreen } = require('./main/fullscreen')
const { createWindows } = require('./main/windows')
const { createCatalog } = require('./main/catalog')
const { bootDataDir } = require('./main/boot')
const { registerIpc } = require('./main/ipc')

const logger = createLogger()
const { breadcrumb, log } = logger
breadcrumb('start argv=' + process.argv.slice(1).join(' ') + ' exec=' + process.execPath)
// electron-builder's portable target sets these to the folder/file of the .exe
// the user actually double-clicked (the running process lives in a temp dir).
const PORTABLE_DIR = process.env.PORTABLE_EXECUTABLE_DIR || ''
const PORTABLE_EXE = process.env.PORTABLE_EXECUTABLE_FILE || ''

// The logger (breadcrumb + buffered log file) lives in app/main/log.js: the
// records start before any data directory exists, so the two cannot be split.
process.on('uncaughtException', (err) => log('uncaught', (err && err.stack) || String(err)))
process.on('unhandledRejection', (err) => log('unhandledRejection', (err && err.stack) || String(err)))
log('boot electron=' + process.versions.electron + ' packaged=' + app.isPackaged + ' argv=' + process.argv.join(' '))

let store = null
let windows = null
let catalog = null
let weatherPump = null
let reminders = null
let nudges = null
let cutoutService = null
let quitting = false

// P1-1: the tray + shortcut (P0-3) and the diagnostics export (P0-5) live in
// modules; main.js only wires them to the pet window and the store.
const trayHost = createTrayHost({
  assets: ASSETS,
  readSettings: () => store.readSettings(),
  log,
  actions: {
    togglePet: () => windows && windows.togglePet(),
    openSettings: () => windows && windows.openSettings(),
    openEditor: () => windows && windows.openEditor(),
    refreshWeather: (reason) => weatherPump && weatherPump.refresh(reason),
    quit: () => { quitting = true; app.quit() },
  },
})
const diagnostics = createDiagnostics({
  version: VERSION,
  getStore: () => store,
  logger,
  getWeather: () => (weatherPump ? weatherPump.current() : null),
  getTrayStatus: () => trayHost.status(),
  getShortcutReport: () => trayHost.shortcutReport(),
  log,
})

// P1-2: one explicit machine owns "what is the pet doing". Every IPC that used to
// flip a local boolean now goes through it, so an impossible order (drag during
// cutout, menu while dragging) is counted and logged instead of half-applied.
const winState = createWindowState({
  log,
  onChange: ({ prev, next, event }) => {
    log('window-state', prev + '->' + next, event)
    layout.updateInteractive()
  },
})

// The pet window is the only consumer of role images, but a custom scheme keeps
// file paths out of the renderer entirely.
protocol.registerSchemesAsPrivileged([
  { scheme: 'pet-role', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  { scheme: 'pet-sound', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
])
log('schemes registered')

// P1-1 stage 2: layout, drag maths and click-through hit testing live in a
// module. `petPos` / `bubbleSide` / `reserve` moved with it; `getWindow` is a
// thunk so the module never caches a closed window, and `onMirror` is late-bound
// because the windows module is created later (inside whenReady).
const layout = createWindowLayout({
  screen,
  placement,
  readSettings: () => store.readSettings(),
  log,
  winState,
  getWindow: () => (windows ? windows.pet() : null),
  onMirror: () => windows && windows.sendMirror(),
})

// ---------------------------------------------------------------------- boot
log('before lock')
bootDataDir({
  app, logger, log, breadcrumb, portableDir: PORTABLE_DIR,
  devLogFile: path.join(__dirname, '..', 'app.log'),
})
log('portableDir=' + (PORTABLE_DIR || '-') + ' portableExe=' + (PORTABLE_EXE || '-'))

app.on('second-instance', () => {
  const pet = windows && windows.pet()
  if (pet) { pet.show(); pet.focus() }
})

app.whenReady().then(() => {
  log('ready')
  app.setAppUserModelId('com.deskpet.app')
  store = createStore(app.getPath('userData'))
  catalog = createCatalog({ fs, store, assets: ASSETS, BrowserWindow, trayHost })
  windows = createWindows({
    BrowserWindow, screen, app, store, layout, winState,
    assets: ASSETS, portableExe: PORTABLE_EXE, log,
    getWeather: () => (weatherPump ? weatherPump.current() : null),
    onCutoutClosed: () => { if (cutoutService) cutoutService.clearInputs() },
  })

  protocol.handle('pet-role', catalog.handleRoleProtocol)
  protocol.handle('pet-sound', catalog.handleSoundProtocol)
  const { session } = require('electron')
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    callback(permission === 'geolocation')
  })

  cutoutService = createCutoutService({
    store, nativeImage, cutout, app, utilityProcess,
    path, fs, log, rootDir: __dirname,
  })
  weatherPump = createWeatherPump({
    store, fetchWeather, advice, clamp, log,
    getWindows: () => BrowserWindow.getAllWindows(),
  })
  reminders = createReminders({
    store, clamp,
    isPetVisible: () => { const pet = windows.pet(); return !!(pet && pet.isVisible()) },
    sendToPet: (channel) => { const pet = windows.pet(); if (pet && !pet.isDestroyed()) pet.webContents.send(channel) },
    notify: ({ title, body }) => { try { new Notification({ title, body }).show() } catch (err) {} },
  })
  const fgCache = { at: 0, value: false }
  nudges = createNudgePump({
    store, log,
    sendToPet: (channel, data) => { const pet = windows.pet(); if (pet && !pet.isDestroyed()) pet.webContents.send(channel, data) },
    isBusy: () => isForegroundFullscreen({ cache: fgCache }),
  })
  registerIpc({
    ipcMain, dialog, shell, app, nativeImage, path, fs,
    store, version: VERSION, weatherPump, layout, winState, trayHost, diagnostics,
    cutoutService, cutout, placement, clamp, winPad: WIN_PAD, log, nudges,
    windows: {
      pet: () => windows.pet(),
      settings: () => windows.settings(),
      editor: () => windows.editor(),
      cutout: () => windows.cutout(),
    },
    actions: {
      openSettings: () => windows.openSettings(),
      openEditor: () => windows.openEditor(),
      openCutout: () => windows.openCutout(),
      openOnboard: (force) => windows.openOnboard(force),
      dismissOnboard: () => windows.dismissOnboard(),
    },
    lists: {
      roleList: catalog.roleList,
      soundList: catalog.soundList,
      roleUrl: catalog.roleUrl,
      geocode,
      broadcastSettings: catalog.broadcastSettings,
      broadcastRoles: catalog.broadcastRoles,
      sendMirror: () => windows.sendMirror(),
      applySettingsSideEffects: (prev, next) => windows.applySettingsEffects(prev, next),
    },
    setQuitting: (v) => { quitting = v },
  })

  log('store=' + store.dir)
  windows.createPet()
  trayHost.create()
  trayHost.registerShortcut()
  log('windows created pet=' + (windows.pet() ? 'yes' : 'no') + ' tray=' + (trayHost.ready() ? 'yes' : 'no') + ' shortcut=' + trayHost.shortcutReport().ok)
  weatherPump.refresh('boot')
  weatherPump.schedule()
  reminders.start()
  nudges.start()

  if (process.env.DESKPET_OPEN_SETTINGS === '1') setTimeout(() => windows.openSettings(), 800)
  if (process.env.DESKPET_OPEN_EDITOR === '1') setTimeout(() => windows.openEditor(), 800)
  // M17 P0-1: first run gets the three-step card (once). Existing installs
  // that never dismissed it yet see it once too; after that `onboarded` is
  // true and the only way back in is 设置 → 其他 → 再看一次欢迎引导.
  if (process.env.DESKPET_OPEN_ONBOARD === '1') setTimeout(() => windows.openOnboard(true), 800)
  else if (process.env.DESKPET_NO_ONBOARD !== '1' && store.readSettings().onboarded !== true) {
    setTimeout(() => windows.openOnboard(false), 1400)
  }

  screen.on('display-removed', () => layout.ensureOnScreen())
  screen.on('display-added', () => layout.ensureOnScreen())
  screen.on('display-metrics-changed', () => layout.ensureOnScreen())
}).catch((err) => log('whenReady failed', (err && err.stack) || String(err)))

app.on('browser-window-focus', () => { if (nudges) nudges.touch() })

app.on('before-quit', () => {
  quitting = true
  if (nudges) nudges.stop()
  if (cutoutService) cutoutService.stopWorker()
  try { globalShortcut.unregisterAll() } catch (err) {}
})
app.on('window-all-closed', () => { /* keep running in the tray */ })