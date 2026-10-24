'use strict'
/**
 * P2-4：气泡/菜单的独立覆盖窗口。
 *
 * 以前气泡画在桌宠窗口里，所以桌宠窗口必须从头到尾预留一条 224px 的透明
 * 气泡带——窗口比桌宠高一倍，拖动、贴边、OBS 采集都要为这条带子让路。
 * 现在气泡有自己的 `transparent` 窗口：桌宠窗口只装桌宠，气泡窗口按气泡
 * 尺寸精确开在它上方，跟着桌宠走。
 *
 * 阶段二起悬停菜单也住在这里：同一个窗口，按 `hasBubble || hasMenu` 决定
 * 显隐——菜单收起且没有气泡时整扇窗隐藏，桌宠窗口则永远只有桌宠那么大，
 * 菜单再也不会被窗口边缘剪掉。菜单的摆位规则在 overlay-menu.js，通道在
 * overlay-ipc.js，这里只管那扇窗本身和气泡。
 *
 * 这个模块只管窗口本身：建、摆、显示/隐藏。内容由渲染层 `overlay.js` 画，
 * 卡片数据由桌宠窗口算好后经 IPC 送过来（见 ipc.js 的 bubble:render）。
 */

const path = require('node:path')
const { clamp, WIN_PAD } = require('./geometry')
const { createMenuController } = require('./overlay-menu')
const { registerOverlayIpc } = require('./overlay-ipc')

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
  // 两件东西共用一扇窗：气泡和悬停菜单。任何一个要显示，窗口就显示。
  let bubbleShown = false
  // 窗口是懒创建的：首次 show 时 loadFile 还没完成，直接 send 会丢。
  // 所以把最近一次要画的东西记下来，等 did-finish-load 再补发一次。
  let lastRender = null

  // 窗口是懒创建的；ipc.js 想往窗口上挂 blur（菜单失焦收起）之类的监听，
  // 先把钩子攒着，create() 时一次挂上。
  const windowHooks = []

  const menu = createMenuController({
    screen,
    getLayout,
    getPetWin,
    ensureWindow: () => create(),
    getWindow: () => (win && !win.isDestroyed() ? win : null),
    setSide: (next) => { side = next },
    syncVisibility: () => syncVisibility(),
  })

  function onWindow(fn) {
    if (typeof fn !== 'function') return
    windowHooks.push(fn)
    if (win && !win.isDestroyed()) {
      try { fn(win) } catch (err) {}
    }
  }

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
      // 平时不抢焦点（气泡不该打断打字）；菜单打开期间临时 setFocusable(true)，
      // 收起后立即退回 false——键盘只在菜单打开时被短暂借用。
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
    // 气泡/菜单本身要能点（点一下收起、点菜单项），窗口又只有内容大小，
    // 所以整窗可点，不做 click-through；窗口外的一切照旧是桌面。
    win.loadFile(path.join(__dirname, '..', 'overlay.html'))
    win.on('closed', () => {
      win = null
      visible = false
      bubbleShown = false
      menu.reset()
    })
    win.webContents.on('did-fail-load', (ev, code, desc, url) => log('overlay-load-failed', code, desc, url))
    win.webContents.on('did-finish-load', () => {
      if (!win || win.isDestroyed()) return
      try { win.webContents.send('overlay:side', side) } catch (err) {}
      if (lastRender) {
        try { win.webContents.send('overlay:render', lastRender) } catch (err) {}
      }
      if (menu.isOpen()) {
        try { win.webContents.send('overlay:menu', { open: true }) } catch (err) {}
      }
    })
    for (const fn of windowHooks) {
      try { fn(win) } catch (err) {}
    }
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

  function syncSide() {
    if (!win || win.isDestroyed()) return
    try { win.webContents.send('overlay:side', side) } catch (err) {}
  }

  /** 显隐：气泡或菜单任一需要就显示，都不需要就整窗隐藏。 */
  function syncVisibility() {
    if (!win || win.isDestroyed()) return
    const want = bubbleShown || menu.isOpen()
    if (want && !visible) {
      visible = true
      try { win.showInactive() } catch (err) {}
    } else if (!want && visible) {
      visible = false
      try { win.hide() } catch (err) {}
    }
    if (want) {
      try { win.moveTop() } catch (err) {}
    }
  }

  /**
   * 显示一张卡。`payload` 是可序列化的行数据（见 app/pet.js buildRows）。
   * 先摆位置再显示，避免「先在旧位置闪一下再跳过去」。
   */
  function show(payload) {
    const w = create()
    if (!w) return
    growScale = 1
    bubbleShown = true
    // 气泡和菜单不共存：气泡出现时菜单让位（桌宠渲染层也会先收菜单）。
    menu.close()
    place('above')
    syncSide()
    lastRender = payload
    if (!w.webContents.isLoading()) {
      try { w.webContents.send('overlay:render', payload) } catch (err) {}
    }
    syncVisibility()
  }

  /** 换一个放大倍数（1 起）。只在可见时重排，避免看不见的窗口乱跳。 */
  function grow(scale) {
    const next = Math.max(1, Math.min(1.54, Number(scale) || 1))
    if (Math.abs(next - growScale) < 0.001) return
    growScale = next
    if (!visible || menu.isOpen()) return
    place(side)
    syncSide()
  }

  function hide() {
    if (!win || win.isDestroyed()) return
    bubbleShown = false
    lastRender = null
    try { win.webContents.send('overlay:clear') } catch (err) {}
    syncVisibility()
  }

  /** 桌宠动了/换了屏幕：气泡或菜单跟着走（不可见时不做无意义的 setBounds）。 */
  function follow() {
    if (!visible) return
    if (menu.isOpen()) {
      menu.follow()
      return
    }
    place(side)
    syncSide()
  }

  function applyAlwaysOnTop(on) {
    if (!win || win.isDestroyed()) return
    try { win.setAlwaysOnTop(!!on, 'screen-saver') } catch (err) {}
  }

  function destroy() {
    menu.reset()
    if (win && !win.isDestroyed()) win.destroy()
    win = null
    visible = false
    bubbleShown = false
  }

  return {
    show, hide, follow, place, grow, applyAlwaysOnTop, destroy, onWindow,
    openMenu: (anchor) => menu.open(anchor),
    closeMenu: () => menu.close(),
    placeMenu: () => menu.place(),
    setMenuSize: (size) => menu.setSize(size),
    get window() { return win },
    get visible() { return visible },
    get side() { return side },
    get scale() { return growScale },
    get bubbleOpen() { return bubbleShown },
    get menuOpen() { return menu.isOpen() },
    get menuSize() { return menu.size },
  }
}

module.exports = { createOverlay, registerOverlayIpc }