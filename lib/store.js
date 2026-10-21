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
const DEFAULT_PHRASES = [
  '记得喝口水呀，我在这儿等你～',
  '坐太久啦，站起来伸个懒腰吧',
  '眼睛累累的吧？看看窗外歇一歇～',
  '摸摸头，今天也辛苦你啦',
  '有没有好好吃饭呀？不许糊弄我',
  '深呼吸三次，把烦恼呼出去～',
  '偷偷告诉你：我很喜欢你哦',
  '肩膀放松一点，别绷着啦',
  '困了就眯一会儿吧，我帮你看时间～',
  '想你了，就点开我看看天气吧',
  '今天也要对自己好一点点哦',
  '手凉的宝宝，去接杯热水吧',
  '心情不好的话，先吃点甜的？',
  '别熬夜啦，早点睡好不好嘛',
  '站直一点点，你最好看的样子就是这样呀',
  '记得眨眨眼睛呀，屏幕看久了会干干的',
  '有没有穿够衣服呀，别着凉了',
  '加油，我在这里陪着你呢',
  '休息五分钟，回来会更厉害哦',
  '偷偷夸你一句：你真的超棒哦',
  '要不要一起听首歌放松一下？',
  '慢一点也没关系呀，我等你',
  '今天喝了几杯水呀？快汇报～',
  '再忙也要记得笑一笑呀',
]

const DEFAULT_SETTINGS = {
  version: 1,
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
        settingsCache = merge(DEFAULT_SETTINGS, readJson(settingsFile, {}))
        settingsStamp = stamp
      }
    }
    return settingsCache
  }

  function writeSettings(patch) {
    const merged = merge(readSettings(), patch || {})
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
}
