'use strict'
/**
 * P2-4：气泡/菜单的独立覆盖窗口。
 *
 * 以前气泡画在桌宠窗口里，所以桌宠窗口必须从头到尾预留一条 224px 的透明
 * 气泡带——窗口比桌宠高一倍，拖动、贴边、OBS 采集都要为这条带子让路。
 * 现在气泡有自己的 `transparent` 窗口：桌宠窗口只装桌宠，气泡窗口按气泡
 * 尺寸精确开在它上方，跟着桌宠走。
 *
 * 这个模块只管窗口本身：建、摆、显示/隐藏。内容由渲染层 `overlay.js` 画，
 * 卡片数据由桌宠窗口算好后经 IPC 送过来（见 ipc.js 的 bubble:render）。
 */

const path = require('node:path')
const { clamp, WIN_PAD } = require('./geometry')

const BUBBLE_MIN_W = 220
const BUBBLE_MAX_W = 340
const ASPECT = 700 / 1026
const GAP_ABOVE = 6

/**
 * @param {object} deps
 * @param {object} deps.BrowserWindow
 * @param {object} deps.screen
 * @param {function} deps.store            settings store（读 size/alwaysOnTop）
 * @param {function} deps.getPetWin        返回桌宠窗口或 null
 * @param {function} deps.getLayout        返回 window-layout（取桌宠屏幕矩形）
 * @param {function} deps.log
 */
function createOverlay({ BrowserWindow, screen, store, getPetWin, getLayout, log }) {
  let win = null
  let visible = false
  let side = 'above'
  // 0.6.11：卡片内容装不下时由渲染层请求放大（宽高同比例），每次 show 归 1。
  let growScale = 1

  function create() {
    if (win && !win.isDestroyed()) return win
    const s = store.readSettings()
    win = new BrowserWindow({
      width: 320,
      height: 220,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      focusable: false,
      alwaysOnTop: !!s.alwaysOnTop,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    })
    win.setAlwaysOnTop(!!s.alwaysOnTop, 'screen-saver')
    // 气泡本身要能点（点一下收起/下一张），窗口又只有气泡大小，
    // 所以整窗可点，不做 click-through；窗口外的一切照旧是桌面。
    win.loadFile(path.join(__dirname, '..', 'overlay.html'))
    win.on('closed', () => { win = null; visible = false })
    win.webContents.on('did-fail-load', (ev, code, desc, url) => log('overlay-load-failed', code, desc, url))
    win.webContents.on('did-finish-load', () => {
      if (!win || win.isDestroyed()) return
      try { win.webContents.send('overlay:side', side) } catch (err) {}
      if (lastRender) {
        try { win.webContents.send('overlay:render', lastRender) } catch (err) {}
      }
    })
    return win
  }

  /** 气泡窗口的尺寸：宽度跟桌宠窗口同一套 clamp，高度由 1026:700 定死。 */
  function metrics(area) {
    const petWin = getPetWin()
    const size = clamp(Number(store.readSettings().size) || 220, 80, 480)
    const petWidth = petWin && !petWin.isDestroyed() ? petWin.getBounds().width : size + WIN_PAD * 2
    const base = clamp(petWidth - 12, BUBBLE_MIN_W, BUBBLE_MAX_W)
    // 放大时不能超出显示器工作区；宽度先封顶，高度按同一比例跟上。
    const capW = area ? Math.max(BUBBLE_MIN_W, area.width - 8) : BUBBLE_MAX_W * 1.54
    const width = Math.round(Math.min(base * growScale, capW))
    const height = Math.ceil(width * ASPECT)
    return { width, height, size }
  }

  /** 按桌宠当前位置把气泡摆在它上方（上方放不下就摆下方）。 */
  function place(forceSide) {
    if (!win || win.isDestroyed()) return
    const layout = getLayout()
    const petWin = getPetWin()
    if (!layout || !petWin || petWin.isDestroyed()) return
    const size = clamp(Number(store.readSettings().size) || 220, 80, 480)
    const pet = layout.petScreenRect(size)
    const display = screen.getDisplayMatching({ x: pet.x, y: pet.top, width: size, height: size })
    const area = display.workArea
    const { width, height } = metrics(area)

    const wantAbove = forceSide ? forceSide === 'above' : true
    let y = wantAbove ? pet.top - GAP_ABOVE - height : pet.bottom + GAP_ABOVE
    let nextSide = 'above'
    if (wantAbove && y < area.y) {
      // 上面放不下：翻到下面（桌宠窗口自己会向下长，见 window-layout）。
      nextSide = 'below'
      y = pet.bottom + GAP_ABOVE
    }
    if (y + height > area.y + area.height) y = Math.max(area.y, area.y + area.height - height)
    let x = Math.round(pet.x + size / 2 - width / 2)
    x = Math.max(area.x + 2, Math.min(x, area.x + area.width - width - 2))

    side = nextSide
    win.setBounds({ x: Math.round(x), y: Math.round(y), width, height })
  }

  // 窗口是懒创建的：首次 show 时 loadFile 还没完成，直接 send 会丢。
  // 所以把最近一次要画的东西记下来，等 did-finish-load 再补发一次。
  let lastRender = null

  function syncSide() {
    if (!win || win.isDestroyed()) return
    try { win.webContents.send('overlay:side', side) } catch (err) {}
  }

  /**
   * 显示一张卡。`payload` 是可序列化的行数据（见 app/pet.js buildRows）。
   * 先摆位置再显示，避免"先在旧位置闪一下再跳过去"。
   */
  function show(payload) {
    const w = create()
    if (!w) return
    growScale = 1
    place('above')
    syncSide()
    lastRender = payload
    if (!w.webContents.isLoading()) {
      try { w.webContents.send('overlay:render', payload) } catch (err) {}
    }
    if (!visible) {
      visible = true
      try { w.showInactive() } catch (err) {}
    }
    try { w.moveTop() } catch (err) {}
  }

  /** 换一个放大倍数（1 起）。只在可见时重排，避免看不见的窗口乱跳。 */
  function grow(scale) {
    const next = Math.max(1, Math.min(1.54, Number(scale) || 1))
    if (Math.abs(next - growScale) < 0.001) return
    growScale = next
    if (!visible) return
    place(side)
    syncSide()
  }

  function hide() {
    if (!win || win.isDestroyed()) return
    visible = false
    lastRender = null
    try { win.webContents.send('overlay:clear') } catch (err) {}
    try { win.hide() } catch (err) {}
  }

  /** 桌宠动了/换了屏幕：气泡跟着走（不可见时不做无意义的 setBounds）。 */
  function follow() {
    if (!visible) return
    place(side)
    syncSide()
  }

  function applyAlwaysOnTop(on) {
    if (!win || win.isDestroyed()) return
    try { win.setAlwaysOnTop(!!on, 'screen-saver') } catch (err) {}
  }

  function destroy() {
    if (win && !win.isDestroyed()) win.destroy()
    win = null
    visible = false
  }

  return {
    show, hide, follow, place, grow, applyAlwaysOnTop, destroy,
    get window() { return win },
    get visible() { return visible },
    get side() { return side },
    get scale() { return growScale },
  }
}

/**
 * P2-4：气泡窗口的 IPC 面。放在这里而不是 ipc.js，是因为这些通道只跟
 * overlay 有关（渲染、收起、点击转发）；业务状态仍然在桌宠窗口里。
 *
 * @param {object} deps
 * @param {object} deps.ipcMain
 * @param {object} deps.overlay        createOverlay(...) 的返回值
 * @param {function} deps.getPet       返回桌宠窗口或 null
 * @param {function} deps.onShow       气泡出现（状态机 + 预留区）
 * @param {function} deps.onHide       气泡收起
 */
function registerOverlayIpc({ ipcMain, overlay, getPet, onShow, onHide }) {
  ipcMain.on('bubble:render', (ev, payload) => {
    if (!overlay) return
    overlay.show(payload)
    if (onShow) onShow()
  })

  ipcMain.on('bubble:hide', () => {
    if (overlay) overlay.hide()
    if (onHide) onHide()
  })

  // 渲染层说“装不下，请大一号”：只让它变大，收回由下一次 show 的 growScale=1 负责。
  ipcMain.on('overlay:grow', (ev, scale) => {
    if (overlay) overlay.grow(scale)
  })

  ipcMain.on('overlay:click', () => {
    const pet = getPet && getPet()
    if (pet && !pet.isDestroyed()) pet.webContents.send('bubble:click')
  })

  ipcMain.on('overlay:action', (ev, id) => {
    const pet = getPet && getPet()
    if (pet && !pet.isDestroyed()) pet.webContents.send('bubble:action', String(id || ''))
  })
}

module.exports = { createOverlay, registerOverlayIpc }