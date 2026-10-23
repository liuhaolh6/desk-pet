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
   * @param {number|null} height reserve to keep; `null` keeps the current one
   *   (hiding a bubble no longer shrinks the window, and a pure re-measure must
   *   not be mistaken for "a bubble is visible")
   * @returns {{reserve:number, side:'above'|'below'}}
   */
  function applyBubbleHeight(height) {
    const win = getWindow()
    if (!win) return { reserve, side: bubbleSide }
    const size = settingsSize()
    const keep = height == null
    const requested = keep ? reserve : clamp(Math.round(Number(height) || 0), 0, 420)
    // Treat sub-card heights as "no bubble": they are invisible leftovers that
    // otherwise leave a few pixels of reserved space (and shift drag maths).
    const want = keep || requested >= 40 ? requested : 0

    const b = win.getBounds()
    const pet = petScreenRect(size)
    const display = screen.getDisplayNearestPoint({
      x: b.x + Math.floor(b.width / 2),
      y: pet.bottom - Math.floor(size / 2),
    })
    const work = display.workArea

    // 0.6.2 (user decision): the bubble always sits ABOVE the pet. When the pet is
    // too close to the top edge, move it down so a bubble-sized gap stays between
    // the pet and the boundary - never flip the bubble below the pet.
    const side = 'above'
    const wantReserve = Math.max(0, Math.min(want, 420))
    const minTop = work.y + wantReserve
    const maxTop = work.y + Math.max(0, work.height - size)
    const petTop = Math.min(Math.max(pet.top, minTop), maxTop)
    const nextH = size + wantReserve
    const bounds = windowBoundsForPet(pet.x, petTop, size, wantReserve)
    const changed = side !== bubbleSide || wantReserve !== reserve ||
      b.height !== nextH || b.y !== bounds.y || b.x !== bounds.x
    bubbleSide = side
    reserve = wantReserve
    if (petTop !== pet.top) {
      petPos = { x: pet.x, y: petTop }
      onMirror()
    }
    if (changed) {
      // Re-assert transparency right before the bounds change: the newly exposed
      // strip can otherwise be composited with the window background for a frame.
      if (process.env.DESKPET_OPAQUE !== '1') {
        try { win.setBackgroundColor('#00000000') } catch (err) {}
      }
      win.setBounds(bounds, false)
    }
    return { reserve, side }
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