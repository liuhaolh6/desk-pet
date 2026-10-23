'use strict'
/**
 * P1-1 阶段 4：角色/声音的“目录”与广播。
 *
 * 这两件事一直绑在一起：渲染层要的是 `{ id, name, url }` 这种可直接放进
 * `<img>`/`<audio>` 的条目，而 url 属于自定义协议（`pet-role://`、`pet-sound://`），
 * 协议的实现又只依赖 store。所以放在同一个模块里，`main.js` 只注册一次。
 */

const path = require('node:path')

function createCatalog(deps) {
  const { fs, store, assets, BrowserWindow, trayHost } = deps

  function roleUrl(id) {
    if (!id || id === 'default') return 'pet-role://default/'
    return 'pet-role://role/' + encodeURIComponent(id)
  }

  function handleRoleProtocol(request) {
    try {
      const url = new URL(request.url)
      let bytes = null
      if (url.hostname === 'default') {
        bytes = fs.readFileSync(path.join(assets, 'default.png'))
      } else if (url.hostname === 'role') {
        const id = decodeURIComponent(url.pathname.replace(/^\//, ''))
        const file = store.roleImagePath(id)
        if (file) bytes = fs.readFileSync(file)
      }
      if (!bytes) return new Response('not found', { status: 404 })
      return new Response(bytes, { headers: { 'content-type': 'image/png' } })
    } catch (err) {
      return new Response('error', { status: 500 })
    }
  }

  function handleSoundProtocol(request) {
    try {
      const url = new URL(request.url)
      if (url.hostname !== 'sound') return new Response('not found', { status: 404 })
      const id = decodeURIComponent(url.pathname.replace(/^\//, ''))
      const file = store.soundPath(id)
      if (!file) return new Response('not found', { status: 404 })
      const bytes = fs.readFileSync(file)
      const ext = file.split('.').pop().toLowerCase()
      const type = {
        wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac',
      }[ext] || 'application/octet-stream'
      return new Response(bytes, { headers: { 'content-type': type } })
    } catch (err) {
      return new Response('error', { status: 500 })
    }
  }

  function roleList() {
    const index = store.readRoles()
    return index.roles.map((r) => ({
      id: r.id,
      name: r.name || r.id,
      builtin: !!r.builtin,
      url: roleUrl(r.id),
      // null = legacy/imported role without a cutout verdict; false = saved
      // through the "scale only" fallback and must be shown as not cut out.
      cutout: r.cutout === undefined ? null : !!r.cutout,
      mode: r.mode || null,
    }))
  }

  function soundList() {
    return store.readSounds().files.map((f) => ({
      id: f.id,
      name: f.name || f.id,
      ext: f.ext,
      url: 'pet-sound://sound/' + encodeURIComponent(f.id),
    }))
  }

  function sendAll(channel, payload) {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(channel, payload)
    }
    return payload
  }

  function broadcastSettings() {
    const settings = sendAll('settings:changed', store.readSettings())
    if (trayHost) trayHost.setTooltip(settings.name)
    return settings
  }

  function broadcastRoles() {
    return sendAll('roles:changed', roleList())
  }

  return {
    roleUrl,
    roleList,
    soundList,
    handleRoleProtocol,
    handleSoundProtocol,
    broadcastSettings,
    broadcastRoles,
  }
}

module.exports = { createCatalog }