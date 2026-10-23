'use strict'

/**
 * Main-process i18n loader (P2-6).
 *
 * Reads `locales/<locale>.json` from the repo or from the packaged app
 * (`resources/app.asar/locales`), picks the locale from settings with an OS
 * fallback, and hands out a `t()` that falls back to `zh-CN` for missing keys.
 *
 * Everything here is failure-tolerant: a broken/absent locale file must never
 * stop the pet from starting, so load errors degrade to 「键名原样返回」.
 */

const fs = require('node:fs')
const path = require('node:path')
const { createI18n, matchLocale, DEFAULT_LOCALE } = require('../../lib/i18n')

const LOCALES_DIR = path.join(__dirname, '..', '..', 'locales')

function localesDir(dir) {
  return dir || LOCALES_DIR
}

/** Locale ids that actually have a JSON file, `zh-CN` first. */
function availableLocales(dir) {
  const root = localesDir(dir)
  let list = []
  try {
    list = fs.readdirSync(root).filter((f) => /^[a-zA-Z-]+\.json$/.test(f)).map((f) => f.replace(/\.json$/, ''))
  } catch (err) {
    list = []
  }
  if (!list.includes(DEFAULT_LOCALE)) list.push(DEFAULT_LOCALE)
  return list.sort((a, b) => (a === DEFAULT_LOCALE ? -1 : b === DEFAULT_LOCALE ? 1 : a.localeCompare(b)))
}

/** Parse one locale file; returns {} when it is missing or malformed. */
function loadDict(locale, dir) {
  const file = path.join(localesDir(dir), locale + '.json')
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (err) {
    return {}
  }
}

/**
 * @param {object} opts
 * @param {string} [opts.requested]  settings.locale ('' = follow the OS)
 * @param {string} [opts.system]     Electron app.getLocale(), e.g. 'zh-Hans-CN'
 * @param {string} [opts.dir]        override for tests
 * @param {Function} [opts.log]
 */
function createMainI18n({ requested = '', system = '', dir = '', log = () => {} } = {}) {
  const available = availableLocales(dir)
  const wanted = requested || system || DEFAULT_LOCALE
  const locale = matchLocale(wanted, available)
  const dict = loadDict(locale, dir)
  const fallbackDict = locale === DEFAULT_LOCALE ? dict : loadDict(DEFAULT_LOCALE, dir)
  const i18n = createI18n({ locale, dict, fallbackDict })
  const stats = i18n.stats()
  log('i18n locale=' + locale + ' (requested=' + (wanted || '-') + ', available=' + available.join('/') + ') keys=' + stats.keys + ' fallback=' + stats.fallbackKeys)
  // P2-6 阶段三-M：数组类内容（内置短语）不能走 flatten（那里只收字符串），单独给个取值口。
  const seedOf = (key) => {
    const walk = (obj, parts) => parts.reduce((acc, k) => (acc && typeof acc === 'object' ? acc[k] : undefined), obj)
    const got = walk(dict, key.split('.'))
    return Array.isArray(got) ? got : (Array.isArray(walk(fallbackDict, key.split('.'))) ? walk(fallbackDict, key.split('.')) : [])
  }
  return Object.assign(i18n, { available, requested: wanted, seedOf })
}


/**
 * IPC surface for the renderer (P2-6). Lives here rather than in `ipc.js` so the
 * channel table stays under its line budget, and because these two handlers only
 * ever touch the i18n instance.
 *
 * @param {object} deps
 * @param {import('electron').IpcMain} deps.ipcMain
 * @param {ReturnType<typeof createMainI18n>|null} deps.i18n
 */
function registerI18nIpc({ ipcMain, i18n }) {
  // The renderer gets the dictionary for the *current* locale; missing keys were
  // already merged with zh-CN on this side, so the page never needs the fallback.
  ipcMain.handle('i18n:info', () => (i18n
    ? { locale: i18n.locale, available: i18n.available, keys: i18n.stats().keys }
    : { locale: 'zh-CN', available: ['zh-CN'], keys: 0 }))
  ipcMain.handle('i18n:dict', () => (i18n ? i18n.dict() : {}))
  // P2-6: the preload bridge needs the dictionary *synchronously* — every window
  // otherwise paints Chinese for a frame before its async fetch resolves. This is
  // the only synchronous channel in the app; the payload is a few KB of JSON and
  // the listener is registered before any window loads (see main.js: the
  // registerI18nIpc call sits above windows.createPet).
  ipcMain.on('i18n:boot', (event) => {
    event.returnValue = i18n
      ? { locale: i18n.locale, available: i18n.available, dict: i18n.dict() }
      : { locale: 'zh-CN', available: ['zh-CN'], dict: {} }
  })
}

module.exports = { LOCALES_DIR, availableLocales, loadDict, createMainI18n, registerI18nIpc }