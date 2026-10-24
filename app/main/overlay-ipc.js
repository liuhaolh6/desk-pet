'use strict'
/**
 * P2-4：overlay 窗口的 IPC 面。
 *
 * 放在单独模块里而不是塞回 ipc.js，是因为这些通道只跟那扇透明窗有关
 * （渲染、收起、点击转发）；业务状态和状态机仍然属于桌宠窗口。
 *
 * @param {object} deps
 * @param {object} deps.ipcMain
 * @param {object} deps.overlay         createOverlay(...) 的返回值
 * @param {function} deps.getPet        返回桌宠窗口或 null
 * @param {function} deps.onShow        气泡出现（状态机）
 * @param {function} deps.onHide        气泡收起
 * @param {function} deps.onMenuAction  菜单项被点（转发给桌宠窗口）
 * @param {function} deps.onMenuClose   菜单窗口自己收起（失焦/Esc/点空白）
 */
function registerOverlayIpc({ ipcMain, overlay, getPet, onShow, onHide, onMenuAction, onMenuClose }) {
  ipcMain.on('bubble:render', (ev, payload) => {
    if (!overlay) return
    overlay.show(payload)
    if (onShow) onShow()
  })

  ipcMain.on('bubble:hide', () => {
    if (overlay) overlay.hide()
    if (onHide) onHide()
  })

  // 渲染层说「装不下，请大一号」：只让它变大，收回由下一次 show 的 growScale=1 负责。
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

  // P2-4 阶段二：菜单也住在这扇窗里。渲染层量好面板尺寸、点中菜单项、或者
  // 自己要求收起时，都从这里转一手。
  ipcMain.on('overlay:menu-size', (ev, size) => {
    if (overlay) overlay.setMenuSize(size)
  })

  ipcMain.on('overlay:menu-action', (ev, id) => {
    if (overlay) overlay.closeMenu()
    if (onMenuAction) onMenuAction(String(id || ''))
  })

  ipcMain.on('overlay:menu-close', () => {
    if (overlay) overlay.closeMenu()
    if (onMenuClose) onMenuClose()
  })
}

module.exports = { registerOverlayIpc }