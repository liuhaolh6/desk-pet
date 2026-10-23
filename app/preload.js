'use strict'

/**
 * Thin, explicit bridge. The renderer never sees `require`, file paths or IPC
 * channel names it should not know about.
 */
const { contextBridge, ipcRenderer } = require('electron')

const subscriptions = new Map()

function subscribe(channel, callback) {
  if (typeof callback !== 'function') return () => {}
  const handler = (_event, payload) => { try { callback(payload) } catch (err) {} }
  ipcRenderer.on(channel, handler)
  const list = subscriptions.get(channel) || []
  list.push(handler)
  subscriptions.set(channel, list)
  return () => {
    ipcRenderer.removeListener(channel, handler)
    const next = (subscriptions.get(channel) || []).filter((h) => h !== handler)
    subscriptions.set(channel, next)
  }
}

contextBridge.exposeInMainWorld('deskPet', {
  // state
  getState: () => ipcRenderer.invoke('state:get'),
  getAppStatus: () => ipcRenderer.invoke('app:status'),
  exportDiagnostics: () => ipcRenderer.invoke('app:diagnostics'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  getDefaults: () => ipcRenderer.invoke('settings:defaults'),

  // characters
  listRoles: () => ipcRenderer.invoke('roles:list'),
  importRole: () => ipcRenderer.invoke('roles:import'),
  deleteRole: (id) => ipcRenderer.invoke('roles:delete', id),
  openCutout: () => ipcRenderer.send('cutout:open'),
  pickCutoutPhoto: () => ipcRenderer.invoke('cutout:pick'),
  loadCutoutPhoto: (dataUrl, name) => ipcRenderer.invoke('cutout:load', { dataUrl, name }),
  runCutout: (token) => ipcRenderer.invoke('cutout:run', { token }),
  saveCutout: (payload) => ipcRenderer.invoke('cutout:save', payload),
  closeCutout: () => ipcRenderer.send('cutout:close'),

  // sounds
  listSounds: () => ipcRenderer.invoke('sounds:list'),
  importSound: () => ipcRenderer.invoke('sounds:import'),
  deleteSound: (id) => ipcRenderer.invoke('sounds:delete', id),

  // weather
  getWeather: () => ipcRenderer.invoke('weather:get'),
  refreshWeather: () => ipcRenderer.invoke('weather:refresh'),
  geocode: (q) => ipcRenderer.invoke('geocode', q),

  // window behaviour
  drag: (point) => ipcRenderer.send('pet:drag', point),
  dragEnd: () => ipcRenderer.send('pet:drag-end'),
  sendRects: (rects) => ipcRenderer.send('pet:rects', Array.isArray(rects) ? rects : []),
  setDragging: (on) => ipcRenderer.send('pet:dragging', !!on),
  setBubble: (visible, height) => ipcRenderer.invoke('pet:bubble', { visible: !!visible, height: height || 0 }),
  // Reserve-only: resize the bubble strip without claiming a card is visible.
  // A window resize re-measures the strip, and that must not look like a show.
  setReserve: (height) => ipcRenderer.invoke('pet:reserve', height || 0),
  // Hiding is separate from the reserve: the strip stays reserved (no resize),
  // the machine still has to leave the `bubble` state.
  bubbleHidden: () => ipcRenderer.send('pet:bubble-hidden'),
  // P1-2: the hover menu is a renderer overlay, so the main-process state
  // machine learns about it from here (it gates bubble/drag and the reserve).
  setMenu: (open) => ipcRenderer.send('pet:menu', !!open),
  hidePet: () => ipcRenderer.send('pet:hide'),
  openSettings: () => ipcRenderer.send('pet:open-settings'),
  openEditor: () => ipcRenderer.send('pet:open-editor'),
  // First-run welcome card: reopen it on purpose, or close it for good.
  openOnboard: () => ipcRenderer.send('onboard:open'),
  dismissOnboard: () => ipcRenderer.send('onboard:dismiss'),
  drinkDone: () => ipcRenderer.send('pet:water-done'),
  openDataDir: () => ipcRenderer.invoke('app:open-data-dir'),
  quit: () => ipcRenderer.send('app:quit'),

  // events
  onSettings: (cb) => subscribe('settings:changed', cb),
  onRoles: (cb) => subscribe('roles:changed', cb),
  onWeather: (cb) => subscribe('weather:changed', cb),
  onRemind: (cb) => subscribe('remind:water', cb),
  onMirror: (cb) => subscribe('pet:mirror', cb),

  platform: process.platform,
})
