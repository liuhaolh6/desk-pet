'use strict'
// Theme tokens (ROADMAP P2-7).
//
// A theme is a plain JSON file: `{ id, nameKey, tokens: { '--ink': '#202a44', … } }`.
// `tokens.css` keeps the built-in defaults; a theme only overrides what it wants.
// Everything here is pure so it can be validated in tests and, later, on import.

// Whitelist: a theme may only touch design tokens. Nothing that can lay out the
// UI or reach the network - an imported pack must never be able to hide a button.
const ALLOWED = [
  '--font-ui', '--font-mono',
  '--ink', '--ink-2', '--muted', '--muted-deco', '--line', '--line-strong',
  '--accent', '--accent-deep', '--accent-soft', '--accent-softer',
  '--blush', '--blush-deep', '--blush-soft', '--blush-softer', '--cream',
  '--ok', '--warn', '--danger',
  '--surface', '--surface-2', '--surface-3', '--bg',
  '--radius-xs', '--radius-sm', '--radius-md', '--radius-lg', '--radius-pill',
  '--shadow-sm', '--shadow-md', '--shadow-pop',
  '--bubble-bg', '--bubble-ink', '--bubble-radius', '--bubble-tail',
]
const ALLOWED_SET = new Set(ALLOWED)
const MAX_TOKENS = 64
const MAX_VALUE_LENGTH = 200

// Values end up inside a `style` attribute, so anything that could break out of
// the declaration (semicolons, braces, `url(`) is rejected outright.
const BAD_VALUE = /[;{}<>]|url\s*\(|expression\s*\(|@import/i
const SAFE_NAME = /^--[a-z0-9-]+$/

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/**
 * Validate a theme file. Returns `{ ok, theme, errors }`; `theme` is always a
 * safe copy (unknown/unsafe tokens dropped, defaults filled in).
 */
function validateTheme(raw) {
  const errors = []
  if (!isPlainObject(raw)) return { ok: false, theme: null, errors: ['theme-not-object'] }

  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(id)) errors.push('bad-id')

  const nameKey = typeof raw.nameKey === 'string' && raw.nameKey.trim()
    ? raw.nameKey.trim()
    : (id ? 'theme.' + id : '')

  const tokens = {}
  const src = isPlainObject(raw.tokens) ? raw.tokens : {}
  if (!isPlainObject(raw.tokens)) errors.push('missing-tokens')

  for (const key of Object.keys(src)) {
    const value = src[key]
    if (!SAFE_NAME.test(key)) { errors.push('bad-token-name:' + key); continue }
    if (!ALLOWED_SET.has(key)) { errors.push('unknown-token:' + key); continue }
    if (typeof value !== 'string') { errors.push('bad-token-value:' + key); continue }
    const trimmed = value.trim()
    if (!trimmed || trimmed.length > MAX_VALUE_LENGTH) { errors.push('bad-token-value:' + key); continue }
    if (BAD_VALUE.test(trimmed)) { errors.push('unsafe-token-value:' + key); continue }
    tokens[key] = trimmed
  }
  if (Object.keys(tokens).length > MAX_TOKENS) errors.push('too-many-tokens')

  const ok = errors.length === 0
  return {
    ok,
    theme: { id, nameKey, tokens },
    errors,
  }
}

/** Merge an overlay theme's tokens over a base theme's tokens. */
function mergeTheme(base, overlay) {
  return Object.assign({}, (base && base.tokens) || {}, (overlay && overlay.tokens) || {})
}

/** `{ '--ink': '#333' }` → `:root{--ink:#333;}` (sorted, for stable tests). */
function tokensToCss(tokens) {
  const keys = Object.keys(tokens || {}).filter((k) => ALLOWED_SET.has(k)).sort()
  if (!keys.length) return ''
  const body = keys.map((k) => k + ':' + String(tokens[k]).trim()).join(';')
  return ':root{' + body + ';}'
}

/** Which token keys a theme overrides, for the settings page summary. */
function describeTheme(theme) {
  const tokens = (theme && theme.tokens) || {}
  return {
    id: (theme && theme.id) || '',
    nameKey: (theme && theme.nameKey) || '',
    count: Object.keys(tokens).length,
  }
}

module.exports = {
  ALLOWED,
  MAX_TOKENS,
  validateTheme,
  mergeTheme,
  tokensToCss,
  describeTheme,
}