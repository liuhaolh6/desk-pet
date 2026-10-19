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
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),

  // characters
  listRoles: () => ipcRenderer.invoke('roles:list'),
  importRole: () => ipcRenderer.invoke('roles:import'),
  deleteRole: (id) => ipcRenderer.invoke('roles:delete', id),

  // weather
  getWeather: () => ipcRenderer.invoke('weather:get'),
  refreshWeather: () => ipcRenderer.invoke('weather:refresh'),
  geocode: (q) => ipcRenderer.invoke('geocode', q),

  // window behaviour
  drag: (point) => ipcRenderer.send('pet:drag', point),
  dragEnd: () => ipcRenderer.send('pet:drag-end'),
  setBubble: (visible, height) => ipcRenderer.send('pet:bubble', { visible: !!visible, height: height || 0 }),
  showMenu: () => ipcRenderer.send('pet:menu'),
  openSettings: () => ipcRenderer.send('pet:open-settings'),
  drinkDone: () => ipcRenderer.send('pet:water-done'),
  openDataDir: () => ipcRenderer.invoke('app:open-data-dir'),
  quit: () => ipcRenderer.send('app:quit'),

  // events
  onSettings: (cb) => subscribe('settings:changed', cb),
  onWeather: (cb) => subscribe('weather:changed', cb),
  onRemind: (cb) => subscribe('remind:water', cb),

  platform: process.platform,
})
