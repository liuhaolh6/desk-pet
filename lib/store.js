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
const { DEFAULT_SOUND } = require('../app/sound-model.js')

/**
 * 24 条内置温馨提示：说话的人是桌宠（用小芳的口吻），听的人是屏幕前的你。
 * 温柔、活泼、有点俏皮；不评判、不催促、不说教。
 */
// P2-6 阶段三-M：内置短语不再写死在代码里，改由语言包 bubble.phrasesSeed 提供；
// 用户自己的短语仍存在 settings 里（为空 = 用语言包的种子）。
const DEFAULT_PHRASES = []

/** P1-5: how many drink timestamps to keep in settings.json. */
const WATER_LOG_MAX = 500

const DEFAULT_SETTINGS = {
  version: 1,
  /** 界面语言；空串 = 跟随系统（P2-6）。见 locales/*.json。 */
  locale: '',
  /** Shown in the bubble signature, tray tooltip and about panel. */
  name: '小芳',
  /** Pet box edge in CSS pixels. */
  size: 220,
  /** quiet: no reminders, normal: default cadence, chatty: allow small talk. */
  mode: 'normal',
  /** Top-left of the pet box on screen; null = bottom-right of the work area. */
  position: null,
  alwaysOnTop: true,
  autostart: false,
  /** Magnetic edges while dragging; gap is in CSS pixels. */
  snap: { enabled: true, gap: 18 },
  sound: { ...DEFAULT_SOUND },
  weather: {
    lat: null,
    lon: null,
    city: '',
    label: '自动定位',
    refreshMinutes: 15,
    /** Recently picked cities (P1-4), newest first, at most 5. */
    recent: [],
  },
  water: {
    intervalMinutes: 60,
    quietFrom: 23,
    quietTo: 8,
    /** One cup, in millilitres; only used for the CSV export (P1-5). */
    cupMl: 200,
    lastDrinkAt: 0,
    /** Timestamp until which the water reminder stays quiet (P1-5). */
    snoozeUntil: 0,
    /** Newest N drink timestamps, oldest first (P1-5). */
    log: [],
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
  /**
   * False until the first-run welcome card is dismissed (M17 P0-1). A missing
   * key in an old settings.json reads as false, so upgraders see the card once;
   * dismissing it writes true.
   */
  onboarded: false,
  // ROADMAP P1-7：主动说话。三个触发器各自可关，阈值默认值见 lib/nudges.js。
  nudge: { enabled: true, longUse: true, lateNight: true, away: true },
  // ROADMAP P2-3：更新检查。feedUrl 留空时用 app/main/updater.js 里的默认地址
  // （raw.githubusercontent 上的 update.json）；installUpdates 只有签名发布才能开。
  update: {
    feedUrl: '',
    checkOnBoot: true,
    installUpdates: false,
    lastCheckAt: 0,
    lastVersion: '',
    skippedVersion: '',
  },
}

const DEFAULT_ROLES = {
  version: 1,
  roles: [{ id: 'default', name: '我', builtin: true, createdAt: 0 }],
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
  const soundsFile = path.join(base, 'sounds.json')
  const soundsDir = path.join(base, 'sounds')

  // readSettings() runs on every drag/bubble frame, so the parsed+merged object
  // is cached. The cache is invalidated by writeSettings() and re-validated
  // against the file's mtime at most once a second (so editing settings.json by
  // hand while the app runs is still picked up).
  let settingsCache = null
  let settingsStamp = ''
  let settingsCheckedAt = 0

  function settingsFileStamp() {
    try {
      const st = fs.statSync(settingsFile)
      return st.mtimeMs + ':' + st.size
    } catch (err) {
      return ''
    }
  }

  function readSettings() {
    const now = Date.now()
    if (!settingsCache || now - settingsCheckedAt > 1000) {
      settingsCheckedAt = now
      const stamp = settingsFileStamp()
      if (!settingsCache || stamp !== settingsStamp) {
        settingsCache = normalizeWater(normalizeRecent(merge(DEFAULT_SETTINGS, readJson(settingsFile, {}))))
        settingsStamp = stamp
      }
    }
    return settingsCache
  }

  /**
   * P1-4: the recent-city list comes from clicks, but it can also be typed by
   * hand in settings.json — keep it short, unique and in order either way.
   */
  function normalizeRecent(settings) {
    const weather = settings && settings.weather
    if (!weather) return settings
    const seen = new Set()
    const list = []
    for (const item of Array.isArray(weather.recent) ? weather.recent : []) {
      const name = typeof item === 'string' ? item.trim() : ''
      if (!name || seen.has(name)) continue
      seen.add(name)
      list.push(name)
      if (list.length === 5) break
    }
    weather.recent = list
    return settings
  }

  /**
   * P1-5: the drink log also comes from hand-edited settings.json — keep it
   * sorted, numeric, and bounded (the file is rewritten on every sip).
   */
  function normalizeWater(settings) {
    const w = settings && settings.water
    if (!w) return settings
    const list = []
    for (const item of Array.isArray(w.log) ? w.log : []) {
      const at = Number(item && item.at)
      if (!Number.isFinite(at) || at <= 0) continue
      const ml = Number(item && item.ml)
      list.push({ at: Math.floor(at), ml: Number.isFinite(ml) && ml > 0 ? Math.min(2000, Math.floor(ml)) : 0 })
    }
    list.sort((a, b) => a.at - b.at)
    w.log = list.slice(-WATER_LOG_MAX)
    w.cupMl = Math.max(50, Math.min(1000, Number(w.cupMl) || 200))
    const snooze = Number(w.snoozeUntil)
    w.snoozeUntil = Number.isFinite(snooze) && snooze > 0 ? Math.floor(snooze) : 0
    return settings
  }

  function writeSettings(patch) {
    const merged = normalizeWater(normalizeRecent(merge(readSettings(), patch || {})))
    merged.version = DEFAULT_SETTINGS.version
    writeJson(settingsFile, merged)
    settingsCache = merged
    settingsStamp = settingsFileStamp()
    settingsCheckedAt = Date.now()
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

  /**
   * Adds a role from raw PNG bytes; returns the new index entry.
   * `meta.cutout` records whether the image really went through segmentation
   * (false = "scale only" fallback, shown as "未抠图" in the role gallery).
   */
  function addRole(name, bytes, meta) {
    const id = 'r' + Date.now().toString(36)
    fs.mkdirSync(rolesDir, { recursive: true })
    fs.writeFileSync(path.join(rolesDir, id + '.png'), bytes)
    const index = readRoles()
    const entry = { id, name: String(name || '新角色').slice(0, 30), createdAt: Date.now() }
    if (meta && typeof meta === 'object') {
      if (meta.cutout !== undefined) entry.cutout = !!meta.cutout
      if (meta.mode) entry.mode = String(meta.mode).slice(0, 16)
    }
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

  // ---- imported sound fragments ------------------------------------------
  function readSounds() {
    const index = readJson(soundsFile, { version: 1, files: [] })
    const files = Array.isArray(index.files) ? index.files : []
    return { version: 1, files }
  }

  function writeSounds(index) {
    writeJson(soundsFile, index)
  }

  function soundPath(id) {
    const safe = normalizeRoleId(id)
    if (!safe) return ''
    const entry = readSounds().files.find((f) => f.id === safe)
    if (!entry) return ''
    return path.join(soundsDir, safe + '.' + entry.ext)
  }

  function addSound(name, ext, bytes) {
    const safeExt = String(ext || 'wav').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'wav'
    const id = 's' + Date.now().toString(36)
    fs.mkdirSync(soundsDir, { recursive: true })
    fs.writeFileSync(path.join(soundsDir, id + '.' + safeExt), bytes)
    const index = readSounds()
    const entry = { id, name: String(name || '音效').slice(0, 30), ext: safeExt, createdAt: Date.now() }
    index.files.push(entry)
    writeSounds(index)
    return entry
  }

  function deleteSound(id) {
    const safe = normalizeRoleId(id)
    if (!safe) return { ok: false, error: 'bad id' }
    const index = readSounds()
    const entry = index.files.find((f) => f.id === safe)
    if (!entry) return { ok: false, error: 'not found' }
    index.files = index.files.filter((f) => f.id !== safe)
    writeSounds(index)
    try { fs.unlinkSync(path.join(soundsDir, safe + '.' + entry.ext)) } catch (err) {}
    return { ok: true }
  }

  function writeWeatherCache(value) {
    writeJson(cacheFile, value)
  }

  return {
    dir: base,
    /** Immutable copy of the built-in defaults, for “恢复默认”. */
    defaults: () => JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
    readSettings,
    writeSettings,
    readRoles,
    writeRoles,
    roleImagePath,
    addRole,
    deleteRole,
    readWeatherCache,
    writeWeatherCache,
    readSounds,
    addSound,
    deleteSound,
    soundPath,
  }
}

module.exports = {
  createStore,
  merge,
  normalizeRoleId,
  DEFAULT_SETTINGS,
  DEFAULT_ROLES,
  DEFAULT_PHRASES,
  WATER_LOG_MAX,
}
