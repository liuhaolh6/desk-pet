/**
 * Window placement maths: multi-display restore, clamping and edge snapping.
 *
 * Everything works on the *pet* rectangle (the visible square), not the wider
 * window that also reserves room for the bubble. The caller converts between
 * the two with `petRectOf` / `winFromPet` and a fixed horizontal padding.
 *
 * Pure functions only, so the smoke test can exercise the tricky cases
 * (removed monitor, off-screen save, snap thresholds) without Electron.
 */
'use strict'

function clamp(value, lo, hi) {
  return Math.min(hi, Math.max(lo, value))
}

/** Normalise whatever Electron hands us into `{ id, workArea, primary }`. */
function normalizeDisplays(raw) {
  const list = Array.isArray(raw) ? raw : []
  return list
    .filter((d) => d && d.workArea && Number.isFinite(d.workArea.width) && Number.isFinite(d.workArea.height))
    .map((d) => ({
      id: d.id == null ? null : String(d.id),
      primary: !!d.primary,
      workArea: {
        x: Number(d.workArea.x) || 0,
        y: Number(d.workArea.y) || 0,
        width: Number(d.workArea.width) || 0,
        height: Number(d.workArea.height) || 0,
      },
    }))
}

function petRectOf(win, size, pad) {
  return { x: Math.round(win.x + pad), y: Math.round(win.y), width: size, height: size }
}

function winFromPet(pet, pad) {
  return { x: Math.round(pet.x - pad), y: Math.round(pet.y) }
}

function areaOf(display) {
  return display && display.workArea ? display.workArea : { x: 0, y: 0, width: 0, height: 0 }
}

function rectCenter(rect) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}

function contains(rect, area) {
  return rect.x >= area.x && rect.y >= area.y &&
    rect.x + rect.width <= area.x + area.width &&
    rect.y + rect.height <= area.y + area.height
}

function intersectionArea(a, b) {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

function distanceSq(a, b) {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

/** The display that owns most of `rect`, falling back to the nearest one. */
function displayForRect(displays, rect) {
  const list = normalizeDisplays(displays)
  if (!list.length) return null
  let best = null
  let bestArea = 0
  for (const display of list) {
    const area = intersectionArea(rect, display.workArea)
    if (area > bestArea) { best = display; bestArea = area }
  }
  if (best) return best
  const center = rectCenter(rect)
  let nearest = list[0]
  let nearestDist = Infinity
  for (const display of list) {
    const dist = distanceSq(center, rectCenter(display.workArea))
    if (dist < nearestDist) { nearest = display; nearestDist = dist }
  }
  return nearest
}

function displayAt(displays, point) {
  const list = normalizeDisplays(displays)
  if (!list.length) return null
  const hit = list.find((d) => {
    const a = d.workArea
    return point.x >= a.x && point.x <= a.x + a.width && point.y >= a.y && point.y <= a.y + a.height
  })
  return hit || displayForRect(list, { x: point.x, y: point.y, width: 0, height: 0 })
}

/** Keep the pet fully on one screen (top-left wins if the area is too small). */
function clampPet(pet, area) {
  const maxX = area.x + Math.max(0, area.width - pet.width)
  const maxY = area.y + Math.max(0, area.height - pet.height)
  return {
    x: clamp(Math.round(pet.x), area.x, maxX),
    y: clamp(Math.round(pet.y), area.y, maxY),
    width: pet.width,
    height: pet.height,
  }
}

/** Magnetic edges: returns the snapped rect plus which edges grabbed. */
function snapPet(pet, area, gap) {
  const threshold = Math.max(0, Number(gap) || 0)
  const snapped = { left: false, right: false, top: false, bottom: false }
  let x = pet.x
  let y = pet.y
  if (threshold > 0) {
    const rightEdge = area.x + area.width
    const bottomEdge = area.y + area.height
    if (Math.abs(pet.x - area.x) <= threshold) { x = area.x; snapped.left = true }
    else if (Math.abs(rightEdge - (pet.x + pet.width)) <= threshold) { x = rightEdge - pet.width; snapped.right = true }
    if (Math.abs(pet.y - area.y) <= threshold) { y = area.y; snapped.top = true }
    else if (Math.abs(bottomEdge - (pet.y + pet.height)) <= threshold) { y = bottomEdge - pet.height; snapped.bottom = true }
  }
  return { x: Math.round(x), y: Math.round(y), width: pet.width, height: pet.height, snapped }
}

function defaultPet(area, size, margin) {
  const m = Math.max(0, Number(margin) || 0)
  return {
    x: area.x + Math.max(0, area.width - size - m),
    y: area.y + Math.max(0, area.height - size - m),
    width: size,
    height: size,
  }
}

/**
 * Resolve the window position to use on startup.
 *
 * saved: { x, y, displayId } in window coordinates (no bubble reserved).
 * Returns { x, y, displayId } in window coordinates, guaranteed on-screen.
 */
function resolveSaved(saved, displays, size, pad, margin) {
  const list = normalizeDisplays(displays)
  const primary = list.find((d) => d.primary) || list[0]
  if (!primary) {
    return { x: Math.round(margin || 0), y: Math.round(margin || 0), displayId: null, moved: true }
  }

  if (!saved || !Number.isFinite(saved.x) || !Number.isFinite(saved.y)) {
    const pet = defaultPet(primary.workArea, size, margin)
    return Object.assign(winFromPet(pet, pad), { displayId: primary.id, moved: false })
  }

  const pet = petRectOf(saved, size, pad)
  let target = saved.displayId ? list.find((d) => d.id === String(saved.displayId)) : null
  if (!target) target = displayForRect(list, pet)
  const area = areaOf(target)
  const clamped = clampPet(pet, area)
  const moved = clamped.x !== pet.x || clamped.y !== pet.y
  return Object.assign(winFromPet(clamped, pad), { displayId: target.id, moved })
}

/** Re-clamp an existing window (display removed / resolution changed). */
function ensureVisible(win, displays, size, pad, margin) {
  const res = resolveSaved({ x: win.x, y: win.y, displayId: win.displayId }, displays, size, pad, margin)
  return res
}

module.exports = {
  clamp,
  normalizeDisplays,
  petRectOf,
  winFromPet,
  contains,
  intersectionArea,
  displayForRect,
  displayAt,
  clampPet,
  snapPet,
  defaultPet,
  resolveSaved,
  ensureVisible,
}
