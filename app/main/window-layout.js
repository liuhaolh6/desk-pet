'use strict'
// Window layout + click-through hit testing (P1-1 stage 2).
//
// Everything here used to live at the top of app/main.js and answered one
// question: where is the pet on screen, how big is its window, and is the cursor
// "on" it? No Electron at module scope — the window is injected through
// getWindow(), which returns null while the pet window is closed/recreated.

const { clamp, WIN_PAD, windowWidth, bubbleReserveFor } = require('./geometry')

/**
 * Pure hit test. `rects` are renderer-reported boxes in window-local
 * coordinates; `bounds` is the window's screen rect.
 */
function hitTest(point, bounds, rects) {
  for (const r of rects) {
    if (!r) continue
    if (point.x >= bounds.x + r.x && point.x <= bounds.x + r.x + r.w &&
        point.y >= bounds.y + r.y && point.y <= bounds.y + r.y + r.h) return true
  }
  return false
}

function createWindowLayout({ screen, placement, readSettings, log, winState, getWindow, onMirror }) {
  let petPos = null
  let bubbleSide = 'above'
  let reserve = 0
  let rects = []
  let interactive = false
  let hitTimer = 0

  const settingsSize = () => clamp(Number(readSettings().size) || 220, 80, 480)

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
    const res = placement.resolveSaved(readSettings().position, getDisplays(), size, WIN_PAD, 24)
    if (res.moved) log('position clamped to display=' + res.displayId)
    return { x: res.x, y: res.y, displayId: res.displayId }
  }

  function petTopLeft() {
    const win = getWindow()
    if (!win) return { x: 0, y: 0 }
    const size = settingsSize()
    const r = petScreenRect(size)
    return { x: r.x, y: r.top }
  }

  /**
   * Where the pet actually is on screen, derived from the window bounds. In
   * `above` mode the pet sits at the window's bottom and the reserve is on top;
   * in `below` mode the pet sits at the window's top and the reserve is below.
   */
  function petScreenRect(size) {
    if (petPos) return { x: petPos.x, top: petPos.y, bottom: petPos.y + size }
    const win = getWindow()
    if (!win) return { x: 0, top: 0, bottom: size }
    const b = win.getBounds()
    const extra = Math.max(0, b.height - size)
    if (bubbleSide === 'below') {
      return { x: b.x, top: b.y + b.height - extra - size, bottom: b.y + b.height - extra }
    }
    return { x: b.x, top: b.y + b.height - size, bottom: b.y + b.height }
  }

  /** Window bounds that put the pet's top-left at (petX, petY) for the given reserve. */
  function windowBoundsForPet(petX, petY, size, wantReserve) {
    const extra = Math.max(0, Math.round(wantReserve))
    return {
      x: petX - WIN_PAD,
      y: bubbleSide === 'below' ? petY : petY - extra,
      width: windowWidth(size),
      height: size + extra,
    }
  }

  /** Which screen edge the pet is hugging, for the renderer's mirror effect. */
  function mirrorSide() {
    const win = getWindow()
    if (!win) return 'none'
    const b = win.getBounds()
    const size = settingsSize()
    const area = screen.getDisplayMatching(b).workArea
    // Compare the pet's rect, not the window rect: the window has WIN_PAD on
    // both sides, so its right edge is normally off-screen even when the pet is
    // sitting 24px away from the edge.
    const pet = placement.petRectOf({ x: b.x, y: petTopLeft().y }, size, WIN_PAD)
    const margin = 20
    if (pet.x <= area.x + margin) return 'left'
    if (pet.x + size >= area.x + area.width - margin) return 'right'
    return 'none'
  }

  /** Keep the pet visible after a monitor is unplugged or its resolution changes. */
  function ensureOnScreen() {
    const win = getWindow()
    if (!win) return
    const size = settingsSize()
    const b = win.getBounds()
    const pet = placement.petRectOf({ x: b.x, y: petTopLeft().y }, size, WIN_PAD)
    const display = placement.displayForRect(getDisplays(), pet)
    if (!display) return
    const clamped = placement.clampPet(pet, display.workArea)
    const extra = Math.max(0, b.height - size)
    const moved = clamped.x !== pet.x || clamped.y !== pet.y
    if (moved) {
      log('relocate pet to display=' + display.id)
      petPos = { x: clamped.x, y: clamped.y }
      win.setBounds(windowBoundsForPet(clamped.x, clamped.y, size, extra))
      onMirror()
    }
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
   * @param {number|null} height ignored since P2-4 stage 2 (kept for IPC compat)
   * @returns {{reserve:0, side:'above'}}
   */
  function applyBubbleHeight(height) {
    // P2-4 stage 2 moved the bubble into its own window, so a card no longer
    // needs a strip. But the hover menu is still drawn by the pet renderer and
    // it extends *outside* the pet image: with a pet-sized window it was clipped
    // and its buttons were unreachable (0.6.10 regression). So the renderer may
    // still ask for a transient strip; the pet must stay put while the window
    // grows around it.
    const size = settingsSize()
    const pet = petScreenRect(size)
    const want = Math.max(0, Math.round(Number(height) || 0))
    let extra = want
    const win = getWindow()
    if (!win || win.isDestroyed()) {
      reserve = extra
      bubbleSide = 'above'
      return { reserve, side: bubbleSide }
    }
    // Never grow past the screen: the strip goes on whichever side has room,
    // preferring above (that is where the menu is drawn by default).
    const area = screen.getDisplayMatching({ x: pet.x, y: pet.top, width: size, height: size }).workArea
    const roomAbove = Math.max(0, pet.top - area.y)
    const roomBelow = Math.max(0, area.y + area.height - pet.bottom)
    bubbleSide = (roomAbove >= want || roomAbove >= roomBelow) ? 'above' : 'below'
    extra = Math.min(extra, bubbleSide === 'above' ? roomAbove : roomBelow)
    reserve = extra
    const bounds = windowBoundsForPet(pet.x, pet.top, size, extra)
    const b = win.getBounds()
    if (b.x !== bounds.x || b.y !== bounds.y || b.width !== bounds.width || b.height !== bounds.height) {
      win.setBounds(bounds, false)
    }
    return { reserve, side: bubbleSide }
  }

  /** The renderer reports its interactive boxes; they change with the bubble. */
  function setHitRects(next) {
    rects = Array.isArray(next) ? next.slice(0, 12) : []
    if (process.env.DESKPET_TRACE_HIT === '1') log('hit-rects', JSON.stringify(rects))
    updateInteractive()
  }

  /**
   * Flip click-through based on where the OS cursor is right now. Polled at
   * 50ms because `setIgnoreMouseEvents(true, {forward:true})` windows never see
   * mousemove themselves.
   */
  function updateInteractive() {
    const win = getWindow()
    if (!win || win.isDestroyed()) return
    let inside = winState.is('dragging')
    if (!inside) {
      let p
      try { p = screen.getCursorScreenPoint() } catch (err) { return }
      inside = hitTest(p, win.getBounds(), rects)
    }
    if (inside === interactive) return
    interactive = inside
    if (process.env.DESKPET_TRACE_HIT === '1') {
      log('hit-interactive', inside ? 'on' : 'off', 'rects=' + rects.length)
    }
    try { win.setIgnoreMouseEvents(!inside, { forward: true }) } catch (err) {}
  }

  /** Poll cursor position while the pet window is alive (50ms). */
  function start() {
    if (!hitTimer) hitTimer = setInterval(updateInteractive, 50)
  }

  /** Called by createPetWindow once the window exists. */
  function begin(position) {
    petPos = { x: position.x, y: position.y }
    bubbleSide = 'above'
    reserve = position.reserve
  }

  return {
    get petPos() { return petPos },
    set petPos(v) { petPos = v },
    get bubbleSide() { return bubbleSide },
    get reserve() { return reserve },
    get interactive() { return interactive },
    get rects() { return rects.slice() },
    begin,
    getDisplays,
    resolveWindowPosition,
    petTopLeft,
    petScreenRect,
    windowBoundsForPet,
    mirrorSide,
    ensureOnScreen,
    applyBubbleHeight,
    setHitRects,
    updateInteractive,
    start,
    hitTest: (point, bounds) => hitTest(point, bounds, rects),
  }
}

module.exports = { createWindowLayout, hitTest }