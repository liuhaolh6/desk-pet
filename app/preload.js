'use strict'

/**
 * Thin, explicit bridge. The renderer never sees `require`, file paths or IPC
 * channel names it should not know about.
 */
const { contextBridge, ipcRenderer } = require('electron')

const subscriptions = new Map()

/**
 * P2-6: the bridge's own `t()`.
 *
 * This file runs in the sandboxed preload world, where a bare `require` cannot
 * load our own modules (`app/i18n.js` included), so the three lines that matter
 * — dotted lookup, `{name}` interpolation, missing key → the key — are repeated
 * here. `lib/i18n.js` owns the contract and its unit tests lock the semantics;
 * `tools/smoke.js` asserts this copy matches it.
 *
 * Synchronous on purpose: pages translate their markup before the first paint.
 */
function readBoot() {
  let boot = null
  try { boot = ipcRenderer.sendSync('i18n:boot') } catch (err) { boot = null }
  return (boot && typeof boot === 'object') ? boot : { locale: 'zh-CN', available: ['zh-CN'], dict: {} }
}

function makeI18n() {
  const boot = readBoot()
  const dict = (boot.dict && typeof boot.dict === 'object') ? boot.dict : {}
  function t(key, vars) {
    const raw = Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : key
    if (!vars) return raw
    return String(raw).replace(/\{(\w+)\}/g, (whole, name) => (
      Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole
    ))
  }
  const available = Array.isArray(boot.available) && boot.available.length ? boot.available : [boot.locale || 'zh-CN']
  return {
    locale: boot.locale || 'zh-CN',
    available,
    t,
    has: (key) => Object.prototype.hasOwnProperty.call(dict, key),
    keys: () => Object.keys(dict),
  }
}

const i18n = makeI18n()

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
  getThemes: () => ipcRenderer.invoke('theme:list'),
  getTheme: () => ipcRenderer.invoke('theme:current'),
  setTheme: (id) => ipcRenderer.invoke('theme:set', id),
  importTheme: (file) => ipcRenderer.invoke('theme:import', file),
  exportTheme: (id, file) => ipcRenderer.invoke('theme:export', id, file),
  onThemeChanged: (cb) => ipcRenderer.on('theme:changed', () => cb()),
  getAppStatus: () => ipcRenderer.invoke('app:status'),
  // P2-6：当前语言与合并后的字典。同步 t() 在 preload 里就绪，异步这两个是给
  // 「切换语言要重启」的状态展示用的。
  i18n,
  getI18n: () => ipcRenderer.invoke('i18n:info'),
  getStrings: () => ipcRenderer.invoke('i18n:dict'),
  exportDiagnostics: () => ipcRenderer.invoke('app:diagnostics'),
  // P2-3：更新检查（force=true 由用户点按钮触发）
  // P2-4: what is on disk + wipe the rebuildable junk (never settings/photos).
  privacySummary: () => ipcRenderer.invoke('privacy:summary'),
  privacyCleanup: () => ipcRenderer.invoke('privacy:cleanup'),
  checkUpdate: (force) => ipcRenderer.invoke('update:check', { force: !!force }),
  getUpdateStatus: () => ipcRenderer.invoke('update:status'),
  openUpdate: (url) => ipcRenderer.invoke('update:open', url),
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
  // P1-7 主动说话
  reportActivity: () => ipcRenderer.send('pet:activity'),
  onNudge: (cb) => ipcRenderer.on('pet:nudge', (_ev, data) => cb(data)),
  probeNudge: (opts) => ipcRenderer.invoke('nudge:probe', opts || {}),
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

  // P2-4：气泡画在独立窗口里。桌宠窗口算好卡片 → 这里把"行 + 按钮"送过去。
  renderBubble: (payload) => ipcRenderer.send('bubble:render', payload),
  hideBubbleCard: () => ipcRenderer.send('bubble:hide'),
  onBubbleClick: (cb) => ipcRenderer.on('bubble:click', () => cb()),
  onBubbleAction: (cb) => ipcRenderer.on('bubble:action', (_ev, id) => cb(id)),
  // 气泡窗口侧：收渲染指令，把点击/按钮转发回主进程。
  onOverlayRender: (cb) => ipcRenderer.on('overlay:render', (_ev, payload) => cb(payload)),
  onOverlayClear: (cb) => ipcRenderer.on('overlay:clear', () => cb()),
  onOverlaySide: (cb) => ipcRenderer.on('overlay:side', (_ev, side) => cb(side)),
  overlayClick: () => ipcRenderer.send('overlay:click'),
  overlayAction: (id) => ipcRenderer.send('overlay:action', id),

  hidePet: () => ipcRenderer.send('pet:hide'),
  openSettings: () => ipcRenderer.send('pet:open-settings'),
  openEditor: () => ipcRenderer.send('pet:open-editor'),
  // First-run welcome card: reopen it on purpose, or close it for good.
  openOnboard: () => ipcRenderer.send('onboard:open'),
  dismissOnboard: () => ipcRenderer.send('onboard:dismiss'),
  drinkDone: () => ipcRenderer.send('pet:water-done'),
  // P1-5: 「稍后 10 分钟」and the water log behind the settings panel.
  waterSnooze: (minutes) => ipcRenderer.send('pet:water-snooze', minutes),
  getWaterStats: () => ipcRenderer.invoke('water:stats'),
  exportWaterCsv: () => ipcRenderer.invoke('water:export'),
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
