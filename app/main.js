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
  app, BrowserWindow, Tray, Menu, ipcMain, screen, dialog,
  nativeImage, Notification, protocol, shell, utilityProcess, globalShortcut,
} = require('electron')

const { createStore } = require('../lib/store')
const { fetchWeather, geocode, advice } = require('../lib/weather')
const placement = require('../lib/placement')
const cutout = require('../lib/cutout')

const VERSION = require('../package.json').version
const ASSETS = path.join(__dirname, '..', 'assets')

// Best-effort breadcrumb next to the executable. Written before any data dir is
// chosen, so even a launch that dies early leaves a trace to diagnose.
function breadcrumb(text) {
  try {
    const file = path.join(path.dirname(process.execPath), 'desk-pet-boot.log')
    let size = 0
    try { size = fs.statSync(file).size } catch (err) {}
    if (size > 32 * 1024) fs.writeFileSync(file, '')
    fs.appendFileSync(file, new Date().toISOString() + ' ' + text + '\n')
  } catch (err) {}
}
breadcrumb('start argv=' + process.argv.slice(1).join(' ') + ' exec=' + process.execPath)
// electron-builder's portable target sets these to the folder/file of the .exe
// the user actually double-clicked (the running process lives in a temp dir).
const PORTABLE_DIR = process.env.PORTABLE_EXECUTABLE_DIR || ''
const PORTABLE_EXE = process.env.PORTABLE_EXECUTABLE_FILE || ''

// A packaged app's __dirname is inside app.asar, which is read-only, so the log
// target moves to the data directory once that has been chosen. Lines written
// before that are buffered and flushed, keeping boot logs in one file.
let LOG_FILE = null
const pendingLogs = []

function writeLogLine(line) {
  if (!LOG_FILE) { pendingLogs.push(line); return }
  try { fs.appendFileSync(LOG_FILE, line) } catch (err) {}
}

function log() {
  writeLogLine(new Date().toISOString() + ' ' + Array.prototype.join.call(arguments, ' ') + '\n')
}

function setLogFile(file) {
  LOG_FILE = file
  for (const line of pendingLogs.splice(0)) writeLogLine(line)
}

process.on('uncaughtException', (err) => log('uncaught', (err && err.stack) || String(err)))
process.on('unhandledRejection', (err) => log('unhandledRejection', (err && err.stack) || String(err)))
log('boot electron=' + process.versions.electron + ' packaged=' + app.isPackaged + ' argv=' + process.argv.join(' '))

let store = null
let petWin = null
let settingsWin = null
let editorWin = null
let cutoutWin = null
let onboardWin = null
let tray = null
// P0-3: the tray is known to be invisible on some machines, so the app records
// what actually happened and the settings page tells the user which doors are
// still open (pet hover menu + the Ctrl+Alt+P global shortcut).
let trayStatus = { ok: false, reason: '还没创建' }
let shortcutStatus = { ok: false, accelerator: 'Ctrl+Alt+P', reason: '还没注册' }
let extraBubbleHeight = 0
// Where the reserved bubble space sits relative to the pet. `above` grows the
// window upward; `below` grows it downward (used when the pet is too close to
// the top of the work area). Either way the pet's screen rect never changes.
let bubbleSide = 'above'
// The pet's top-left on screen, tracked explicitly. Deriving it from the window
// bounds is fragile (frameless windows report a slightly different outer height
// than BrowserWindow.getBounds(), and a stale height after a snap rounds off a
// few px), and any error there moves the pet when a bubble opens.
let petPos = null
let weather = null
let weatherTimer = null
let reminderTimer = null
let lastRemindAt = 0
let quitting = false

// The pet window is the only consumer of role images, but a custom scheme keeps
// file paths out of the renderer entirely.
protocol.registerSchemesAsPrivileged([
  { scheme: 'pet-role', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  { scheme: 'pet-sound', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
])
log('schemes registered')

function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)) }

// Horizontal breathing room so bubbles can be wider than the pet itself.
const WIN_PAD = 54
function windowWidth(size) { return size + WIN_PAD * 2 }
// Mirrors app/pet.js syncBubbleMetrics()/bubbleReserve(): --bubble-w is
// clamp(220, innerWidth - 12, 340) and the frame keeps a 1026:700 aspect ratio.
// Creating the window already this tall means the first bubble never resizes
// the transparent window (a resize is what made it flicker).
const BUBBLE_MIN_W = 220
const BUBBLE_MAX_W = 340
function bubbleReserveFor(width) {
  const w = Math.max(BUBBLE_MIN_W, Math.min(BUBBLE_MAX_W, Math.round(width) - 12))
  return Math.ceil((w * 700) / 1026) + 8
}

// ---------------------------------------------------------- mouse passthrough
let hitRects = []
let petDragging = false
let petInteractive = false
let petHitTimer = 0

/** Flip click-through based on where the OS cursor is right now. */
function updatePetInteractive() {
  if (!petWin || petWin.isDestroyed()) return
  let inside = petDragging
  if (!inside) {
    let p
    try { p = screen.getCursorScreenPoint() } catch (err) { return }
    const b = petWin.getBounds()
    for (const r of hitRects) {
      if (!r) continue
      if (p.x >= b.x + r.x && p.x <= b.x + r.x + r.w && p.y >= b.y + r.y && p.y <= b.y + r.y + r.h) {
        inside = true
        break
      }
    }
  }
  if (inside === petInteractive) return
  petInteractive = inside
  if (process.env.DESKPET_TRACE_HIT === '1') log('hit-interactive', inside ? 'on' : 'off', 'rects=' + hitRects.length)
  try { petWin.setIgnoreMouseEvents(!inside, { forward: true }) } catch (err) {}
}

function getDisplays() {
  const primaryId = String(screen.getPrimaryDisplay().id)
  return screen.getAllDisplays().map((d) => ({
    id: String(d.id),
    primary: String(d.id) === primaryId,
    workArea: d.workArea,
  }))
}

/** Window position for startup, clamped onto an existing display. */
function resolveWindowPosition(size) {
  const s = store.readSettings()
  const res = placement.resolveSaved(s.position, getDisplays(), size, WIN_PAD, 24)
  if (res.moved) log('position clamped to display=' + res.displayId)
  return { x: res.x, y: res.y, displayId: res.displayId }
}

/** Keep the pet visible after a monitor is unplugged or its resolution changes. */
function ensureOnScreen() {
  if (!petWin) return
  const s = store.readSettings()
  const size = clamp(Number(s.size) || 220, 80, 480)
  const b = petWin.getBounds()
  const pet = placement.petRectOf({ x: b.x, y: petTopLeft().y }, size, WIN_PAD)
  const display = placement.displayForRect(getDisplays(), pet)
  if (!display) return
  const clamped = placement.clampPet(pet, display.workArea)
  const extra = Math.max(0, b.height - size)
  const moved = clamped.x !== pet.x || clamped.y !== pet.y
  if (moved) {
    log('relocate pet to display=' + display.id)
    petPos = { x: clamped.x, y: clamped.y }
    petWin.setBounds(windowBoundsForPet(clamped.x, clamped.y, size, extra))
    sendMirror()
  }
}

function petTopLeft() {
  if (!petWin) return { x: 0, y: 0 }
  const s = store.readSettings()
  const size = clamp(Number(s.size) || 220, 80, 480)
  return { x: petScreenRect(size).x, y: petScreenRect(size).top }
}

/**
 * Where the pet actually is on screen, derived from the window bounds. In
 * `above` mode the pet sits at the window's bottom and the reserve is on top;
 * in `below` mode the pet sits at the window's top and the reserve is below.
 */
function petScreenRect(size) {
  if (petPos) return { x: petPos.x, top: petPos.y, bottom: petPos.y + size }
  const b = petWin.getBounds()
  const reserve = Math.max(0, b.height - size)
  if (bubbleSide === 'below') {
    return { x: b.x, top: b.y + b.height - reserve - size, bottom: b.y + b.height - reserve }
  }
  return { x: b.x, top: b.y + b.height - size, bottom: b.y + b.height }
}

/** Window bounds that put the pet's top-left at (petX, petY) for the given reserve. */
function windowBoundsForPet(petX, petY, size, reserve) {
  const extra = Math.max(0, Math.round(reserve))
  return {
    x: petX - WIN_PAD,
    y: bubbleSide === 'below' ? petY : petY - extra,
    width: windowWidth(size),
    height: size + extra,
  }
}

/** Which screen edge the pet is hugging, for the renderer's mirror effect. */
function mirrorSide() {
  if (!petWin) return 'none'
  const b = petWin.getBounds()
  const s = store.readSettings()
  const size = clamp(Number(s.size) || 220, 80, 480)
  const area = screen.getDisplayMatching(b).workArea
  // Compare the pet's rect, not the window rect: the window has WIN_PAD on
  // both sides, so its right edge is normally off-screen even when the pet is
  // sitting 24px away from the edge.
  const pet = placement.petRectOf({ x: b.x, y: petTopLeft().y }, size, WIN_PAD)
  const margin = 20
  if (pet.x <= area.x + margin) return 'left'
  if (pet.x + pet.width >= area.x + area.width - margin) return 'right'
  return 'none'
}

function sendMirror() {
  if (!petWin || petWin.isDestroyed()) return
  try { petWin.webContents.send('pet:mirror', mirrorSide()) } catch (err) {}
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
  const pos = resolveWindowPosition(size)
  // 0.6.4: the window is born with the bubble strip already reserved. The pet
  // keeps its saved place (the strip grows upwards), clamped into the work area.
  const reserve = bubbleReserveFor(windowWidth(size))
  const nearest = screen.getDisplayNearestPoint({ x: pos.x + WIN_PAD + Math.floor(size / 2), y: pos.y })
  const work = nearest.workArea
  const winY = Math.max(work.y, Math.min(pos.y - reserve, work.y + work.height - (size + reserve)))
  // The saved/window x already excludes the window padding.
  petPos = { x: pos.x + WIN_PAD, y: winY + reserve }
  bubbleSide = 'above'
  extraBubbleHeight = reserve

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
  if (!petHitTimer) petHitTimer = setInterval(updatePetInteractive, 50)
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
    if (weather) petWin.webContents.send('weather:changed', weather)
    sendMirror()
  })
}

/**
 * Reserve bubble/menu space WITHOUT moving the pet on screen.
 *
 * The old version computed `y = max(workArea.y, bottom - nextH)`; when the pet
 * sat near the top of the work area that clamp pushed the window's bottom down,
 * and since the pet is anchored to the window's bottom it visibly slid down (same
 * size, wrong place) on the first taps after startup or a drag.
 *
 * Now: keep the pet's screen rect fixed. Grow upward when there is room above,
 * otherwise grow downward (renderer puts the bubble below the pet). If neither
 * side can host the full height, reserve whatever the larger side has.
 *
 * @returns {{reserve:number, side:'above'|'below'}}
 */
function applyBubbleHeight(visible, height) {
  if (!petWin) return { reserve: extraBubbleHeight, side: bubbleSide }
  const s = store.readSettings()
  const size = clamp(Number(s.size) || 220, 80, 480)
  const requested = clamp(Math.round(Number(height) || 0), 0, 420)
  // Treat sub-card heights as "no bubble": they are invisible leftovers that
  // otherwise leave a few pixels of reserved space (and shift drag maths).
  const want = visible && requested >= 40 ? requested : 0

  const b = petWin.getBounds()
  const pet = petScreenRect(size)
  const display = screen.getDisplayNearestPoint({
    x: b.x + Math.floor(b.width / 2),
    y: pet.bottom - Math.floor(size / 2),
  })
  const work = display.workArea

  // 0.6.2 (user decision): the bubble always sits ABOVE the pet. When the pet is
  // too close to the top edge, move it down so a bubble-sized gap stays between
  // the pet and the boundary - never flip the bubble below the pet.
  const side = 'above'
  const reserve = Math.max(0, Math.min(want, 420))
  const minTop = work.y + reserve
  const maxTop = work.y + Math.max(0, work.height - size)
  let petTop = Math.min(Math.max(pet.top, minTop), maxTop)
  const nextH = size + reserve
  const bounds = windowBoundsForPet(pet.x, petTop, size, reserve)
  const changed = side !== bubbleSide || reserve !== extraBubbleHeight ||
    b.height !== nextH || b.y !== bounds.y || b.x !== bounds.x
  bubbleSide = side
  extraBubbleHeight = reserve
  if (petTop !== pet.top) {
    petPos = { x: pet.x, y: petTop }
    sendMirror()
  }
  if (changed) {
    // Re-assert transparency right before the bounds change: the newly exposed
    // strip can otherwise be composited with the window background for a frame.
    if (process.env.DESKPET_OPAQUE !== '1') {
      try { petWin.setBackgroundColor('#00000000') } catch (err) {}
    }
    petWin.setBounds(bounds, false)
  }
  return { reserve, side }
}

function applySettingsSideEffects(prev, next) {
  if (!petWin) return
  const size = clamp(Number(next.size) || 220, 80, 480)
  const g = petWin.getBounds()
  if (windowWidth(size) !== g.width) {
    // Keep the pet anchored the same way it already is: bottom-fixed above the
    // bubble, top-fixed when the bubble is below.
    const prevSize = clamp(Number(prev && prev.size) || size, 80, 480)
    if (petPos && bubbleSide !== 'below' && prevSize !== size) {
      petPos.y = petPos.y + prevSize - size
    }
    const y = bubbleSide === 'below'
      ? (petPos ? petPos.y : g.y)
      : (petPos ? petPos.y - extraBubbleHeight : (g.y + g.height) - (size + extraBubbleHeight))
    petWin.setBounds({ x: g.x, y, width: windowWidth(size), height: size + extraBubbleHeight })
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
  cutoutWin.on('closed', () => { cutoutWin = null; cutoutInputs.clear() })
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
  const pet = petScreenRect(size)
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
  if (tray) tray.setToolTip(settings.name + ' · 桌宠')
  return settings
}

function broadcastRoles() {
  const roles = roleList()
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('roles:changed', roles)
  }
  return roles
}

// -------------------------------------------------------------------- weather
async function refreshWeather(reason) {
  const s = store.readSettings()
  const w = s.weather || {}
  if (w.lat == null || w.lon == null) {
    weather = { ok: false, error: 'NO_LOCATION', message: '还没告诉我你在哪座城市呢' }
    sendWeather()
    return weather
  }
  try {
    weather = await fetchWeather({ lat: w.lat, lon: w.lon, city: w.city, label: w.label })
    store.writeWeatherCache({ key: w.lat + ',' + w.lon, at: Date.now(), value: weather })
  } catch (err) {
    const cache = store.readWeatherCache()
    if (cache && cache.value) {
      weather = Object.assign({}, cache.value, { stale: true, error: String(err.message || err) })
      // Older caches predate the advice line / hourly strip: fill what we can.
      if (!weather.advice) weather.advice = advice(weather)
      if (!Array.isArray(weather.hourly)) weather.hourly = []
    } else weather = { ok: false, error: 'FETCH_FAILED', message: String(err.message || err) }
  }
  sendWeather()
  return weather
}

function sendWeather() {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('weather:changed', weather)
  }
}

function scheduleWeather() {
  if (weatherTimer) clearInterval(weatherTimer)
  const s = store.readSettings()
  const minutes = clamp(Number(s.weather && s.weather.refreshMinutes) || 15, 5, 180)
  weatherTimer = setInterval(() => { refreshWeather('timer') }, minutes * 60000)
}

// ------------------------------------------------------------------ reminders
function inQuietHours(w) {
  const from = clamp(Number(w.quietFrom), 0, 23) * 60
  const to = clamp(Number(w.quietTo), 0, 23) * 60
  if (from === to) return false
  const now = new Date()
  const mins = now.getHours() * 60 + now.getMinutes()
  return from < to ? (mins >= from && mins < to) : (mins >= from || mins < to)
}

function startReminders() {
  if (reminderTimer) clearInterval(reminderTimer)
  reminderTimer = setInterval(() => {
    const s = store.readSettings()
    if (s.mode === 'quiet') return
    if (inQuietHours(s.water || {})) return
    const interval = clamp(Number(s.water.intervalMinutes) || 60, 5, 600) * 60000
    const last = Number(s.water.lastDrinkAt) || 0
    if (Date.now() - last < interval) return
    if (Date.now() - lastRemindAt < 10 * 60000) return
    lastRemindAt = Date.now()
    if (petWin && petWin.isVisible()) {
      petWin.webContents.send('remind:water')
    } else {
      try {
        new Notification({ title: s.name || '桌宠', body: '该喝水啦，慢慢喝～' }).show()
      } catch (err) {}
    }
  }, 60000)
}

// ----------------------------------------------------------------------- tray
/** Show/hide the pet. Shared by the tray entry, its left click and the shortcut. */
function togglePet() {
  if (!petWin) return createPetWindow()
  if (petWin.isVisible()) petWin.hide()
  else { petWin.show(); petWin.focus() }
}

function createTray() {
  let iconPath = path.join(ASSETS, 'tray.png')
  if (!fs.existsSync(iconPath)) iconPath = path.join(ASSETS, 'icon.png')
  let image = nativeImage.createFromPath(iconPath)
  if (image.isEmpty()) image = nativeImage.createEmpty()
  try {
    tray = new Tray(image)
  } catch (err) {
    tray = null
    trayStatus = { ok: false, reason: '托盘没能创建出来：' + ((err && err.message) || String(err)) }
    log('tray create failed', (err && err.stack) || String(err))
    return
  }
  const s = store.readSettings()
  tray.setToolTip(s.name + ' · 桌宠')
  const menu = Menu.buildFromTemplate([
    { label: '显示 / 隐藏', click: togglePet },
    { label: '设置…', click: openSettings },
    { label: '布置气泡…', click: openEditor },
    { label: '看看天气', click: () => refreshWeather('tray') },
    { type: 'separator' },
    { label: '先退出啦', click: () => { quitting = true; app.quit() } },
  ])
  tray.setContextMenu(menu)
  tray.on('click', togglePet)
  trayStatus = image.isEmpty()
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
function registerGlobalShortcut() {
  const accelerator = 'CommandOrControl+Alt+P'
  try {
    const ok = globalShortcut.register(accelerator, togglePet)
    shortcutStatus = ok
      ? { ok: true, accelerator: 'Ctrl+Alt+P', reason: '' }
      : { ok: false, accelerator: 'Ctrl+Alt+P', reason: '这个组合被别的程序占用了' }
  } catch (err) {
    shortcutStatus = { ok: false, accelerator: 'Ctrl+Alt+P', reason: (err && err.message) || String(err) }
  }
  log('shortcut ' + accelerator + ' ok=' + shortcutStatus.ok + (shortcutStatus.reason ? ' reason=' + shortcutStatus.reason : ''))
}

/** Shortcut state with the OS re-read, shared by 设置页 and 诊断导出. */
function shortcutReport() {
  let registered = false
  try { registered = globalShortcut.isRegistered('CommandOrControl+Alt+P') } catch (err) { registered = false }
  return Object.assign({}, shortcutStatus, { registered })
}

// ---------------------------------------------------------------------- menu
// The pet window deliberately has no right-click menu; everything lives in the
// renderer's hover menu and the tray menu.

// ----------------------------------------------------------------------- IPC
// One limit for both "pick a file" and "decode a data URL", measured on the
// binary bytes. 25MB of JPEG is ~33MB of base64, so a 30MB base64 cap used to
// reject files that the 25MB file check had just accepted.
const MAX_IMAGE_BYTES = 25 * 1024 * 1024

function decodeImageDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') throw new Error('没收到图片数据')
  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=\s]+)$/i)
  if (!match) throw new Error('这个格式还看不了呢')
  const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64')
  if (!buffer.length) throw new Error('这张图是空的')
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error('图片超过 25MB 啦，先压缩一下好吗')
  return { buffer, mime: match[1].toLowerCase() }
}

/** One JSON line per cutout attempt; rotate at 256KB. Local diagnostics only. */
function cutoutTrace(entry) {
  try {
    const file = path.join(store.dir, 'cutout-trace.jsonl')
    try { if (fs.statSync(file).size > 256 * 1024) fs.renameSync(file, file + '.1') } catch (err) {}
    fs.appendFileSync(file, JSON.stringify(Object.assign({ at: new Date().toISOString() }, entry)) + '\n')
  } catch (err) {
    log('cutout trace failed', String(err))
  }
}

function cutoutErrorMessage(code) {
  if (code === 'NO_PERSON') return '没找到清晰的人像'
  if (code === 'OVER_SEGMENTED') return '画面里人像占得太多了，可能把背景也当成你了'
  if (code === 'MODEL_MISSING' || code === 'MODEL_LOAD_FAILED') return '抠图模型还没准备好'
  if (code === 'BAD_OUTPUT_SHAPE' || code === 'NO_OUTPUT') return '模型这次没给出结果'
  return '这次没抠成'
}

// ------------------------------------------------------------------- worker
// The compose/encode path blocks the main thread for ~60ms and inference for
// ~600ms; both run in a utility process instead (P1-5). If the worker cannot
// start (or dies), cutout:run falls back to running in-process.
let cutoutWorker = null
let cutoutWorkerSeq = 0
const cutoutWorkerPending = new Map()

function cutoutWorkerPath() {
  const script = path.join(__dirname, '..', 'lib', 'cutout-worker.js')
  if (!app.isPackaged) return script
  // lib is asarUnpacked so the utility process gets a real file path and can
  // resolve onnxruntime-node/onnxruntime-common from the same unpacked tree.
  const unpacked = script.replace('app.asar', 'app.asar.unpacked')
  try { if (fs.existsSync(unpacked)) return unpacked } catch (err) {}
  return script
}

function ensureCutoutWorker() {
  if (cutoutWorker) return cutoutWorker
  const worker = utilityProcess.fork(cutoutWorkerPath(), [], { serviceName: 'deskpet-cutout' })
  worker.on('message', (message) => {
    const pending = cutoutWorkerPending.get(message && message.id)
    if (!pending) return
    cutoutWorkerPending.delete(message.id)
    clearTimeout(pending.timer)
    pending.resolve(message)
  })
  worker.on('exit', (code) => {
    log('cutout worker exited code=' + code)
    cutoutWorker = null
    for (const pending of cutoutWorkerPending.values()) {
      clearTimeout(pending.timer)
      pending.reject(Object.assign(new Error('WORKER_EXITED'), { code: 'WORKER_EXITED' }))
    }
    cutoutWorkerPending.clear()
  })
  cutoutWorker = worker
  return worker
}

function stopCutoutWorker() {
  if (cutoutWorker) {
    try { cutoutWorker.kill() } catch (err) {}
    cutoutWorker = null
  }
}

function runCutoutInWorker(rgba, width, height, options) {
  return new Promise((resolve, reject) => {
    let worker
    try { worker = ensureCutoutWorker() } catch (err) {
      reject(Object.assign(new Error('WORKER_SPAWN_FAILED: ' + err.message), { code: 'WORKER_SPAWN_FAILED' }))
      return
    }
    const id = ++cutoutWorkerSeq
    const timer = setTimeout(() => {
      cutoutWorkerPending.delete(id)
      reject(Object.assign(new Error('WORKER_TIMEOUT'), { code: 'WORKER_TIMEOUT' }))
    }, 60000)
    cutoutWorkerPending.set(id, { resolve, reject, timer })
    const payload = rgba.buffer.slice(rgba.byteOffset, rgba.byteOffset + rgba.byteLength)
    try {
      // Electron's postMessage transfer list only accepts MessagePorts; the
      // ArrayBuffer is structured-cloned (copied) instead.
      worker.postMessage({
        type: 'run',
        id,
        rgba: payload,
        width,
        height,
        canvas: options.canvas,
        preprocess: options.preprocess,
        decontaminate: options.decontaminate,
      })
    } catch (err) {
      cutoutWorkerPending.delete(id)
      clearTimeout(timer)
      reject(Object.assign(new Error('WORKER_POST_FAILED: ' + err.message), { code: 'WORKER_POST_FAILED' }))
    }
  })
}

/**
 * Run the cutout, preferring the utility process. Returns the same shape as
 * `cutout.cutoutImageRGBA` (png/maskPng/coverage/...), with decode done here.
 */
async function runCutoutDecoded(image, options) {
  const { rgba, width, height } = cutout.loadWorkingRGBA(nativeImage, image)
  const inline = process.env.DESKPET_CUTOUT_INLINE === '1'
  if (!inline) {
    try {
      const message = await runCutoutInWorker(rgba, width, height, options)
      if (message && message.ok) {
        return {
          png: Buffer.from(message.png),
          maskPng: Buffer.from(message.maskPng),
          coverage: message.coverage,
          bands: message.bands,
          timings: message.timings,
          ms: message.ms,
          preprocess: message.preprocess,
          source: message.source,
          working: message.working,
          cutout: message.cutout,
        }
      }
      throw Object.assign(new Error(message && message.message || 'worker failed'), {
        code: (message && message.code) || 'CUTOUT_FAILED',
        coverage: message && message.coverage,
      })
    } catch (err) {
      // A real segmentation answer (NO_PERSON / OVER_SEGMENTED) must be
      // reported as-is; only infrastructure failures fall back in-process.
      const code = (err && err.code) || 'CUTOUT_FAILED'
      if (['NO_PERSON', 'OVER_SEGMENTED', 'MODEL_MISSING', 'MODEL_LOAD_FAILED', 'NO_OUTPUT', 'BAD_OUTPUT_SHAPE', 'BAD_IMAGE'].includes(code)) {
        throw err
      }
      log('cutout worker failed, running in-process', code, String(err && err.message || err))
      stopCutoutWorker()
      return cutout.cutoutImageRGBA(rgba, width, height, options)
    }
  }
  return cutout.cutoutImageRGBA(rgba, width, height, options)
}

// ------------------------------------------------------- cutout input tokens
// The renderer must not receive the full-size photo (a 25MB JPEG becomes ~33MB
// of base64). `cutout:pick`/`cutout:load` keep the decoded native image here
// and hand the renderer a token plus a small preview; `cutout:run` is then
// called with the token only.
const CUTOUT_INPUT_LIMIT = 3
const cutoutInputs = new Map()

function previewDataUrl(image, max = 1200) {
  const preview = cutout.scaleOnly(image, max)
  return 'data:image/png;base64,' + preview.toPNG().toString('base64')
}

function rememberCutoutInput(image, name) {
  const token = 'c' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
  cutoutInputs.set(token, { image, name: String(name || '').slice(0, 30), at: Date.now() })
  while (cutoutInputs.size > CUTOUT_INPUT_LIMIT) {
    const oldest = cutoutInputs.keys().next().value
    cutoutInputs.delete(oldest)
  }
  return token
}

function cutoutInputPayload(image, name) {
  const size = image.getSize()
  return {
    token: rememberCutoutInput(image, name),
    dataUrl: previewDataUrl(image),
    name: String(name || '').slice(0, 30),
    width: size.width,
    height: size.height,
  }
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

// ---------------------------------------------------------------- diagnostics
// P0-5: one click produces a txt that a human can attach to a bug report. It
// must never carry the user's photo, the custom phrases or the city coordinates.
const REDACTED = '[已脱敏]'

function sanitizedSettings() {
  const s = JSON.parse(JSON.stringify(store.readSettings()))
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

function tailLines(file, maxLines, maxBytes) {
  if (!file) return '（还没有日志文件）'
  try {
    const buf = fs.readFileSync(file)
    const slice = buf.length > maxBytes ? buf.subarray(buf.length - maxBytes) : buf
    const lines = slice.toString('utf8').split(/\r?\n/)
    if (buf.length > maxBytes && lines.length > 1) lines[0] = '…（更早的内容已省略）'
    return lines.slice(-maxLines).join('\n')
  } catch (err) {
    return '（读不到：' + ((err && err.message) || String(err)) + '）'
  }
}

function buildDiagnostics() {
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
    '版本：' + VERSION,
    'Electron：' + process.versions.electron + ' / Chromium ' + process.versions.chrome + ' / Node ' + process.versions.node,
    '系统：' + process.platform + ' ' + process.arch + ' ' + os.release(),
    '数据目录：' + store.dir,
    '日志文件：' + (LOG_FILE || '（还没定下来）'),
    '',
    '## 托盘与快捷键',
    JSON.stringify({ tray: trayStatus, shortcut: shortcutReport() }, null, 2),
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
    tailLines(LOG_FILE, 200, 256 * 1024),
    '',
    '## cutout-trace.jsonl 末尾 60 行',
    tailLines(path.join(store.dir, 'cutout-trace.jsonl'), 60, 128 * 1024),
    '',
  ].join('\n')
}

function exportDiagnostics() {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-')
  const file = path.join(store.dir, 'diagnostics-' + stamp + '.txt')
  const text = buildDiagnostics()
  fs.writeFileSync(file, text, 'utf8')
  try { shell.showItemInFolder(file) } catch (err) {}
  log('diagnostics exported ' + file + ' chars=' + text.length)
  return { ok: true, path: file, bytes: Buffer.byteLength(text) }
}

function registerIpc() {
  ipcMain.handle('state:get', () => ({
    settings: store.readSettings(),
    roles: roleList(),
    weather,
    version: VERSION,
    dataDir: store.dir,
  }))

  ipcMain.handle('app:status', () => ({
    version: VERSION,
    electron: process.versions.electron,
    platform: process.platform,
    dataDir: store.dir,
    tray: trayStatus,
    // `isRegistered` re-reads the OS state instead of trusting the register()
    // return value, which is what a bug report should record.
    shortcut: shortcutReport(),
  }))

  ipcMain.handle('settings:set', (ev, patch) => {
    const prev = store.readSettings()
    const next = store.writeSettings(patch || {})
    applySettingsSideEffects(prev, next)
    broadcastSettings()
    if (patch && patch.weather) { refreshWeather('settings'); scheduleWeather() }
    if (patch && patch.water) startReminders()
    return next
  })

  ipcMain.handle('roles:list', () => roleList())

  ipcMain.handle('roles:import', async () => {
    const result = await dialog.showOpenDialog(settingsWin || petWin, {
      title: '挑一张图片当角色',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    })
    if (result.canceled || !result.filePaths || !result.filePaths[0]) return { ok: false, canceled: true }
    const file = result.filePaths[0]
    let image = nativeImage.createFromPath(file)
    if (image.isEmpty()) return { ok: false, error: '这张图打不开呢' }
    const size = image.getSize()
    const max = 610
    if (size.width > max || size.height > max) {
      const scale = Math.min(max / size.width, max / size.height)
      image = image.resize({ width: Math.round(size.width * scale), height: Math.round(size.height * scale), quality: 'best' })
    }
    const name = path.basename(file).replace(/\.[^.]+$/, '').slice(0, 30)
    const entry = store.addRole(name, image.toPNG())
    store.writeSettings({ roleId: entry.id })
    broadcastSettings()
    broadcastRoles()
    return { ok: true, role: entry, roles: roleList() }
  })

  ipcMain.handle('roles:delete', (ev, id) => {
    const result = store.deleteRole(id)
    const s = store.readSettings()
    if (result.ok && s.roleId === id) store.writeSettings({ roleId: 'default' })
    broadcastSettings()
    broadcastRoles()
    return Object.assign({}, result, { roles: roleList() })
  })

  // ---- photo cutout -------------------------------------------------------
  ipcMain.on('cutout:open', openCutout)
  ipcMain.on('cutout:close', () => { if (cutoutWin) cutoutWin.close() })

  ipcMain.handle('cutout:pick', async () => {
    const result = await dialog.showOpenDialog(cutoutWin || settingsWin || petWin, {
      title: '挑一张人像照片',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    })
    if (result.canceled || !result.filePaths || !result.filePaths[0]) return { ok: false, canceled: true }
    const file = result.filePaths[0]
    let stat
    try { stat = fs.statSync(file) } catch (err) { return { ok: false, error: '找不到这个文件' } }
    if (stat.size > MAX_IMAGE_BYTES) return { ok: false, error: '图片超过 25MB 啦，先压缩一下好吗' }
    const image = nativeImage.createFromBuffer(fs.readFileSync(file))
    if (image.isEmpty()) return { ok: false, error: '这张图打不开呢' }
    const name = path.basename(file).replace(/\.[^.]+$/, '').slice(0, 30)
    return Object.assign({ ok: true }, cutoutInputPayload(image, name))
  })

  // Drag & drop: the file already lives in the renderer, so it arrives once and
  // is replaced by a token for every later call.
  ipcMain.handle('cutout:load', (ev, payload) => {
    let decoded
    try { decoded = decodeImageDataUrl(payload && payload.dataUrl) } catch (err) {
      return { ok: false, error: err.message }
    }
    const image = nativeImage.createFromBuffer(decoded.buffer)
    if (image.isEmpty()) return { ok: false, error: '这张图打不开呢' }
    return Object.assign({ ok: true }, cutoutInputPayload(image, payload && payload.name))
  })

  ipcMain.handle('cutout:run', async (ev, payload) => {
    const startedAt = Date.now()
    let image = null
    const token = payload && typeof payload.token === 'string' ? payload.token : ''
    if (token && cutoutInputs.has(token)) {
      image = cutoutInputs.get(token).image
    } else if (payload && payload.dataUrl) {
      // Back-compat: an older renderer still hands over the base64 image.
      let decoded
      try { decoded = decodeImageDataUrl(payload.dataUrl) } catch (err) {
        cutoutTrace({ ok: false, mode: 'none', code: 'BAD_IMAGE', ms: Date.now() - startedAt, error: err.message })
        return { ok: false, mode: 'none', code: 'BAD_IMAGE', error: err.message }
      }
      image = nativeImage.createFromBuffer(decoded.buffer)
    } else {
      cutoutTrace({ ok: false, mode: 'none', code: 'BAD_IMAGE', ms: Date.now() - startedAt, error: '还没拿到照片' })
      return { ok: false, mode: 'none', code: 'BAD_IMAGE', error: '照片没拿到，重新选一张吧' }
    }
    if (!image || image.isEmpty()) {
      cutoutTrace({ ok: false, mode: 'none', code: 'BAD_IMAGE', ms: Date.now() - startedAt })
      return { ok: false, mode: 'none', code: 'BAD_IMAGE', error: '这张图打不开呢' }
    }
    const inputSize = image.getSize()
    try {
      const result = await runCutoutDecoded(image, { canvas: 610 })
      const dataUrl = 'data:image/png;base64,' + result.png.toString('base64')
      cutoutTrace({
        ok: true,
        mode: 'cutout',
        code: null,
        input: inputSize,
        working: result.working,
        shape: [1, 1, 320, 320],
        output: [610, 610],
        coverage: result.coverage,
        bands: result.bands,
        cutout: result.cutout,
        preprocess: result.preprocess,
        timings: result.timings,
        ms: Date.now() - startedAt,
      })
      return {
        ok: true,
        mode: 'cutout',
        dataUrl,
        maskDataUrl: 'data:image/png;base64,' + result.maskPng.toString('base64'),
        preprocess: result.preprocess,
        width: 610,
        height: 610,
        coverage: result.coverage,
        cutout: result.cutout,
        source: result.source,
        bands: result.bands,
        ms: result.ms,
      }
    } catch (err) {
      const code = (err && err.code) || 'CUTOUT_FAILED'
      // Fallback keeps the app usable, but it is explicitly labelled: the
      // renderer must show "整张照片" and ask for a second confirmation
      // before it can be saved as a role.
      const fallback = cutout.scaleOnly(image, 610)
      const fallbackSize = fallback.getSize()
      cutoutTrace({
        ok: false,
        mode: 'fallback',
        code,
        input: inputSize,
        coverage: typeof err.coverage === 'number' ? err.coverage : null,
        output: [fallbackSize.width, fallbackSize.height],
        ms: Date.now() - startedAt,
        error: err.message,
      })
      return {
        ok: false,
        mode: 'fallback',
        code,
        error: cutoutErrorMessage(code),
        fallbackDataUrl: 'data:image/png;base64,' + fallback.toPNG().toString('base64'),
        width: fallbackSize.width,
        height: fallbackSize.height,
      }
    }
  })

  ipcMain.handle('cutout:save', (ev, payload) => {
    let decoded
    try { decoded = decodeImageDataUrl(payload && payload.dataUrl) } catch (err) {
      return { ok: false, error: err.message }
    }
    const image = nativeImage.createFromBuffer(decoded.buffer)
    if (image.isEmpty()) return { ok: false, error: '生成的角色图打不开呢' }
    const mode = payload && payload.mode === 'fallback' ? 'fallback' : 'cutout'
    if (mode === 'fallback' && (!payload || payload.confirmFallback !== true)) {
      return { ok: false, code: 'FALLBACK_UNCONFIRMED', error: '要用整张照片当角色的话，得再确认一次' }
    }
    const send = cutout.scaleOnly(image, 610)
    const name = String((payload && payload.name) || '照片角色').trim().slice(0, 30) || '照片角色'
    const entry = store.addRole(name, send.toPNG(), { cutout: mode === 'cutout', mode })
    store.writeSettings({ roleId: entry.id })
    broadcastSettings()
    broadcastRoles()
    return { ok: true, role: entry, roles: roleList() }
  })

  ipcMain.handle('weather:get', () => weather)

  ipcMain.handle('sounds:list', () => soundList())

  ipcMain.handle('sounds:import', async () => {
    const result = await dialog.showOpenDialog(settingsWin || petWin, {
      title: '添加一段音频',
      properties: ['openFile'],
      filters: [{ name: '音频', extensions: ['wav', 'mp3', 'ogg', 'm4a', 'flac'] }],
    })
    if (result.canceled || !result.filePaths || !result.filePaths[0]) return { ok: false, canceled: true }
    const file = result.filePaths[0]
    try {
      const bytes = fs.readFileSync(file)
      if (bytes.length > 8 * 1024 * 1024) return { ok: false, error: '音频超过 8MB 啦，换一段短一点的吧' }
      const ext = path.extname(file).replace('.', '').toLowerCase() || 'wav'
      const name = path.basename(file).replace(/\.[^.]+$/, '').slice(0, 30)
      const entry = store.addSound(name, ext, bytes)
      return { ok: true, file: entry, files: soundList() }
    } catch (err) {
      return { ok: false, error: String(err.message || err) }
    }
  })

  ipcMain.handle('sounds:delete', (ev, id) => {
    const deleted = store.deleteSound(id)
    if (deleted.ok) {
      const s = store.readSettings()
      const events = (s.sound && s.sound.events) || {}
      let touched = false
      for (const key of Object.keys(events)) {
        if (events[key] && events[key].fragment === 'file:' + id) {
          events[key] = Object.assign({}, events[key], { fragment: 'preset:ding' })
          touched = true
        }
      }
      if (touched) {
        const next = store.writeSettings({ sound: Object.assign({}, s.sound, { events }) })
        applySettingsSideEffects(s, next)
        broadcastSettings()
      }
    }
    return Object.assign({}, deleted, { files: soundList() })
  })

  ipcMain.handle('weather:refresh', () => refreshWeather('manual'))
  ipcMain.handle('geocode', async (ev, q) => {
    try { return { ok: true, list: await geocode(q) } }
    catch (err) { return { ok: false, error: String(err.message || err), list: [] } }
  })

  ipcMain.on('pet:drag', (ev, delta) => {
    if (!petWin || !delta) return
    // Opt-in diagnostic: count how many window moves a drag actually performs
    // (the renderer coalesces them to one per animation frame).
    if (process.env.DESKPET_TRACE_DRAG === '1') log('pet-drag', Math.round(Number(delta.dx) || 0), Math.round(Number(delta.dy) || 0))
    const s = store.readSettings()
    const b = petWin.getBounds()
    const size = clamp(Number(s.size) || 220, 80, 480)
    const pet = placement.petRectOf({ x: b.x, y: petTopLeft().y }, size, WIN_PAD)
    pet.x += Math.round(Number(delta.dx) || 0)
    pet.y += Math.round(Number(delta.dy) || 0)

    const displays = getDisplays()
    const display = placement.displayForRect(displays, pet)
    if (!display) return
    let next = placement.clampPet(pet, display.workArea)
    if (s.snap && s.snap.enabled) next = placement.snapPet(next, display.workArea, s.snap.gap)
    // 0.6.2: never drag the pet closer to the top than the reserved bubble strip.
    const maxTop = display.workArea.y + Math.max(0, display.workArea.height - size)
    const floorTop = Math.min(maxTop, display.workArea.y + extraBubbleHeight)
    if (next.y < floorTop) next = { ...next, y: floorTop }

    const extra = Math.max(0, b.height - size)
    // Window top = pet top - reserved bubble space (above) or exactly the pet
    // top (below), so dragging with a bubble open does not make the pet sink.
    petPos = { x: next.x, y: next.y }
    petWin.setBounds(windowBoundsForPet(next.x, next.y, size, extra))
    sendMirror()
  })

  ipcMain.on('pet:drag-end', () => {
    if (!petWin) return
    const s = store.readSettings()
    const size = clamp(Number(s.size) || 220, 80, 480)
    const pos = petTopLeft()
    const display = placement.displayAt(getDisplays(), { x: pos.x + size / 2, y: pos.y + size / 2 })
    store.writeSettings({ position: { x: pos.x, y: pos.y, displayId: display ? display.id : null } })
    sendMirror()
  })

  // 0.6.2: interactivity is decided in the main process from the cursor
  // position and the rects the renderer reports. Renderer `mousemove` is not
  // reliable enough: the very first move after switching to click-through can
  // be swallowed, which made the pet unclickable until the pointer left and
  // came back.
  ipcMain.on('pet:rects', (ev, rects) => {
    hitRects = Array.isArray(rects) ? rects.slice(0, 12) : []
    if (process.env.DESKPET_TRACE_HIT === '1') log('hit-rects', JSON.stringify(hitRects))
    updatePetInteractive()
  })
  ipcMain.on('pet:dragging', (ev, on) => {
    petDragging = !!on
    updatePetInteractive()
  })

  ipcMain.handle('pet:bubble', (ev, payload) => {
    return applyBubbleHeight(!!(payload && payload.visible), payload && payload.height)
  })

  ipcMain.on('pet:hide', () => { if (petWin) petWin.hide() })
  ipcMain.on('pet:open-settings', openSettings)
  ipcMain.on('pet:open-editor', openEditor)
  ipcMain.on('onboard:open', () => openOnboard(true))
  ipcMain.on('onboard:dismiss', dismissOnboard)
  ipcMain.on('pet:water-done', () => {
    const s = store.readSettings()
    const today = new Date()
    const key = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate()
    const cups = s.water.today && s.water.today.date === key ? Number(s.water.today.cups) + 1 : 1
    store.writeSettings({ water: { lastDrinkAt: Date.now(), today: { date: key, cups } } })
  })

  ipcMain.on('app:quit', () => { quitting = true; app.quit() })
  ipcMain.handle('app:open-data-dir', () => shell.openPath(store.dir))
  ipcMain.handle('app:diagnostics', () => exportDiagnostics())
}

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
setLogFile(app.isPackaged ? path.join(DATA_DIR, 'app.log') : path.join(__dirname, '..', 'app.log'))
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
    registerIpc()
    log('store=' + store.dir)
    createPetWindow()
    createTray()
    registerGlobalShortcut()
    log('windows created pet=' + (petWin ? 'yes' : 'no') + ' tray=' + (tray ? 'yes' : 'no') + ' shortcut=' + shortcutStatus.ok)
    refreshWeather('boot')
    scheduleWeather()
    startReminders()
    if (process.env.DESKPET_OPEN_SETTINGS === '1') setTimeout(openSettings, 800)
    if (process.env.DESKPET_OPEN_EDITOR === '1') setTimeout(openEditor, 800)
    // M17 P0-1: first run gets the three-step card (once). Existing installs
    // that never dismissed it yet see it once too; after that `onboarded` is
    // true and the only way back in is 设置 → 其他 → 再看一次欢迎引导.
    if (process.env.DESKPET_OPEN_ONBOARD === '1') setTimeout(() => openOnboard(true), 800)
    else if (process.env.DESKPET_NO_ONBOARD !== '1' && store.readSettings().onboarded !== true) {
      setTimeout(() => openOnboard(false), 1400)
    }
    screen.on('display-removed', ensureOnScreen)
    screen.on('display-added', ensureOnScreen)
    screen.on('display-metrics-changed', ensureOnScreen)
  }).catch((err) => log('whenReady failed', (err && err.stack) || String(err)))

  app.on('before-quit', () => { quitting = true; stopCutoutWorker(); try { globalShortcut.unregisterAll() } catch (err) {} })
  app.on('window-all-closed', () => { /* keep running in the tray */ })
}
