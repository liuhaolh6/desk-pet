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
const { createThemes, registerThemeIpc } = require('./main/theme')
const { seedDefaults } = require('./main/seed')
const debugOpen = require('./main/debug-open')
const { fetchWeather, geocode, advice } = require('../lib/weather')
const placement = require('../lib/placement')
const cutout = require('../lib/cutout')

const VERSION = require('../package.json').version
const ASSETS = path.join(__dirname, '..', 'assets')

const { createLogger } = require('./main/log')
const { clamp, WIN_PAD } = require('./main/geometry')
const { createTrayHost } = require('./main/tray')
const { createDiagnostics } = require('./main/diagnostics')
const { createPrivacy } = require('./main/privacy')
const { createUpdater } = require('./main/updater')
const { createWindowState } = require('./window-state')
const { createWindowLayout } = require('./main/window-layout')
const { createOverlay } = require('./main/overlay')
const { createWeatherPump } = require('./main/weather-pump')
const { createReminders } = require('./main/reminder')
const { createCutoutService } = require('./main/cutout-service')
const { createNudgePump } = require('./main/nudge-pump')
const { isForegroundFullscreen } = require('./main/fullscreen')
const { createWindows } = require('./main/windows')
const { createCatalog } = require('./main/catalog')
const { bootDataDir } = require('./main/boot')
const { registerIpc } = require('./main/ipc')
const { createMainI18n, registerI18nIpc } = require('./main/i18n')

const logger = createLogger()
const { breadcrumb, log } = logger
breadcrumb('start argv=' + process.argv.slice(1).join(' ') + ' exec=' + process.execPath)
// Portable target: the .exe the user double-clicked (the process runs from temp).
const PORTABLE_DIR = process.env.PORTABLE_EXECUTABLE_DIR || ''
const PORTABLE_EXE = process.env.PORTABLE_EXECUTABLE_FILE || ''

// Logger: breadcrumbs start before a data directory exists (see main/log.js).
process.on('uncaughtException', (err) => log('uncaught', (err && err.stack) || String(err)))
process.on('unhandledRejection', (err) => log('unhandledRejection', (err && err.stack) || String(err)))
log('boot electron=' + process.versions.electron + ' packaged=' + app.isPackaged + ' argv=' + process.argv.join(' '))

let store = null
let windows = null
let overlay = null
let catalog = null
let weatherPump = null
let reminders = null
let nudges = null
let cutoutService = null
let privacy = null
let themes = null
let quitting = false

// ROADMAP P2-7: the active theme pack is a CSS string produced here (main), so
// packs stay validated in one place; pages apply it (app/theme-boot.js).
function broadcastTheme() {
  const { BrowserWindow } = require('electron')
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('theme:changed')
  }
}

// P2-6: one translator for the main process; renderers get the dictionary over
// IPC (`i18n:dict`) and do their own lookup with the same `t()`.
let i18n = null
function t(key, vars) { return i18n ? i18n.t(key, vars) : key }

// P1-1: tray/shortcut (P0-3) and diagnostics (P0-5) are modules; this wires them.
const trayHost = createTrayHost({
  assets: ASSETS,
  readSettings: () => store.readSettings(),
  log,
  t: (key, vars) => t(key, vars),
  actions: {
    togglePet: () => windows && windows.togglePet(),
    openSettings: () => windows && windows.openSettings(),
    openEditor: () => windows && windows.openEditor(),
    refreshWeather: (reason) => weatherPump && weatherPump.refresh(reason),
    quit: () => { quitting = true; app.quit() },
  },
})
const diagnostics = createDiagnostics({ t: (key, vars) => t(key, vars),
  version: VERSION,
  getStore: () => store,
  logger,
  getWeather: () => (weatherPump ? weatherPump.current() : null),
  getTrayStatus: () => trayHost.status(),
  getShortcutReport: () => trayHost.shortcutReport(),
  log,
})

// P1-2: one explicit machine owns "what is the pet doing" (see window-state.js).
// ROADMAP P2-3: 更新检查。只“提示 + 打开下载页”，静默安装要等 P2-2 的签名到位。
const updater = createUpdater({
  version: VERSION,
  getSettings: () => store.readSettings(),
  patchSettings: (patch) => store.writeSettings(patch),
  isPackaged: () => app.isPackaged,
  openExternal: (url) => shell.openExternal(url),
  t, // P2-6 阶段三-O：更新提示的文案也走语言包

  // windows 在 boot() 里才赋值；这里延后到真正通知时再取，避免启动顺序耦合。
  notify: (msg) => {
    const pet = windows && windows.pet && windows.pet()
    if (pet && !pet.isDestroyed()) pet.webContents.send('pet:nudge', { kind: 'update', text: msg })
  },
  log,
})

const winState = createWindowState({
  log,
  onChange: ({ prev, next, event }) => {
    log('window-state', prev + '->' + next, event)
    layout.updateInteractive()
  },
})

// Role images go through a custom scheme so renderers never see file paths.
protocol.registerSchemesAsPrivileged([
  { scheme: 'pet-role', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  { scheme: 'pet-sound', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
])
log('schemes registered')

// P1-1 stage 2: layout, drag maths and hit testing live in window-layout.js.
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
  // ROADMAP P2-7: theme packs. The user folder shadows built-ins, so an import
  // never has to write into the (read-only for portable builds) install dir.
  themes = createThemes({
    builtinDir: path.join(__dirname, '..', 'themes'),
    userDir: path.join(store.dir, 'themes'),
    log,
  })
  // P2-6：语言来自设置（空 = 跟随系统），坏文件/缺子串都不影响启动。
  i18n = createMainI18n({ requested: (store.readSettings().locale || ''), system: app.getLocale(), log })
  // preload 在窗口加载时同步取字典，所以通道必须先于 createWindows 注册。
  registerI18nIpc({ ipcMain, i18n })
  registerThemeIpc({
    ipcMain, themes, store, dialog, userDir: path.join(store.dir, 'themes'),
    log: (kind, detail) => logger.breadcrumb('theme ' + kind + ' ' + String(detail || '')),
    onChange: () => broadcastTheme(),
  })

  seedDefaults(store, i18n)
  privacy = createPrivacy({ dir: store.dir, fs, path, log, t })
  catalog = createCatalog({ fs, store, assets: ASSETS, BrowserWindow, trayHost })
  windows = createWindows({
    BrowserWindow, screen, app, store, layout, winState,
    assets: ASSETS, portableExe: PORTABLE_EXE, log,
    getWeather: () => (weatherPump ? weatherPump.current() : null),
    onCutoutClosed: () => { if (cutoutService) cutoutService.clearInputs() },
    i18n,
  })

  // P2-4: the bubble gets its own transparent window. It follows the pet and
  // never forces the pet window to reserve a strip above the sprite.
  overlay = createOverlay({
    BrowserWindow, screen, store, log,
    getPetWin: () => windows.pet(),
    getLayout: () => layout,
  })

  protocol.handle('pet-role', catalog.handleRoleProtocol)
  protocol.handle('pet-sound', catalog.handleSoundProtocol)
  const { session } = require('electron')
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    callback(permission === 'geolocation')
  })

  cutoutService = createCutoutService({
    store, nativeImage, cutout, app, utilityProcess,
    path, fs, log, t, rootDir: __dirname,
  })
  weatherPump = createWeatherPump({
    store, fetchWeather, advice, clamp, log, t,
    getWindows: () => BrowserWindow.getAllWindows(),
  })
  reminders = createReminders({
    store, clamp, t,
    isPetVisible: () => { const pet = windows.pet(); return !!(pet && pet.isVisible()) },
    sendToPet: (channel) => { const pet = windows.pet(); if (pet && !pet.isDestroyed()) pet.webContents.send(channel) },
    notify: ({ title, body }) => { try { new Notification({ title, body }).show() } catch (err) {} },
  })
  const fgCache = { at: 0, value: false }
  nudges = createNudgePump({
    store, log, t,
    sendToPet: (channel, data) => { const pet = windows.pet(); if (pet && !pet.isDestroyed()) pet.webContents.send(channel, data) },
    isBusy: () => isForegroundFullscreen({ cache: fgCache }),
  })
  registerIpc({
    ipcMain, dialog, shell, app, nativeImage, path, fs,
    store, i18n, version: VERSION, weatherPump, layout, winState, trayHost, diagnostics, updater, privacy,
    cutoutService, cutout, placement, clamp, winPad: WIN_PAD, log, nudges, overlay,
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
  // P2-3: 启动 12 秒后悄悄查一次更新，不阻塞任何初始化；24h 内重复启动不会重复请求。
  if (updater) updater.checkOnBoot(12000)
  reminders.start()
  nudges.start()

  debugOpen.windows({ windows, store, log })

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

// P2-6 阶段三-P：语言确定后，把"用户数据里的默认值"补齐（只补空的，不覆盖用户改过的）。
