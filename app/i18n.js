'use strict'

/**
 * Renderer-side i18n (P2-6).
 *
 * The main process owns the dictionary and the preload bridge (`deskPet.i18n`)
 * hands the page a ready `t()` synchronously, before the first paint. This file
 * adds the two pieces the pages need on top of that:
 *
 *   - `applyStatic(doc, i18n)` — translate the markup once, from `data-i18n*`
 *     attributes, so HTML never carries copy of its own;
 *   - `create(dict, locale)` — the same `t()` for code that only has a plain
 *     dictionary (tests, tools, the preload bridge in Node-based smoke runs).
 *
 * Missing keys return the key itself in both cases, which is what makes an
 * untranslated string visible instead of blank.
 *
 * Works both ways: CommonJS (`require`) and a plain `<script>` tag that defines
 * `window.deskPetI18n`.
 */

function interpolate(template, vars) {
  if (!vars) return template
  return String(template).replace(/\{(\w+)\}/g, (whole, name) => (
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole
  ))
}

/**
 * @param {object} dict  flat `key → string` (already merged with the fallback)
 * @param {string} [locale]
 */
function create(dict, locale) {
  const table = dict && typeof dict === 'object' ? dict : {}
  function t(key, vars) {
    const raw = Object.prototype.hasOwnProperty.call(table, key) ? table[key] : key
    return interpolate(raw, vars)
  }
  return { locale: locale || 'zh-CN', t, has: (key) => Object.prototype.hasOwnProperty.call(table, key) }
}

/**
 * Attribute translations. Keep this list short and mechanical: a new kind of
 * copy in the markup should reuse one of these, not invent a convention.
 */
const ATTRS = [
  ['data-i18n-title', 'title'],
  ['data-i18n-aria-label', 'aria-label'],
  ['data-i18n-placeholder', 'placeholder'],
  ['data-i18n-alt', 'alt'],
]

/**
 * Translate a parsed document (or any subtree) in place.
 *
 *   <title data-i18n="pet.title"></title>
 *   <button data-i18n="menu.settings" data-i18n-title="menu.settings.hint"></button>
 *   <p data-i18n-html="settings.privacy.body"></p>   ← only for copy with links/bold
 *
 * @param {Document|Element} root document or the subtree to translate
 * @param {object|Function} bridge `{ t, locale }` (from the preload) or a bare `t`
 * @returns {number} how many nodes were touched (0 = nothing to translate)
 */
function applyStatic(root, bridge) {
  const doc = root && typeof root.querySelectorAll === 'function' ? root : null
  if (!doc) return 0
  const t = typeof bridge === 'function' ? bridge : (bridge && bridge.t)
  if (typeof t !== 'function') return 0
  const locale = typeof bridge === 'function' ? '' : (bridge && bridge.locale)
  let count = 0

  for (const node of doc.querySelectorAll('[data-i18n]')) {
    const key = node.getAttribute('data-i18n')
    if (!key) continue
    node.textContent = t(key)
    count += 1
  }
  // Rich copy (a sentence with a <strong> or a link inside) cannot be a
  // textContent assignment. Locale files are ours, not user input.
  for (const node of doc.querySelectorAll('[data-i18n-html]')) {
    const key = node.getAttribute('data-i18n-html')
    if (!key) continue
    node.innerHTML = t(key)
    count += 1
  }
  for (const [dataAttr, attr] of ATTRS) {
    for (const node of doc.querySelectorAll('[' + dataAttr + ']')) {
      const key = node.getAttribute(dataAttr)
      if (!key) continue
      node.setAttribute(attr, t(key))
      count += 1
    }
  }

  // The document language is what screen readers and font fallback follow.
  const html = doc.documentElement || (doc.tagName === 'HTML' ? doc : null)
  if (html && locale) html.lang = locale
  return count
}

const api = { create, interpolate, applyStatic }

if (typeof module === 'object' && module.exports) module.exports = api
else if (typeof globalThis !== 'undefined') globalThis.deskPetI18n = api