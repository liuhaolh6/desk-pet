/**
 * P2-4 privacy transparency: tell the user exactly what is on disk and what
 * leaves the machine, and let them wipe the throwaway parts in one click.
 *
 * Rules that keep this honest:
 * - The summary is computed from the real files, never from a hard-coded list
 *   of "typical" sizes, so a stale doc can't disagree with the UI.
 * - cleanup() only removes rebuildable junk (logs, traces, Chromium caches).
 *   settings.json, roles/ and photos/ are user data and are never touched.
 * - Nothing here writes to the network; the "endpoints" list is descriptive.
 */
'use strict'

const NETWORK_ENDPOINTS = [
  { id: 'geocode', host: 'geocoding-api.open-meteo.com' },
  { id: 'forecast', host: 'api.open-meteo.com' },
  { id: 'air', host: 'air-quality-api.open-meteo.com' },
  { id: 'update', host: 'raw.githubusercontent.com' },
  { id: 'github', host: 'github.com' },
]

const CACHE_DIRS = [
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'ShaderCache',
  'GrShaderCache',
  'Local Storage',
  'Session Storage',
  'blob_storage',
  'Service Worker',
]

function createPrivacy({ dir, fs, path, log , t }) {
  const tr = (key) => (typeof t === 'function' ? t(key) : key)
  function sizeOf(target) {
    let stat
    try {
      stat = fs.lstatSync(target)
    } catch {
      return 0
    }
    if (stat.isFile()) return stat.size
    if (!stat.isDirectory()) return 0
    let total = 0
    let names = []
    try {
      names = fs.readdirSync(target)
    } catch {
      return 0
    }
    for (const name of names) total += sizeOf(path.join(target, name))
    return total
  }

  function countFiles(target, filter) {
    let names = []
    try {
      names = fs.readdirSync(target)
    } catch {
      return 0
    }
    return names.filter((name) => (filter ? filter(name) : true)).filter((name) => {
      try {
        return fs.lstatSync(path.join(target, name)).isFile()
      } catch {
        return false
      }
    }).length
  }

  function summary() {
    const settingsFile = path.join(dir, 'settings.json')
    const settingsBytes = sizeOf(settingsFile)
    const photosDir = path.join(dir, 'photos')
    const rolesDir = path.join(dir, 'roles')
    const traceFile = path.join(dir, 'cutout-trace.jsonl')
    const logFile = path.join(dir, 'app.log')
    const caches = CACHE_DIRS.map((name) => ({ name, bytes: sizeOf(path.join(dir, name)) })).filter((c) => c.bytes > 0)

    return {
      dir,
      files: {
        settings: { bytes: settingsBytes },
        photos: { count: countFiles(photosDir), bytes: sizeOf(photosDir) },
        roles: { count: countFiles(rolesDir), bytes: sizeOf(rolesDir) },
        log: { bytes: sizeOf(logFile) },
        trace: { bytes: sizeOf(traceFile) },
        caches: { count: caches.length, bytes: caches.reduce((sum, c) => sum + c.bytes, 0) },
      },
      junkBytes: sizeOf(logFile) + sizeOf(traceFile) + caches.reduce((sum, c) => sum + c.bytes, 0),
      endpoints: NETWORK_ENDPOINTS.map((e) => ({ host: e.host, what: tr('privacy.net.' + e.id + '.what'), when: tr('privacy.net.' + e.id + '.when') })),
    }
  }

  async function cleanup() {
    const removed = []
    for (const name of ['app.log', 'cutout-trace.jsonl']) {
      const target = path.join(dir, name)
      try {
        if (fs.existsSync(target)) {
          await fs.promises.rm(target, { force: true })
          removed.push(name)
        }
      } catch (err) {
        log('privacy cleanup failed', name, String(err))
      }
    }
    for (const name of CACHE_DIRS) {
      const target = path.join(dir, name)
      let entries = []
      try {
        entries = await fs.promises.readdir(target)
      } catch {
        continue
      }
      for (const entry of entries) {
        try {
          await fs.promises.rm(path.join(target, entry), { recursive: true, force: true })
          removed.push(`${name}/${entry}`)
        } catch (err) {
          log('privacy cleanup failed', `${name}/${entry}`, String(err))
        }
      }
      // Chromium 会在原地重建目录；目录本身留着，省得它下次启动再建一遍
      // 却因为权限/占用报错。
    }
    const after = summary()
    return { removed: removed.length, junkBytes: after.junkBytes, files: after.files }
  }

  return { summary, cleanup }
}

module.exports = { createPrivacy, NETWORK_ENDPOINTS, CACHE_DIRS }