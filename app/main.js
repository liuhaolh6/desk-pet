/**
 * desk-pet —— Electron main process.
 *
 * A frameless, transparent, always-on-top window that holds the pet sprite.
 * The window grows upward when a speech bubble is visible so the transparent
 * area never swallows clicks meant for the desktop.
 */
'use strict'

const path = require('node:path')
const os = require('node:os')
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
const { clamp, WIN_PAD, windowWidth, bubbleReserveFor } = require('./main/geometry')
const { createTrayHost } = require('./main/tray')
const { createDiagnostics } = require('./main/diagnostics')
const { createWindowState } = require('./window-state')
const { createWindowLayout } = require('./main/window-layout')
const { createWeatherPump } = require('./main/weather-pump')
const { createReminders } = require('./main/reminder')
const { createCutoutService } = require('./main/cutout-service')
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
let petWin = null
let settingsWin = null
let editorWin = null
let cutoutWin = null
let onboardWin = null

// P1-1 stage 3: weather, reminders, cutout and IPC live in modules. The
// instances are created after the store exists (they read settings lazily).
let weatherPump = null
let reminders = null
let cutoutService = null
let quitting = false

// P1-1: the tray + shortcut (P0-3) and the diagnostics export (P0-5) live in
// modules; main.js only wires them to the pet window and the store.
const trayHost = createTrayHost({
  assets: ASSETS,
  readSettings: () => store.readSettings(),
  log,
  actions: {
    togglePet: () => togglePet(),
    openSettings: () => openSettings(),
    openEditor: () => openEditor(),
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
// thunk so the module never caches a closed window.
const layout = createWindowLayout({
  screen,
  placement,
  readSettings: () => store.readSettings(),
  log,
  winState,
  getWindow: () => petWin,
  onMirror: () => sendMirror(),
})

function sendMirror() {
  if (!petWin || petWin.isDestroyed()) return
  try { petWin.webContents.send('pet:mirror', layout.mirrorSide()) } catch (err) {}
}

// ----------------------------------------------------------------------- tray
/** Show/hide the pet. Shared by the tray entry, its left click and the shortcut. */
function togglePet() {
  if (!petWin) return createPetWindow()
  if (petWin.isVisible()) petWin.hide()
  else { petWin.show(); petWin.focus() }
}

// ------------------------------------------------------------------ role URLs
function roleUrl(id) {
  if (!id || id === 'default') return 'pet-role://default/'
  return 'pet-role://role/' + encodeURIComponent(id)
}

function handleRoleProtocol(request) {
  try {
    const url = new URL(request.url)
    let bytes = null
    if (url.hostname === 'default') {
      bytes = fs.readFileSync(path.join(ASSETS, 'default.png'))
    } else if (url.hostname === 'role') {
      const id = decodeURIComponent(url.pathname.replace(/^\//, ''))
      const file = store.roleImagePath(id)
      if (file) bytes = fs.readFileSync(file)
    }
    if (!bytes) return new Response('not found', { status: 404 })
    return new Response(bytes, { headers: { 'content-type': 'image/png' } })
  } catch (err) {
    return new Response('error', { status: 500 })
  }
}

function handleSoundProtocol(request) {
  try {
    const url = new URL(request.url)
    if (url.hostname !== 'sound') return new Response('not found', { status: 404 })
    const id = decodeURIComponent(url.pathname.replace(/^\//, ''))
    const file = store.soundPath(id)
    if (!file) return new Response('not found', { status: 404 })
    const bytes = fs.readFileSync(file)
    const ext = file.split('.').pop().toLowerCase()
    const type = {
      wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac',
    }[ext] || 'application/octet-stream'
    return new Response(bytes, { headers: { 'content-type': type } })
  } catch (err) {
    return new Response('error', { status: 500 })
  }
}

// ----------------------------------------------------------------- pet window
function createPetWindow() {
  const s = store.readSettings()
  const size = clamp(Number(s.size) || 220, 80, 480)
  const pos = layout.resolveWindowPosition(size)
  // 0.6.4: the window is born with the bubble strip already reserved. The pet
  // keeps its saved place (the strip grows upwards), clamped into the work area.
  const reserve = bubbleReserveFor(windowWidth(size))
  const nearest = screen.getDisplayNearestPoint({ x: pos.x + WIN_PAD + Math.floor(size / 2), y: pos.y })
  const work = nearest.workArea
  const winY = Math.max(work.y, Math.min(pos.y - reserve, work.y + work.height - (size + reserve)))
  // The saved/window x already excludes the window padding.
  layout.begin({ x: pos.x + WIN_PAD, y: winY + reserve, reserve })

  const opaque = process.env.DESKPET_OPAQUE === '1'
  petWin = new BrowserWindow({
    x: pos.x,
    y: winY,
    width: windowWidth(size),
    height: size + reserve,
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
      preload: path.join(__dirname, 'preload.js'),
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
  petWin.loadFile(path.join(__dirname, 'pet.html'))
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
    if (weatherPump && weatherPump.current()) petWin.webContents.send('weather:changed', weatherPump.current())
    sendMirror()
  })
}

function applySettingsSideEffects(prev, next) {
  if (!petWin) return
  const size = clamp(Number(next.size) || 220, 80, 480)
  const g = petWin.getBounds()
  if (windowWidth(size) !== g.width) {
    // Keep the pet anchored the same way it already is: bottom-fixed above the
    // bubble, top-fixed when the bubble is below.
    const prevSize = clamp(Number(prev && prev.size) || size, 80, 480)
    const pos = layout.petPos
    if (pos && prevSize !== size) pos.y = pos.y + prevSize - size
    const reserve = layout.reserve
    const y = pos ? pos.y - reserve : (g.y + g.height) - (size + reserve)
    petWin.setBounds({ x: g.x, y, width: windowWidth(size), height: size + reserve })
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
      app.setLoginItemSettings({ openAtLogin: !!next.autostart, path: PORTABLE_EXE || process.execPath, args })
    } catch (err) {}
  }
}

// -------------------------------------------------------------- settings view
function openSettings() {
  if (settingsWin) { settingsWin.show(); settingsWin.focus(); return }
  settingsWin = new BrowserWindow({
    width: 520,
    height: 660,
    minWidth: 460,
    minHeight: 560,
    title: '桌宠设置',
    backgroundColor: '#f7f9fd',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  settingsWin.loadFile(path.join(__dirname, 'settings.html'))
  settingsWin.on('closed', () => { settingsWin = null })
}

function openEditor() {
  if (editorWin) { editorWin.show(); editorWin.focus(); return }
  editorWin = new BrowserWindow({
    width: 960,
    height: 700,
    minWidth: 780,
    minHeight: 540,
    title: '气泡布置',
    backgroundColor: '#f7f9fd',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  editorWin.loadFile(path.join(__dirname, 'editor.html'))
  editorWin.on('closed', () => { editorWin = null })
}

function openCutout() {
  if (cutoutWin) { cutoutWin.show(); cutoutWin.focus(); return }
  cutoutWin = new BrowserWindow({
    width: 780,
    height: 760,
    minWidth: 680,
    minHeight: 600,
    title: '用照片做个我',
    backgroundColor: '#f7f9fd',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  cutoutWin.loadFile(path.join(__dirname, 'cutout.html'))
  winState.transition('cutout-open')
  cutoutWin.on('closed', () => { cutoutWin = null; if (cutoutService) cutoutService.clearInputs(); winState.transition('cutout-close') })
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
    title: '欢迎使用桌宠',
    backgroundColor: '#fbf6f8',
    autoHideMenuBar: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  onboardWin.once('ready-to-show', () => {
    try { onboardWin.show(); onboardWin.focus() } catch (err) {}
  })
  onboardWin.loadFile(path.join(__dirname, 'onboard.html'))
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

function broadcastSettings() {
  const settings = store.readSettings()
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('settings:changed', settings)
  }
  trayHost.setTooltip(settings.name)
  return settings
}

function broadcastRoles() {
  const roles = roleList()
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('roles:changed', roles)
  }
  return roles
}

function roleList() {
  const index = store.readRoles()
  return index.roles.map((r) => ({
    id: r.id,
    name: r.name || r.id,
    builtin: !!r.builtin,
    url: roleUrl(r.id),
    // null = legacy/imported role without a cutout verdict; false = saved
    // through the "scale only" fallback and must be shown as not cut out.
    cutout: r.cutout === undefined ? null : !!r.cutout,
    mode: r.mode || null,
  }))
}

function soundList() {
  return store.readSounds().files.map((f) => ({
    id: f.id,
    name: f.name || f.id,
    ext: f.ext,
    url: 'pet-sound://sound/' + encodeURIComponent(f.id),
  }))
}

// 诊断导出（P0-5）已拆到 app/main/diagnostics.js（P1-1）。

// ---------------------------------------------------------------------- boot
log('before lock')
// Pick a writable data directory before Electron touches its singleton lock:
// an unwritable userData makes requestSingleInstanceLock() crash natively.
function pickDataDir() {
  log('pickDataDir start')
  const candidates = []
  if (process.env.DESKPET_DATA_DIR) candidates.push(path.resolve(process.env.DESKPET_DATA_DIR))
  // Portable build: keep settings next to the exe so the folder can be moved or
  // copied (including to a USB stick) without losing state.
  if (PORTABLE_DIR) candidates.push(path.join(PORTABLE_DIR, 'desk-pet-data'))
  // Unpacked build: also allow the data folder next to the exe. This keeps the
  // app usable when antivirus blocks writes to the user profile.
  try { candidates.push(path.join(path.dirname(process.execPath), 'desk-pet-data')) } catch (err) {}
  // Do NOT use app.getPath('userData') here: in restricted environments it can
  // crash the process natively before we get a chance to fall back.
  if (process.platform === 'win32') {
    const roaming = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
    candidates.push(path.join(roaming, 'desk-pet'))
  } else {
    candidates.push(path.join(os.homedir(), '.desk-pet'))
  }
  candidates.push(path.join(os.tmpdir(), 'desk-pet'))
  breadcrumb('candidates=' + candidates.join(' | '))
  for (const dir of candidates) {
    log('trying data dir ' + dir)
    try {
      fs.mkdirSync(dir, { recursive: true })
      fs.accessSync(dir, fs.constants.W_OK)
      log('using data dir ' + dir)
      breadcrumb('data=' + dir)
      return dir
    } catch (err) { log('data dir unusable', dir, String(err && err.code)) }
  }
  return candidates[candidates.length - 1]
}
const DATA_DIR = pickDataDir()
logger.setFile(app.isPackaged ? path.join(DATA_DIR, 'app.log') : path.join(__dirname, '..', 'app.log'))
log('portableDir=' + (PORTABLE_DIR || '-') + ' portableExe=' + (PORTABLE_EXE || '-'))
try { app.setPath('userData', DATA_DIR) } catch (err) { log('setPath failed', String(err)) }
log('userData=' + app.getPath('userData'))
let hasLock = false
try { hasLock = app.requestSingleInstanceLock() } catch (err) { log('lock threw', (err && err.stack) || String(err)) }
log('lock=' + hasLock)
if (!hasLock) {
  // Another instance usually owns the lock; keep running anyway. A silently
  // missing pet is worse than a duplicate, which the user can close from its menu.
  log('single instance lock denied, continuing anyway')
  breadcrumb('lock denied, continuing')
}
{
  log('starting ui')
  app.on('second-instance', () => {
    if (petWin) { petWin.show(); petWin.focus() }
  })

  app.whenReady().then(() => {
    log('ready')
    app.setAppUserModelId('com.deskpet.app')
    store = createStore(app.getPath('userData'))
    protocol.handle('pet-role', handleRoleProtocol)
    protocol.handle('pet-sound', handleSoundProtocol)
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
      isPetVisible: () => !!(petWin && petWin.isVisible()),
      sendToPet: (channel) => { if (petWin && !petWin.isDestroyed()) petWin.webContents.send(channel) },
      notify: ({ title, body }) => { try { new Notification({ title, body }).show() } catch (err) {} },
    })
    registerIpc({
      ipcMain, dialog, shell, app, nativeImage, path, fs,
      store, version: VERSION, weatherPump, layout, winState, trayHost, diagnostics,
      cutoutService, cutout, placement, clamp, winPad: WIN_PAD, log,
      windows: {
        pet: () => petWin,
        settings: () => settingsWin,
        editor: () => editorWin,
        cutout: () => cutoutWin,
      },
      actions: {
        openSettings: () => openSettings(),
        openEditor: () => openEditor(),
        openCutout: () => openCutout(),
        openOnboard: (force) => openOnboard(force),
        dismissOnboard: () => dismissOnboard(),
      },
      lists: {
        roleList, soundList, roleUrl, geocode, broadcastSettings, broadcastRoles, sendMirror, applySettingsSideEffects,
      },
      setQuitting: (v) => { quitting = v },
    })
    log('store=' + store.dir)
    createPetWindow()
    trayHost.create()
    trayHost.registerShortcut()
    log('windows created pet=' + (petWin ? 'yes' : 'no') + ' tray=' + (trayHost.ready() ? 'yes' : 'no') + ' shortcut=' + trayHost.shortcutReport().ok)
    weatherPump.refresh('boot')
    weatherPump.schedule()
    reminders.start()
    if (process.env.DESKPET_OPEN_SETTINGS === '1') setTimeout(openSettings, 800)
    if (process.env.DESKPET_OPEN_EDITOR === '1') setTimeout(openEditor, 800)
    // M17 P0-1: first run gets the three-step card (once). Existing installs
    // that never dismissed it yet see it once too; after that `onboarded` is
    // true and the only way back in is 设置 → 其他 → 再看一次欢迎引导.
    if (process.env.DESKPET_OPEN_ONBOARD === '1') setTimeout(() => openOnboard(true), 800)
    else if (process.env.DESKPET_NO_ONBOARD !== '1' && store.readSettings().onboarded !== true) {
      setTimeout(() => openOnboard(false), 1400)
    }
    screen.on('display-removed', () => layout.ensureOnScreen())
    screen.on('display-added', () => layout.ensureOnScreen())
    screen.on('display-metrics-changed', () => layout.ensureOnScreen())
  }).catch((err) => log('whenReady failed', (err && err.stack) || String(err)))

  app.on('before-quit', () => { quitting = true; if (cutoutService) cutoutService.stopWorker(); try { globalShortcut.unregisterAll() } catch (err) {} })
  app.on('window-all-closed', () => { /* keep running in the tray */ })
}
