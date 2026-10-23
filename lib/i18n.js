'use strict'

/**
 * Tiny i18n core (P2-6).
 *
 * Deliberately dependency-free and dumb: a flat `key → string` dictionary per
 * locale, `{name}` interpolation, and a fallback chain (requested locale →
 * `zh-CN` → the key itself). No plural rules beyond `{count}`-style
 * substitution, because the app's strings are Chinese/English sentences with no
 * grammatical number agreement.
 *
 * The point of this module is *structure*: every user-facing string in the main
 * process goes through `t()`, and `tools/check-i18n.js` keeps the two locales in
 * sync and stops new hard-coded Chinese from slipping in (see §「基线」there).
 */

const DEFAULT_LOCALE = 'zh-CN'
const FALLBACK_LOCALE = 'zh-CN'

/** Flatten a nested dictionary into dotted keys (also accepts flat input). */
function flatten(dict, prefix = '', out = {}) {
  if (!dict || typeof dict !== 'object') return out
  for (const [key, value] of Object.entries(dict)) {
    const full = prefix ? prefix + '.' + key : key
    if (value && typeof value === 'object' && !Array.isArray(value)) flatten(value, full, out)
    else if (typeof value === 'string') out[full] = value
  }
  return out
}

/** `{name}` / `{count}` substitution; unknown placeholders are left as-is. */
function interpolate(template, vars) {
  if (!vars) return template
  return String(template).replace(/\{(\w+)\}/g, (whole, name) => (
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole
  ))
}

/**
 * @param {object} opts
 * @param {string} [opts.locale]        requested locale
 * @param {object} [opts.dict]          flattened or nested strings for `locale`
 * @param {object} [opts.fallbackDict]  strings for the fallback locale
 */
function createI18n({ locale = DEFAULT_LOCALE, dict = {}, fallbackDict = {} } = {}) {
  const primary = flatten(dict)
  const fallback = flatten(fallbackDict)
  const missing = new Set()

  function has(key) {
    return Object.prototype.hasOwnProperty.call(primary, key) || Object.prototype.hasOwnProperty.call(fallback, key)
  }

  function t(key, vars) {
    let raw
    if (Object.prototype.hasOwnProperty.call(primary, key)) raw = primary[key]
    else if (Object.prototype.hasOwnProperty.call(fallback, key)) raw = fallback[key]
    else {
      missing.add(key)
      return key
    }
    return interpolate(raw, vars)
  }

  return {
    locale,
    t,
    has,
    /** Keys that were asked for but exist in neither dictionary. */
    missing: () => Array.from(missing).sort(),
    /** Number of keys in each dictionary, handy for a startup log line. */
    stats: () => ({ locale, keys: Object.keys(primary).length, fallbackKeys: Object.keys(fallback).length }),
    /** Merged flat dictionary (primary wins) — what renderers get over IPC. */
    dict: () => Object.assign({}, fallback, primary),
  }
}

/** Keys only in A / only in B / both. Used by the checker to keep locales in sync. */
function keyDiff(a, b) {
  const left = new Set(Object.keys(flatten(a)))
  const right = new Set(Object.keys(flatten(b)))
  const onlyA = Array.from(left).filter((k) => !right.has(k)).sort()
  const onlyB = Array.from(right).filter((k) => !left.has(k)).sort()
  const common = Array.from(left).filter((k) => right.has(k)).sort()
  return { onlyA, onlyB, common }
}

/** Pick the best locale from an OS tag: `zh-CN` → `zh-CN`, `zh` → `zh-CN`, else fallback. */
function matchLocale(tag, available = [DEFAULT_LOCALE]) {
  const raw = String(tag || '').replace('_', '-')
  const list = Array.isArray(available) && available.length ? available : [DEFAULT_LOCALE]
  if (list.includes(raw)) return raw
  const lower = raw.toLowerCase()
  const exact = list.find((l) => l.toLowerCase() === lower)
  if (exact) return exact
  const sameLanguage = list.find((l) => l.toLowerCase().split('-')[0] === lower.split('-')[0])
  if (sameLanguage) return sameLanguage
  return list.includes(FALLBACK_LOCALE) ? FALLBACK_LOCALE : list[0]
}


/**
 * P2-6 阶段五：时间按语言习惯排。zh 用 24 小时制，en 用 12 小时制 + AM/PM。
 * 只做“显示”，不碰存储：日志、CSV 里的时间永远是 24 小时制，免得导出文件跟着界面语言变。
 */
function formatClock(ts, style, t) {
  const n = Number(ts)
  if (!Number.isFinite(n) || n <= 0) return ''
  const d = new Date(n)
  const mm = String(d.getMinutes()).padStart(2, '0')
  if (String(style) !== '12h') return String(d.getHours()).padStart(2, '0') + ':' + mm
  const hour12 = d.getHours() % 12 || 12
  const suffix = typeof t === 'function' ? t(d.getHours() < 12 ? 'date.am' : 'date.pm') : (d.getHours() < 12 ? 'AM' : 'PM')
  return hour12 + ':' + mm + ' ' + suffix
}
module.exports = { DEFAULT_LOCALE, FALLBACK_LOCALE, flatten, interpolate, createI18n, keyDiff, matchLocale, formatClock }