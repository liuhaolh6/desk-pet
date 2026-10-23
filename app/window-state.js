'use strict'
/**
 * P1-2: the pet window's interaction mode as an explicit machine.
 *
 * Before this module, "what is the pet doing right now" was spread over five
 * booleans in three files (`petDragging` in the main process, `state.menuOpen` /
 * `state.wantBubble` / `state.drag` in the renderer, plus DOM classes), and every
 * timing constant (50ms hit poll, 540ms shrink, 180ms menu fade) implicitly
 * depended on them. 0.6.3 and 0.6.4 both regressed here because a resize landed
 * in the wrong mode.
 *
 * The machine is deliberately pure Node: no Electron, no timers. It only answers
 * "can this event happen in this state, and what is the next state". Consumers
 * (main process) react to `onChange` and keep doing the actual work.
 *
 * States (ROADMAP P1-2):
 *   idle      — pet on screen, nothing reserved beyond the fixed bubble strip
 *   bubble    — a card is showing (`pet:bubble` visible)
 *   menu      — the hover menu is open (reserves max(bubble strip, menu))
 *   dragging  — the pointer is dragging the pet
 *   cutout    — the cutout window owns the interaction
 *
 * `hidden` is NOT a state on purpose: visibility is orthogonal (the tray can
 * hide the pet while a bubble is reserved), so it stays a flag on the window.
 */

const STATES = ['idle', 'bubble', 'menu', 'dragging', 'cutout']

/**
 * Transition table: event → { fromState: toState }.
 * A missing entry is an illegal transition (ignored + counted), which is what
 * turns "the ordering looked fine in the happy path" into a testable invariant.
 */
const TABLE = {
  'bubble-show': { idle: 'bubble', bubble: 'bubble', menu: 'bubble' },
  'bubble-hide': { bubble: 'idle' },
  'menu-open': { idle: 'menu', bubble: 'menu' },
  'menu-close': { menu: 'idle' },
  'drag-start': { idle: 'dragging', bubble: 'dragging', menu: 'dragging' },
  'drag-end': { dragging: 'idle' },
  'cutout-open': { idle: 'cutout', bubble: 'cutout', menu: 'cutout' },
  'cutout-close': { cutout: 'idle' },
  reset: { idle: 'idle', bubble: 'idle', menu: 'idle', dragging: 'idle', cutout: 'idle' },
}

const EVENTS = Object.keys(TABLE)

/**
 * @param {object} [options]
 * @param {(change:{prev:string,next:string,event:string,meta:any})=>void} [options.onChange]
 * @param {(msg:string)=>void} [options.log] diagnostics sink (main passes its logger)
 */
function createWindowState(options) {
  const onChange = (options && options.onChange) || null
  const log = (options && options.log) || null

  let state = 'idle'
  let prev = null
  let illegal = 0
  let lastIllegal = null
  const history = []

  function record(event, meta) {
    history.push({ from: prev, to: state, event })
    if (history.length > 20) history.shift()
    void meta
  }

  function transition(event, meta) {
    const row = TABLE[event]
    if (!row) {
      illegal += 1
      lastIllegal = { event, from: state, reason: 'unknown-event' }
      if (log) log('state-illegal', event, 'from=' + state, 'reason=unknown-event')
      return { ok: false, state, reason: 'unknown-event' }
    }
    const next = row[state]
    if (!next) {
      illegal += 1
      lastIllegal = { event, from: state, reason: 'illegal' }
      if (log) log('state-illegal', event, 'from=' + state)
      return { ok: false, state, reason: 'illegal' }
    }
    const before = state
    state = next
    prev = before
    record(event, meta)
    if (onChange) {
      try { onChange({ prev: before, next, event, meta }) } catch (err) {}
    }
    return { ok: true, state, prev: before }
  }

  function can(event) {
    const row = TABLE[event]
    return !!(row && row[state])
  }

  function reset() {
    return transition('reset')
  }

  return {
    STATES,
    EVENTS,
    TABLE,
    transition,
    can,
    reset,
    is: (name) => state === name,
    get state() { return state },
    get prev() { return prev },
    get illegal() { return illegal },
    get lastIllegal() { return lastIllegal },
    get history() { return history.slice() },
  }
}

/** Exhaustive matrix, used by the tests to prove the table has no holes. */
function matrix() {
  return STATES.map((from) => ({
    from,
    events: EVENTS.map((event) => ({ event, to: (TABLE[event] && TABLE[event][from]) || null })),
  }))
}

module.exports = { createWindowState, matrix, STATES, EVENTS, TABLE }