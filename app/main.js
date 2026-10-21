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
  nativeImage, Notification, protocol, shell, utilityProcess,
} = require('electron')

const { createStore } = require('../lib/store')
const { fetchWeather, geocode } = require('../lib/weather')
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
let tray = null
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
  // The saved/window x already excludes the window padding; the pet never has a
  // bubble reserve at startup, so the pet's top equals the window's top.
  petPos = { x: pos.x + WIN_PAD, y: pos.y }
  bubbleSide = 'above'
  extraBubbleHeight = 0

  const opaque = process.env.DESKPET_OPAQUE === '1'
  petWin = new BrowserWindow({
    x: pos.x,
    y: pos.y,
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
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  })

  petWin.setAlwaysOnTop(!!s.alwaysOnTop, 'screen-saver')
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
  const cardHeight = requested < 40 ? 0 : requested
  const want = visible ? cardHeight : 0

  const b = petWin.getBounds()
  const pet = petScreenRect(size)
  const display = screen.getDisplayNearestPoint({
    x: b.x + Math.floor(b.width / 2),
    y: pet.bottom - Math.floor(size / 2),
  })
  const work = display.workArea
  const roomAbove = Math.max(0, pet.top - work.y)
  const roomBelow = Math.max(0, work.y + work.height - pet.bottom)

  let side = bubbleSide
  let reserve = want
  // While a bubble/menu chain is visible, only grow (per side): shrinking between
  // two cards of different heights resizes the transparent window again, and every
  // resize can flash. The shrink happens once, on hide.
  if (want > 0 && bubbleSide === 'below' && want <= extraBubbleHeight) {
    reserve = extraBubbleHeight
  } else if (want > 0 && bubbleSide === 'above' && want <= extraBubbleHeight && want <= roomAbove) {
    reserve = extraBubbleHeight
  } else if (want <= roomAbove) {
    side = 'above'
    reserve = want
  } else if (want <= roomBelow) {
    side = 'below'
    reserve = want
  } else if (roomBelow > roomAbove) {
    side = 'below'
    reserve = roomBelow
  } else {
    side = 'above'
    reserve = roomAbove
  }
  reserve = Math.max(0, Math.min(Math.round(reserve), 420))

  const nextH = size + reserve
  const y = side === 'below' ? pet.top : pet.bottom - nextH
  const changed = side !== bubbleSide || reserve !== extraBubbleHeight || b.height !== nextH || b.y !== y
  bubbleSide = side
  extraBubbleHeight = reserve
  if (changed) {
    // Re-assert transparency right before the bounds change: the newly exposed
    // strip can otherwise be composited with the window background for a frame.
    if (process.env.DESKPET_OPAQUE !== '1') {
      try { petWin.setBackgroundColor('#00000000') } catch (err) {}
    }
    petWin.setBounds({ x: b.x, y, width: windowWidth(size), height: nextH }, false)
    sendMirror()
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
    title: '气泡编辑器',
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
    title: '从照片生成角色',
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
    weather = { ok: false, error: 'NO_LOCATION', message: '还没设置城市' }
    sendWeather()
    return weather
  }
  try {
    weather = await fetchWeather({ lat: w.lat, lon: w.lon, city: w.city, label: w.label })
    store.writeWeatherCache({ key: w.lat + ',' + w.lon, at: Date.now(), value: weather })
  } catch (err) {
    const cache = store.readWeatherCache()
    if (cache && cache.value) weather = Object.assign({}, cache.value, { stale: true, error: String(err.message || err) })
    else weather = { ok: false, error: 'FETCH_FAILED', message: String(err.message || err) }
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
        new Notification({ title: s.name || '桌宠', body: '该喝水啦～' }).show()
      } catch (err) {}
    }
  }, 60000)
}

// ----------------------------------------------------------------------- tray
function createTray() {
  let iconPath = path.join(ASSETS, 'tray.png')
  if (!fs.existsSync(iconPath)) iconPath = path.join(ASSETS, 'icon.png')
  let image = nativeImage.createFromPath(iconPath)
  if (image.isEmpty()) image = nativeImage.createEmpty()
  tray = new Tray(image)
  const s = store.readSettings()
  tray.setToolTip(s.name + ' · 桌宠')
  const menu = Menu.buildFromTemplate([
    { label: '显示 / 隐藏', click: () => { if (!petWin) createPetWindow(); else if (petWin.isVisible()) petWin.hide(); else petWin.show() } },
    { label: '设置…', click: openSettings },
    { label: '编辑气泡…', click: openEditor },
    { label: '刷新天气', click: () => refreshWeather('tray') },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit() } },
  ])
  tray.setContextMenu(menu)
  tray.on('click', () => { if (!petWin) createPetWindow(); else if (petWin.isVisible()) petWin.hide(); else petWin.show() })
  log('tray created empty=' + image.isEmpty() + ' icon=' + iconPath + ' menu=' + menu.items.map((i) => i.label || i.type).join('|'))
  try { log('tray bounds=' + JSON.stringify(tray.getBounds())) } catch (err) { log('tray bounds unavailable', String(err)) }
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
  if (typeof dataUrl !== 'string') throw new Error('缺少图片数据')
  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=\s]+)$/i)
  if (!match) throw new Error('图片格式不支持')
  const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64')
  if (!buffer.length) throw new Error('图片为空')
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error('图片超过 25MB，请先压缩')
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
  if (code === 'NO_PERSON') return '没有检测到清晰人像'
  if (code === 'OVER_SEGMENTED') return '主体覆盖画面过多，可能把背景当成了人像'
  if (code === 'MODEL_MISSING' || code === 'MODEL_LOAD_FAILED') return '离线抠图模型未就绪'
  if (code === 'BAD_OUTPUT_SHAPE' || code === 'NO_OUTPUT') return '模型输出异常'
  return '抠图失败'
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

function registerIpc() {
  ipcMain.handle('state:get', () => ({
    settings: store.readSettings(),
    roles: roleList(),
    weather,
    version: VERSION,
    dataDir: store.dir,
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
      title: '选择角色图片',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    })
    if (result.canceled || !result.filePaths || !result.filePaths[0]) return { ok: false, canceled: true }
    const file = result.filePaths[0]
    let image = nativeImage.createFromPath(file)
    if (image.isEmpty()) return { ok: false, error: '读不出图片' }
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
      title: '选择一张人像照片',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    })
    if (result.canceled || !result.filePaths || !result.filePaths[0]) return { ok: false, canceled: true }
    const file = result.filePaths[0]
    let stat
    try { stat = fs.statSync(file) } catch (err) { return { ok: false, error: '读不到文件' } }
    if (stat.size > MAX_IMAGE_BYTES) return { ok: false, error: '图片超过 25MB，请先压缩' }
    const image = nativeImage.createFromBuffer(fs.readFileSync(file))
    if (image.isEmpty()) return { ok: false, error: '读不出图片' }
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
    if (image.isEmpty()) return { ok: false, error: '读不出图片' }
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
      cutoutTrace({ ok: false, mode: 'none', code: 'BAD_IMAGE', ms: Date.now() - startedAt, error: '缺少照片' })
      return { ok: false, mode: 'none', code: 'BAD_IMAGE', error: '缺少照片，请重新选择' }
    }
    if (!image || image.isEmpty()) {
      cutoutTrace({ ok: false, mode: 'none', code: 'BAD_IMAGE', ms: Date.now() - startedAt })
      return { ok: false, mode: 'none', code: 'BAD_IMAGE', error: '读不出图片' }
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
      // renderer must show "未抠图（整图）" and ask for a second confirmation
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
    if (image.isEmpty()) return { ok: false, error: '读不出生成的角色图' }
    const mode = payload && payload.mode === 'fallback' ? 'fallback' : 'cutout'
    if (mode === 'fallback' && (!payload || payload.confirmFallback !== true)) {
      return { ok: false, code: 'FALLBACK_UNCONFIRMED', error: '整图回退需要二次确认后才能保存' }
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
      title: '导入音频片段',
      properties: ['openFile'],
      filters: [{ name: '音频', extensions: ['wav', 'mp3', 'ogg', 'm4a', 'flac'] }],
    })
    if (result.canceled || !result.filePaths || !result.filePaths[0]) return { ok: false, canceled: true }
    const file = result.filePaths[0]
    try {
      const bytes = fs.readFileSync(file)
      if (bytes.length > 8 * 1024 * 1024) return { ok: false, error: '音频超过 8MB' }
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

  ipcMain.handle('pet:bubble', (ev, payload) => {
    return applyBubbleHeight(!!(payload && payload.visible), payload && payload.height)
  })

  ipcMain.on('pet:hide', () => { if (petWin) petWin.hide() })
  ipcMain.on('pet:open-settings', openSettings)
  ipcMain.on('pet:open-editor', openEditor)
  ipcMain.on('pet:water-done', () => {
    const s = store.readSettings()
    const today = new Date()
    const key = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate()
    const cups = s.water.today && s.water.today.date === key ? Number(s.water.today.cups) + 1 : 1
    store.writeSettings({ water: { lastDrinkAt: Date.now(), today: { date: key, cups } } })
  })

  ipcMain.on('app:quit', () => { quitting = true; app.quit() })
  ipcMain.handle('app:open-data-dir', () => shell.openPath(store.dir))
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
    log('windows created pet=' + (petWin ? 'yes' : 'no') + ' tray=' + (tray ? 'yes' : 'no'))
    refreshWeather('boot')
    scheduleWeather()
    startReminders()
    if (process.env.DESKPET_OPEN_SETTINGS === '1') setTimeout(openSettings, 800)
    if (process.env.DESKPET_OPEN_EDITOR === '1') setTimeout(openEditor, 800)
    screen.on('display-removed', ensureOnScreen)
    screen.on('display-added', ensureOnScreen)
    screen.on('display-metrics-changed', ensureOnScreen)
  }).catch((err) => log('whenReady failed', (err && err.stack) || String(err)))

  app.on('before-quit', () => { quitting = true; stopCutoutWorker() })
  app.on('window-all-closed', () => { /* keep running in the tray */ })
}
