/**
 * desk-pet —— Electron main process.
 *
 * A frameless, transparent, always-on-top window that holds the pet sprite.
 * The window grows upward when a speech bubble is visible so the transparent
 * area never swallows clicks meant for the desktop.
 */
'use strict'

const path = require('node:path')
const fs = require('node:fs')
const {
  app, BrowserWindow, Tray, Menu, ipcMain, screen, dialog,
  nativeImage, Notification, protocol, shell,
} = require('electron')

const { createStore } = require('../lib/store')
const { fetchWeather, geocode } = require('../lib/weather')

const VERSION = require('../package.json').version
const ASSETS = path.join(__dirname, '..', 'assets')
const LOG_FILE = path.join(__dirname, '..', 'app.log')

function log() {
  try {
    const line = new Date().toISOString() + ' ' + Array.prototype.join.call(arguments, ' ') + '\n'
    fs.appendFileSync(LOG_FILE, line)
  } catch (err) {}
}

process.on('uncaughtException', (err) => log('uncaught', (err && err.stack) || String(err)))
process.on('unhandledRejection', (err) => log('unhandledRejection', (err && err.stack) || String(err)))
log('boot electron=' + process.versions.electron + ' argv=' + process.argv.join(' '))

let store = null
let petWin = null
let settingsWin = null
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
])
log('schemes registered')

function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)) }

function defaultPosition(size) {
  const display = screen.getPrimaryDisplay()
  const area = display.workArea
  return {
    x: area.x + area.width - size - 24,
    y: area.y + area.height - size - 24,
  }
}

function petTopLeft() {
  if (!petWin) return { x: 0, y: 0 }
  const b = petWin.getBounds()
  return { x: b.x, y: b.y + extraBubbleHeight }
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

// ----------------------------------------------------------------- pet window
function createPetWindow() {
  const s = store.readSettings()
  const size = clamp(Number(s.size) || 220, 80, 480)
  const pos = s.position && Number.isFinite(s.position.x) ? s.position : defaultPosition(size)

  const opaque = process.env.DESKPET_OPAQUE === '1'
  petWin = new BrowserWindow({
    x: pos.x,
    y: pos.y,
    width: size,
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
  })
}

/** Grow/shrink the window upward so the pet's bottom edge stays put. */
function applyBubbleHeight(visible, height) {
  if (!petWin) return
  const s = store.readSettings()
  const size = clamp(Number(s.size) || 220, 80, 480)
  const target = visible ? clamp(Math.round(Number(height) || 0), 0, 420) : 0
  if (target === extraBubbleHeight) return
  const b = petWin.getBounds()
  const bottom = b.y + b.height
  extraBubbleHeight = target
  const nextH = size + target
  const display = screen.getDisplayNearestPoint({
    x: b.x + Math.floor(b.width / 2),
    y: bottom - Math.floor(nextH / 2),
  })
  const y = Math.max(display.workArea.y, bottom - nextH)
  petWin.setBounds({ x: b.x, y, width: size, height: nextH })
}

function applySettingsSideEffects(prev, next) {
  if (!petWin) return
  const size = clamp(Number(next.size) || 220, 80, 480)
  const g = petWin.getBounds()
  if (size !== g.width) {
    const bottom = g.y + g.height
    petWin.setBounds({ x: g.x, y: bottom - (size + extraBubbleHeight), width: size, height: size + extraBubbleHeight })
  }
  if (!prev || prev.alwaysOnTop !== next.alwaysOnTop) {
    petWin.setAlwaysOnTop(!!next.alwaysOnTop, 'screen-saver')
  }
  if (prev && prev.autostart !== next.autostart) {
    try {
      app.setLoginItemSettings({ openAtLogin: !!next.autostart, path: process.execPath, args: [] })
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

function broadcastSettings() {
  const settings = store.readSettings()
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('settings:changed', settings)
  }
  if (tray) tray.setToolTip(settings.name + ' · 桌宠')
  return settings
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
    { label: '刷新天气', click: () => refreshWeather('tray') },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit() } },
  ])
  tray.setContextMenu(menu)
  tray.on('click', () => { if (!petWin) createPetWindow(); else if (petWin.isVisible()) petWin.hide(); else petWin.show() })
}

// ---------------------------------------------------------------------- menu
function showPetMenu() {
  if (!petWin) return
  const s = store.readSettings()
  const menu = Menu.buildFromTemplate([
    { label: s.name || '桌宠', enabled: false },
    { type: 'separator' },
    { label: '设置…', click: openSettings },
    { label: '刷新天气', click: () => refreshWeather('menu') },
    { label: s.alwaysOnTop ? '取消置顶' : '置顶显示', click: () => { store.writeSettings({ alwaysOnTop: !s.alwaysOnTop }); applySettingsSideEffects(s, store.readSettings()); broadcastSettings() } },
    { label: '隐藏桌宠', click: () => petWin.hide() },
    { type: 'separator' },
    { label: '打开数据目录', click: () => shell.openPath(store.dir) },
    { label: '退出', click: () => { quitting = true; app.quit() } },
  ])
  menu.popup({ window: petWin })
}

// ----------------------------------------------------------------------- IPC
function roleList() {
  const index = store.readRoles()
  return index.roles.map((r) => ({
    id: r.id,
    name: r.name || r.id,
    builtin: !!r.builtin,
    url: roleUrl(r.id),
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
    return { ok: true, role: entry, roles: roleList() }
  })

  ipcMain.handle('roles:delete', (ev, id) => {
    const result = store.deleteRole(id)
    const s = store.readSettings()
    if (result.ok && s.roleId === id) store.writeSettings({ roleId: 'default' })
    broadcastSettings()
    return Object.assign({}, result, { roles: roleList() })
  })

  ipcMain.handle('weather:get', () => weather)
  ipcMain.handle('weather:refresh', () => refreshWeather('manual'))
  ipcMain.handle('geocode', async (ev, q) => {
    try { return { ok: true, list: await geocode(q) } }
    catch (err) { return { ok: false, error: String(err.message || err), list: [] } }
  })

  ipcMain.on('pet:drag', (ev, delta) => {
    if (!petWin || !delta) return
    const b = petWin.getBounds()
    const display = screen.getDisplayNearestPoint({
      x: b.x + Math.floor(b.width / 2),
      y: b.y + Math.floor(b.height / 2),
    })
    const area = display.workArea
    const x = clamp(b.x + Math.round(Number(delta.dx) || 0), area.x, area.x + area.width - b.width)
    const y = clamp(b.y + Math.round(Number(delta.dy) || 0), area.y, area.y + area.height - b.height)
    petWin.setPosition(x, y)
  })

  ipcMain.on('pet:drag-end', () => {
    if (!petWin) return
    const pos = petTopLeft()
    store.writeSettings({ position: { x: pos.x, y: pos.y } })
  })

  ipcMain.on('pet:bubble', (ev, payload) => {
    applyBubbleHeight(!!(payload && payload.visible), payload && payload.height)
  })

  ipcMain.on('pet:menu', showPetMenu)
  ipcMain.on('pet:open-settings', openSettings)
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
// Allow the data directory to be overridden (portable installs, tests, or a
// locked-down environment where %APPDATA% is not writable).
if (process.env.DESKPET_DATA_DIR) {
  try { app.setPath('userData', path.resolve(process.env.DESKPET_DATA_DIR)) } catch (err) { log('setPath failed', String(err)) }
}
log('userData=' + app.getPath('userData'))
let hasLock = false
try { hasLock = app.requestSingleInstanceLock() } catch (err) { log('lock threw', (err && err.stack) || String(err)) }
log('lock=' + hasLock)
if (!hasLock) {
  log('single instance lock denied')
  app.quit()
} else {
  log('single instance lock acquired')
  app.on('second-instance', () => {
    if (petWin) { petWin.show(); petWin.focus() }
  })

  app.whenReady().then(() => {
    log('ready')
    app.setAppUserModelId('com.deskpet.app')
    store = createStore(app.getPath('userData'))
    protocol.handle('pet-role', handleRoleProtocol)
    const { session } = require('electron')
    session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
      callback(permission === 'geolocation')
    })
    registerIpc()
    log('store=' + store.dir)
    createPetWindow()
    createTray()
    log('windows created')
    refreshWeather('boot')
    scheduleWeather()
    startReminders()
    if (process.env.DESKPET_OPEN_SETTINGS === '1') setTimeout(openSettings, 800)
  }).catch((err) => log('whenReady failed', (err && err.stack) || String(err)))

  app.on('before-quit', () => { quitting = true })
  app.on('window-all-closed', () => { /* keep running in the tray */ })
}
