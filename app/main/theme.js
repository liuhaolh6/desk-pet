'use strict'
// Theme pack loading + IPC (ROADMAP P2-7).
//
// Built-in packs live in `themes/<id>/theme.json`. User imports go to
// `<dataDir>/themes/<id>/theme.json`; that folder wins so an import can shadow a
// built-in id without touching the install directory (portable exe is read-only).

const fs = require('fs')
const path = require('path')
const { validateTheme, tokensToCss } = require('../../lib/theme')
const { readZip, writeZip, idFromFileName } = require('../../lib/theme-zip')

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

  return { DEFAULT_ID, list, get, css, builtinDir, userDir }
}

/** IPC. main.js passes `onChange` to re-inject CSS into every open window. */
function registerThemeIpc({ ipcMain, themes, store, onChange, dialog, userDir, log }) {
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

  // Import a user pack from a .zip: `<id>/theme.json` or a `theme.json` at the root.
  ipcMain.handle('theme:import', async (ev, maybePath) => {
    let file = typeof maybePath === 'string' && maybePath ? maybePath : ''
    if (!file) {
      if (!dialog) return { ok: false, error: 'no-dialog' }
      const picked = await dialog.showOpenDialog({
        title: 'Import theme pack',
        properties: ['openFile'],
        filters: [{ name: 'Theme pack', extensions: ['zip'] }],
      })
      if (picked.canceled || !picked.filePaths.length) return { canceled: true }
      file = picked.filePaths[0]
    }
    if (!userDir) return { ok: false, error: 'no-user-dir' }
    let entries
    try {
      entries = readZip(fs.readFileSync(file))
    } catch (err) {
      return { ok: false, error: 'bad-zip' }
    }
    const entry = entries.find((e) => /(^|\/)theme\.json$/i.test(e.name))
    if (!entry) return { ok: false, error: 'no-theme-json' }
    let raw
    try {
      raw = JSON.parse(entry.data.toString('utf8'))
    } catch (err) {
      return { ok: false, error: 'bad-json' }
    }
    const res = validateTheme(raw)
    if (!res.ok) return { ok: false, error: 'invalid', errors: res.errors }
    // The file name wins when the pack does not name itself; either way the id
    // must be safe because it becomes a folder name.
    const id = idFromFileName(raw && raw.id) || idFromFileName(path.basename(file))
    if (!id) return { ok: false, error: 'bad-id' }
    try {
      const dir = path.join(userDir, id)
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'theme.json'), JSON.stringify(Object.assign({}, raw, { id }), null, 2) + '\n')
    } catch (err) {
      return { ok: false, error: 'write-failed' }
    }
    log && log('theme-import', id)
    return { ok: true, id }
  })

  // Export one pack as a zip with a single theme.json (round-trips with import).
  ipcMain.handle('theme:export', async (ev, maybeId, maybeFile) => {
    const id = typeof maybeId === 'string' && maybeId ? maybeId : currentId()
    let theme = null
    for (const dir of [userDir, themes.builtinDir].filter(Boolean)) {
      try {
        theme = JSON.parse(fs.readFileSync(path.join(dir, id, 'theme.json'), 'utf8'))
        break
      } catch (err) { /* try next root */ }
    }
    if (!theme) return { ok: false, error: 'unknown-theme' }
    // Explicit target path: used by the tests, and by anything that wants to
    // export without a dialog. Otherwise ask the user where to put it.
    let target = typeof maybeFile === 'string' && maybeFile ? maybeFile : ''
    if (!target) {
      if (!dialog) return { ok: false, error: 'no-dialog' }
      const picked = await dialog.showSaveDialog({
        title: 'Export theme pack',
        defaultPath: id + '.zip',
        filters: [{ name: 'Theme pack', extensions: ['zip'] }],
      })
      if (picked.canceled || !picked.filePath) return { canceled: true }
      target = picked.filePath
    }
    try {
      fs.writeFileSync(target, writeZip([{ name: 'theme.json', data: JSON.stringify(theme, null, 2) + '\n' }]))
    } catch (err) {
      return { ok: false, error: 'write-failed' }
    }
    log && log('theme-export', id)
    return { ok: true, id, file: target }
  })
}

module.exports = { createThemes, registerThemeIpc, DEFAULT_ID }