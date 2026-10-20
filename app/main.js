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
  nativeImage, Notification, protocol, shell,
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
    petWin.setBounds({
      x: clamped.x - WIN_PAD,
      y: clamped.y - extra,
      width: windowWidth(size),
      height: size + extra,
    })
    sendMirror()
  }
}

function petTopLeft() {
  if (!petWin) return { x: 0, y: 0 }
  const b = petWin.getBounds()
  const s = store.readSettings()
  const size = clamp(Number(s.size) || 220, 80, 480)
  // The pet always sits at the bottom of the window, so its top can be derived
  // from the window bottom regardless of how much bubble space is reserved.
  return { x: b.x, y: b.y + b.height - size }
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

/** Grow/shrink the window upward so the pet's bottom edge stays put. */
function applyBubbleHeight(visible, height) {
  if (!petWin) return
  const s = store.readSettings()
  const size = clamp(Number(s.size) || 220, 80, 480)
  const target = visible ? clamp(Math.round(Number(height) || 0), 0, 420) : 0
  // Treat sub-card heights as "no bubble": they are invisible leftovers that
  // otherwise leave a few pixels of reserved space (and shift drag maths).
  const normalized = target < 40 ? 0 : target
  if (normalized === extraBubbleHeight) return
  const b = petWin.getBounds()
  const bottom = b.y + b.height
  extraBubbleHeight = normalized
  const nextH = size + normalized
  const display = screen.getDisplayNearestPoint({
    x: b.x + Math.floor(b.width / 2),
    y: bottom - Math.floor(nextH / 2),
  })
  const y = Math.max(display.workArea.y, bottom - nextH)
  petWin.setBounds({ x: b.x, y, width: windowWidth(size), height: nextH })
  sendMirror()
}

function applySettingsSideEffects(prev, next) {
  if (!petWin) return
  const size = clamp(Number(next.size) || 220, 80, 480)
  const g = petWin.getBounds()
  if (windowWidth(size) !== g.width) {
    const bottom = g.y + g.height
    petWin.setBounds({ x: g.x, y: bottom - (size + extraBubbleHeight), width: windowWidth(size), height: size + extraBubbleHeight })
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
    height: 660,
    minWidth: 680,
    minHeight: 560,
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
  cutoutWin.on('closed', () => { cutoutWin = null })
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
function decodeImageDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') throw new Error('缺少图片数据')
  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=\s]+)$/i)
  if (!match) throw new Error('图片格式不支持')
  const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64')
  if (!buffer.length) throw new Error('图片为空')
  if (buffer.length > 30 * 1024 * 1024) throw new Error('图片超过 30MB')
  return { buffer, mime: match[1].toLowerCase() }
}

function roleList() {
  const index = store.readRoles()
  return index.roles.map((r) => ({
    id: r.id,
    name: r.name || r.id,
    builtin: !!r.builtin,
    url: roleUrl(r.id),
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
    if (stat.size > 25 * 1024 * 1024) return { ok: false, error: '图片超过 25MB，请先压缩' }
    const buffer = fs.readFileSync(file)
    const image = nativeImage.createFromBuffer(buffer)
    if (image.isEmpty()) return { ok: false, error: '读不出图片' }
    const ext = path.extname(file).toLowerCase()
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
    return {
      ok: true,
      dataUrl: 'data:' + mime + ';base64,' + buffer.toString('base64'),
      name: path.basename(file).replace(/\.[^.]+$/, '').slice(0, 30),
      width: image.getSize().width,
      height: image.getSize().height,
    }
  })

  ipcMain.handle('cutout:run', async (ev, payload) => {
    let decoded
    try { decoded = decodeImageDataUrl(payload && payload.dataUrl) } catch (err) {
      return { ok: false, code: 'BAD_IMAGE', error: err.message }
    }
    const image = nativeImage.createFromBuffer(decoded.buffer)
    if (image.isEmpty()) return { ok: false, code: 'BAD_IMAGE', error: '读不出图片' }
    try {
      const result = await cutout.cutoutImage(nativeImage, image, { canvas: 610 })
      return {
        ok: true,
        dataUrl: 'data:image/png;base64,' + result.image.toPNG().toString('base64'),
        width: 610,
        height: 610,
        coverage: result.coverage,
        cutout: result.cutout,
        source: result.source,
      }
    } catch (err) {
      const code = (err && err.code) || 'CUTOUT_FAILED'
      const fallback = cutout.scaleOnly(image, 610)
      const fallbackSize = fallback.getSize()
      return {
        ok: false,
        code,
        error: code === 'NO_PERSON'
          ? '没有检测到清晰人像，可以改用“仅缩放导入”'
          : code === 'MODEL_MISSING' || code === 'MODEL_LOAD_FAILED'
            ? '离线抠图模型未就绪，可以改用“仅缩放导入”'
            : '抠图失败，可以改用“仅缩放导入”',
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
    const send = cutout.scaleOnly(image, 610)
    const name = String((payload && payload.name) || '照片角色').trim().slice(0, 30) || '照片角色'
    const entry = store.addRole(name, send.toPNG())
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
    // Window top = pet top - reserved bubble space, so dragging with a bubble
    // open does not make the pet sink by `extra` on every move.
    petWin.setBounds({
      x: next.x - WIN_PAD,
      y: next.y - extra,
      width: windowWidth(size),
      height: size + extra,
    })
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

  ipcMain.on('pet:bubble', (ev, payload) => {
    applyBubbleHeight(!!(payload && payload.visible), payload && payload.height)
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

  app.on('before-quit', () => { quitting = true })
  app.on('window-all-closed', () => { /* keep running in the tray */ })
}
