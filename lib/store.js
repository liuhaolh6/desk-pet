/**
 * Persistent store for desk-pet (CommonJS so Electron main can require it).
 *
 * Everything lives in a directory supplied by the caller (Electron passes
 * app.getPath('userData')); tests pass a temp dir, so nothing here depends on
 * Electron being present.
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const DEFAULT_PHRASES = [
  '记得喝口水呀～',
  '久坐啦，起来动一动',
  '眼睛累了就看看远处',
  '今天也要好好吃饭哦',
  '有我在，别太拼',
  '深呼吸三次，放松一下',
]

const DEFAULT_SETTINGS = {
  version: 1,
  /** Shown in the bubble signature, tray tooltip and about panel. */
  name: '小芳桌宠',
  /** Pet box edge in CSS pixels. */
  size: 220,
  /** quiet: no reminders, normal: default cadence, chatty: allow small talk. */
  mode: 'normal',
  /** Top-left of the pet box on screen; null = bottom-right of the work area. */
  position: null,
  alwaysOnTop: true,
  autostart: false,
  sound: { enabled: true, volume: 0.45 },
  weather: {
    lat: null,
    lon: null,
    city: '',
    label: '自动定位',
    refreshMinutes: 15,
  },
  water: {
    intervalMinutes: 60,
    quietFrom: 23,
    quietTo: 8,
    lastDrinkAt: 0,
    today: { date: '', cups: 0 },
  },
  bubble: {
    autoHideSeconds: 20,
    cooldownMinutes: 30,
    queue: ['weather', 'water', 'random'],
    phrases: DEFAULT_PHRASES,
    lastWeatherShownAt: 0,
  },
  roleId: 'default',
}

const DEFAULT_ROLES = {
  version: 1,
  roles: [{ id: 'default', name: '默认角色', builtin: true, createdAt: 0 }],
}

function merge(base, incoming) {
  const out = Array.isArray(base) ? base.slice() : Object.assign({}, base)
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return out
  for (const key of Object.keys(incoming)) {
    const value = incoming[key]
    if (value === undefined) continue
    if (
      value && typeof value === 'object' && !Array.isArray(value) &&
      out[key] && typeof out[key] === 'object' && !Array.isArray(out[key])
    ) {
      out[key] = merge(out[key], value)
    } else {
      out[key] = value
    }
  }
  return out
}

function readJson(file, fallback) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (parsed && typeof parsed === 'object') return parsed
  } catch (err) {}
  return fallback
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = file + '.tmp-' + process.pid + '-' + Date.now()
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
  fs.renameSync(tmp, file)
}

function normalizeRoleId(raw) {
  const id = String(raw || '').trim()
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) return ''
  return id
}

function createStore(dir) {
  const base = path.resolve(dir)
  const settingsFile = path.join(base, 'settings.json')
  const rolesFile = path.join(base, 'roles.json')
  const cacheFile = path.join(base, 'weather-cache.json')
  const rolesDir = path.join(base, 'roles')

  function readSettings() {
    return merge(DEFAULT_SETTINGS, readJson(settingsFile, {}))
  }

  function writeSettings(patch) {
    const merged = merge(readSettings(), patch || {})
    merged.version = DEFAULT_SETTINGS.version
    writeJson(settingsFile, merged)
    return merged
  }

  function readRoles() {
    const index = readJson(rolesFile, DEFAULT_ROLES)
    const roles = Array.isArray(index.roles) ? index.roles : []
    if (!roles.some((r) => r && r.id === 'default')) roles.unshift(DEFAULT_ROLES.roles[0])
    return { version: 1, roles }
  }

  function writeRoles(index) {
    writeJson(rolesFile, index)
  }

  function roleImagePath(id) {
    const safe = normalizeRoleId(id)
    if (!safe || safe === 'default') return ''
    return path.join(rolesDir, safe + '.png')
  }

  /** Adds a role from raw PNG bytes; returns the new index entry. */
  function addRole(name, bytes) {
    const id = 'r' + Date.now().toString(36)
    fs.mkdirSync(rolesDir, { recursive: true })
    fs.writeFileSync(path.join(rolesDir, id + '.png'), bytes)
    const index = readRoles()
    const entry = { id, name: String(name || '新角色').slice(0, 30), createdAt: Date.now() }
    index.roles.push(entry)
    writeRoles(index)
    return entry
  }

  function deleteRole(id) {
    const safe = normalizeRoleId(id)
    if (!safe || safe === 'default') return { ok: false, error: 'bad id' }
    const index = readRoles()
    const before = index.roles.length
    index.roles = index.roles.filter((r) => r.id !== safe)
    if (index.roles.length === before) return { ok: false, error: 'not found' }
    writeRoles(index)
    try { fs.unlinkSync(path.join(rolesDir, safe + '.png')) } catch (err) {}
    return { ok: true }
  }

  function readWeatherCache() {
    return readJson(cacheFile, null)
  }

  function writeWeatherCache(value) {
    writeJson(cacheFile, value)
  }

  return {
    dir: base,
    readSettings,
    writeSettings,
    readRoles,
    writeRoles,
    roleImagePath,
    addRole,
    deleteRole,
    readWeatherCache,
    writeWeatherCache,
  }
}

module.exports = {
  createStore,
  merge,
  normalizeRoleId,
  DEFAULT_SETTINGS,
  DEFAULT_ROLES,
  DEFAULT_PHRASES,
}
