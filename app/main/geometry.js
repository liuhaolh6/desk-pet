/**
 * Pure window geometry for the main process (P1-1 split).
 *
 * The pet window is `size + WIN_PAD * 2` wide so bubbles can be wider than the
 * pet, and the transparent area above the pet is reserved from the very first
 * frame: a resize on an always-on-top transparent window is what made older
 * builds flicker.
 */
'use strict'

function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)) }

// Horizontal breathing room on both sides of the pet.
const WIN_PAD = 54
function windowWidth(size) { return size + WIN_PAD * 2 }

// Mirrors app/pet.js syncBubbleMetrics()/bubbleReserve(): --bubble-w is
// clamp(220, innerWidth - 12, 340) and the frame keeps a 1026:700 aspect ratio.
const BUBBLE_MIN_W = 220
const BUBBLE_MAX_W = 340
function bubbleReserveFor(width) {
  const w = Math.max(BUBBLE_MIN_W, Math.min(BUBBLE_MAX_W, Math.round(width) - 12))
  return Math.ceil((w * 700) / 1026) + 8
}

module.exports = { clamp, WIN_PAD, windowWidth, BUBBLE_MIN_W, BUBBLE_MAX_W, bubbleReserveFor }