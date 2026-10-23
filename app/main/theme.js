'use strict'
// Theme pack loading + IPC (ROADMAP P2-7).
//
// Built-in packs live in `themes/<id>/theme.json`. User imports go to
// `<dataDir>/themes/<id>/theme.json`; that folder wins so an import can shadow a
// built-in id without touching the install directory (portable exe is read-only).

const fs = require('fs')
const path = require('path')
const { validateTheme, tokensToCss } = require('../../lib/theme')

const DEFAULT_ID = 'default'

function listDirs(root) {
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  } catch (err) {
    return []
  }
}

function readPack(dir, id) {
  try {
    const file = path.join(dir, id, 'theme.json')
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    const res = validateTheme(raw)
    if (!res.ok) return { id, ok: false, errors: res.errors }
    // The folder name is the identity; a pack cannot claim another id.
    if (res.theme.id !== id) return { id, ok: false, errors: ['id-folder-mismatch'] }
    return { id, ok: true, theme: res.theme, file }
  } catch (err) {
    return { id, ok: false, errors: ['unreadable'] }
  }
}

function createThemes({ builtinDir, userDir, log }) {
  function dirs() {
    return [userDir, builtinDir].filter(Boolean)
  }

  /** All packs, user folder first (it shadows same-id built-ins). */
  function list() {
    const seen = new Set()
    const out = []
    for (const dir of dirs()) {
      for (const id of listDirs(dir).sort()) {
        if (seen.has(id)) continue
        seen.add(id)
        const pack = readPack(dir, id)
        out.push({
          id,
          ok: pack.ok,
          nameKey: pack.ok ? pack.theme.nameKey : 'theme.' + id,
          count: pack.ok ? Object.keys(pack.theme.tokens).length : 0,
          errors: pack.ok ? [] : pack.errors,
          source: dir === userDir ? 'user' : 'builtin',
        })
      }
    }
    return out
  }

  /** Tokens for one theme id (falls back to the default pack). */
  function get(id) {
    const want = typeof id === 'string' && id ? id : DEFAULT_ID
    for (const dir of dirs()) {
      const pack = readPack(dir, want)
      if (pack.ok) return { id: want, tokens: pack.theme.tokens, ok: true, errors: [] }
      if (pack.errors && pack.errors[0] !== 'unreadable') {
        log && log('theme-invalid', want, pack.errors.join(','))
        return { id: want, tokens: {}, ok: false, errors: pack.errors }
      }
    }
    if (want !== DEFAULT_ID) return get(DEFAULT_ID)
    return { id: DEFAULT_ID, tokens: {}, ok: true, errors: [] }
  }

  /** `:root{…}` string for injecting into a renderer. */
  function css(id) {
    return tokensToCss(get(id).tokens)
  }

  return { DEFAULT_ID, list, get, css }
}

/** IPC. main.js passes `onChange` to re-inject CSS into every open window. */
function registerThemeIpc({ ipcMain, themes, store, onChange }) {
  const currentId = () => store.readSettings().theme || themes.DEFAULT_ID

  ipcMain.handle('theme:list', () => ({ current: currentId(), packs: themes.list() }))

  ipcMain.handle('theme:current', () => {
    const id = currentId()
    const got = themes.get(id)
    return { id, tokens: got.tokens, ok: got.ok, errors: got.errors, css: themes.css(id) }
  })

  ipcMain.handle('theme:set', (ev, id) => {
    const want = typeof id === 'string' && id ? id : themes.DEFAULT_ID
    const known = themes.list().some((p) => p.id === want && p.ok)
    if (!known) return { ok: false, error: 'unknown-theme', id: want }
    const s = store.readSettings()
    store.writeSettings(Object.assign({}, s, { theme: want }))
    if (onChange) onChange(want)
    return { ok: true, id: want }
  })
}

module.exports = { createThemes, registerThemeIpc, DEFAULT_ID }