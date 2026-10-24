'use strict'
/**
 * P2-4 阶段二：悬停菜单的「窗口侧」。
 *
 * 菜单面板本身在渲染层（app/overlay.html 的 #petMenu），这个模块只回答三件事：
 * 窗口开多大、摆在哪（桌宠头顶上方，放不下翻到下方）、什么时候该显隐。
 * 把它从 overlay.js 里拆出来，是因为摆位规则要单独测，也因为 overlay.js
 * 已经背着气泡那一摊。
 *
 * 坐标口径：`anchor` 是桌宠头顶正中，用的是**桌宠窗口内坐标**（由渲染层量
 * getBoundingClientRect 得到）；其余矩形都是屏幕坐标。
 */
const { clamp } = require('./geometry')

// 面板与桌宠之间的间距，以及面板四周留给阴影的留白（见 overlay.css 的
// `.pet-menu { left: 6px; top: 6px }`）。窗口尺寸 = 面板 + 2 * MENU_PAD。
const MENU_GAP = 10
const MENU_PAD = 6
const MENU_DEFAULT_W = 196
const MENU_DEFAULT_H = 204

/** 渲染层量出来的面板尺寸，收进合理范围后使用。 */
function clampPanel(width, height) {
  return {
    width: clamp(Math.round(Number(width) || 0), 120, 320),
    height: clamp(Math.round(Number(height) || 0), 80, 600),
  }
}

/**
 * @param {object} deps
 * @param {object} deps.screen
 * @param {function} deps.getLayout      window-layout（可用性检查）
 * @param {function} deps.getPetWin      桌宠窗口或 null
 * @param {function} deps.ensureWindow   建窗并返回 BrowserWindow
 * @param {function} deps.getWindow      现有窗口或 null
 * @param {function} deps.setSide        气泡/菜单当前在桌宠哪一侧
 * @param {function} deps.syncVisibility 让窗口按「气泡 || 菜单」显隐
 */
function createMenuController({ screen, getLayout, getPetWin, ensureWindow, getWindow, setSide, syncVisibility }) {
  let shown = false
  let anchor = null
  let size = { width: MENU_DEFAULT_W, height: MENU_DEFAULT_H }

  /** 面板 + 留白的窗口矩形（屏幕坐标），以及窗口该在桌宠的哪一侧。 */
  function panelRect() {
    const layout = getLayout()
    const petWin = getPetWin()
    if (!layout || !petWin || petWin.isDestroyed()) return null
    // 桌宠渲染层量的是**内容区**坐标（getBoundingClientRect），所以锚点也
    // 要加在内容区左上角上；Win11 的透明无边框窗口，窗框比内容区大 6~7px。
    const petRect = petWin.getContentBounds()
    let anchorX = petRect.x + petRect.width / 2
    let anchorTop = petRect.y
    if (anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.y)) {
      anchorX = petRect.x + anchor.x
      anchorTop = petRect.y + anchor.y
    }

    const display = screen.getDisplayMatching({ x: petRect.x, y: petRect.y, width: petRect.width, height: petRect.height })
    const area = display.workArea
    // 面板不能宽过工作区；窗口再多留一圈阴影。
    const panelW = Math.min(size.width, Math.max(120, area.width - MENU_PAD * 2 - 4))
    const panelH = Math.min(size.height, Math.max(80, area.height - MENU_PAD * 2 - 4))
    const width = panelW + MENU_PAD * 2
    const height = panelH + MENU_PAD * 2

    // 优先放在桌宠上方，放不下就翻到下方（和气泡同一套规矩）。
    const petBottom = petRect.y + petRect.height
    let panelTop = anchorTop - MENU_GAP - panelH
    let nextSide = 'above'
    if (panelTop - MENU_PAD < area.y) {
      nextSide = 'below'
      panelTop = petBottom + MENU_GAP
    }
    let y = panelTop - MENU_PAD
    if (y < area.y) y = area.y
    if (y + height > area.y + area.height) y = Math.max(area.y, area.y + area.height - height)

    let panelLeft = anchorX - panelW / 2
    panelLeft = Math.max(area.x + 2, Math.min(panelLeft, area.x + area.width - panelW - 2))
    const x = Math.round(panelLeft - MENU_PAD)

    return { x, y: Math.round(y), width, height, side: nextSide }
  }

  /* ---------------------------------------------- 面板内容区 -> 窗口矩形 */

  /**
   * 窗框差：渲染层量的是内容区（getBoundingClientRect），而 `setBounds` 管的是
   * 整窗。Win11 的透明无边框窗口，整窗比内容区宽 6px、高 7px，客户区还整体
   * 偏几个 px；不补这一手，面板底边会被窗口裁掉。
   * 这些差值只跟窗口样式有关，第一次打开时向渲染层要一次真实尺寸即可。
   */
  const frame = { x: 0, y: 0, width: 0, height: 0 }
  let calibrated = false

  function calibrate(w) {
    if (calibrated || !w || w.webContents.isLoading()) return
    const c = w.getContentBounds()
    w.webContents
      .executeJavaScript('JSON.stringify([innerWidth, innerHeight, screenX, screenY])', true)
      .then((raw) => {
        const [iw, ih, sx, sy] = JSON.parse(raw)
        if (!iw || !ih) return
        frame.width = c.width - iw
        frame.height = c.height - ih
        frame.x = c.x - sx
        frame.y = c.y - sy
        calibrated = true
        if (shown) place()
      })
      .catch(() => {})
  }

  function place() {
    const w = getWindow()
    if (!w) return
    const next = panelRect()
    if (!next) return
    setSide(next.side)
    calibrate(w)
    const target = {
      x: next.x - frame.x,
      y: next.y - frame.y,
      width: next.width + frame.width,
      height: next.height + frame.height,
    }
    const b = w.getBounds()
    if (b.x === target.x && b.y === target.y && b.width === target.width && b.height === target.height) return
    w.setBounds(target)
  }

  function send(open) {
    const w = getWindow()
    if (!w || w.webContents.isLoading()) return // did-finish-load 会补发
    try { w.webContents.send('overlay:menu', { open }) } catch (err) {}
  }

  /** 打开菜单：`anchor` 是桌宠头顶正中（桌宠窗口内坐标），可为空。 */
  function open(next) {
    const w = ensureWindow()
    if (!w) return
    shown = true
    anchor = next && Number.isFinite(next.x) && Number.isFinite(next.y)
      ? { x: Number(next.x), y: Number(next.y) }
      : null
    place()
    // 菜单只在打开期间可聚焦：键盘用户可以 Tab 进菜单、按 Esc 退出。
    try { w.setFocusable(true) } catch (err) {}
    syncVisibility()
    // 窗口隐藏时 Windows 还不报真实窗框（显示后高差从 7px 变 17px），
    // 所以显示完再校正一次内容区，否则面板底边会被窗口裁掉 1~5px。
    place()
    try { w.focus() } catch (err) {}
    send(true)
  }

  function close() {
    if (!shown) return
    shown = false
    anchor = null
    const w = getWindow()
    if (w) {
      try { w.setFocusable(false) } catch (err) {}
      send(false)
    }
    syncVisibility()
  }

  /** 渲染层量出来的面板尺寸（不含窗口留白）。 */
  function setSize(next) {
    if (!next) return
    const panel = clampPanel(next.width, next.height)
    if (!panel.width || !panel.height) return
    if (panel.width === size.width && panel.height === size.height) return
    size = panel
    if (shown) place()
  }

  function follow() {
    if (shown) place()
  }

  function reset() {
    shown = false
    anchor = null
    setSide('above')
  }

  return {
    open, close, place, follow, setSize, reset,
    isOpen: () => shown,
    get size() { return size },
    get anchor() { return anchor },
  }
}

module.exports = { createMenuController, clampPanel, MENU_GAP, MENU_PAD, MENU_DEFAULT_W, MENU_DEFAULT_H }