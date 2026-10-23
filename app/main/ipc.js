'use strict'
/**
 * P1-1 阶段 3：把 main.js 里的 IPC 注册整体搬出来。
 *
 * `registerIpc(deps)` 只做接线，所有状态都由依赖注入：主进程在 whenReady
 * 之后调一次即可。这样 smoke 能对"哪些通道存在、顺序对不对"做静态断言，
 * 也不用起 Electron。
 */

const { registerWaterIpc } = require('./water-ipc.js')

/**
 * @param {object} deps
 * @param {object} deps.ipcMain
 * @param {object} deps.dialog
 * @param {object} deps.shell
 * @param {object} deps.app
 * @param {object} deps.nativeImage
 * @param {object} deps.path
 * @param {object} deps.fs
 * @param {object} deps.store
 * @param {string} deps.version
 * @param {object} deps.weatherPump
 * @param {object} deps.layout
 * @param {object} deps.winState
 * @param {object} deps.trayHost
 * @param {object} deps.diagnostics
 * @param {object} deps.cutoutService
 * @param {object} deps.cutout   lib/cutout（scaleOnly 回退用）
 * @param {object} deps.placement   lib/placement
 * @param {Function} deps.clamp
 * @param {number} deps.winPad
 * @param {object} deps.windows     { pet, settings, editor, cutout } 返回当前窗口
 * @param {object} deps.actions     openSettings/openEditor/openCutout/openOnboard/dismissOnboard
 * @param {object} deps.lists       { roleList, soundList, roleUrl, broadcastSettings, broadcastRoles, sendMirror, applySettingsSideEffects }
 * @param {object} deps.nudges     createNudgePump 的实例（P1-7）
 * @param {Function} deps.setQuitting
 */
function registerIpc(deps) {
  const {
    ipcMain, dialog, shell, app, nativeImage, path, fs,
    store, version, weatherPump, layout, winState, trayHost, diagnostics, cutoutService, cutout, nudges,
    placement, clamp, winPad, windows, actions, lists, setQuitting,
  } = deps
  const { roleList, soundList, roleUrl, broadcastSettings, broadcastRoles, sendMirror, applySettingsSideEffects } = lists
  const MAX_IMAGE_BYTES = cutoutService.MAX_IMAGE_BYTES
  const log = deps.log || (() => {})

  // Visible-vs-reserved are two different questions. `pet:bubble` answers "is a
  // card up" (drives the state machine), `pet:reserve` only resizes the strip.
  // Conflating them made a pure re-measure send bubble-show while dragging.
  let bubbleVisible = false

  ipcMain.handle('state:get', () => ({
    settings: store.readSettings(),
    roles: roleList(),
    weather: weatherPump.current(),
    version,
    dataDir: store.dir,
  }))

  ipcMain.handle('app:status', () => ({
    version,
    electron: process.versions.electron,
    platform: process.platform,
    dataDir: store.dir,
    tray: trayHost.status(),
    // `isRegistered` re-reads the OS state instead of trusting the register()
    // return value, which is what a bug report should record.
    shortcut: trayHost.shortcutReport(),
    // P1-2: which interaction mode the pet is in, plus how many impossible
    // transitions were attempted since launch (a bug report should have both).
    window: { state: winState.state, illegal: winState.illegal, lastIllegal: winState.lastIllegal },
  }))

  // P1-4: “恢复这页默认”需要知道每个键的出厂值；只读、不带任何用户数据。
  ipcMain.handle('settings:defaults', () => store.defaults())

  ipcMain.handle('settings:set', (ev, patch) => {
    const prev = store.readSettings()
    const next = store.writeSettings(patch || {})
    applySettingsSideEffects(prev, next)
    broadcastSettings()
    if (patch && patch.weather) { weatherPump.refresh('settings'); weatherPump.schedule() }
    return next
  })

  ipcMain.handle('roles:list', () => roleList())

  ipcMain.handle('roles:import', async () => {
    const result = await dialog.showOpenDialog(windows.settings() || windows.pet(), {
      title: '挑一张图片当角色',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    })
    if (result.canceled || !result.filePaths || !result.filePaths[0]) return { ok: false, canceled: true }
    const file = result.filePaths[0]
    let image = nativeImage.createFromPath(file)
    if (image.isEmpty()) return { ok: false, error: '这张图打不开呢' }
    const size = image.getSize()
    const max = 610
    if (size.width > max || size.height > max) {
      const scale = Math.min(max / size.width, max / size.height)
      image = image.resize({ width: Math.round(size.width * scale), height: Math.round(size.height * scale), quality: 'best' })
    }
    const name = path.basename(file).replace(/\.[^.]+$/, '').slice(0, 30)
    const entry = store.addRole(name, image.toPNG())
    store.writeSettings({ roleId: entry.id })
    broadcastSettings()
    broadcastRoles()
    return { ok: true, role: entry, roles: roleList() }
  })

  ipcMain.handle('roles:delete', (ev, id) => {
    const result = store.deleteRole(id)
    const s = store.readSettings()
    if (result.ok && s.roleId === id) store.writeSettings({ roleId: 'default' })
    broadcastSettings()
    broadcastRoles()
    return Object.assign({}, result, { roles: roleList() })
  })

  // ---- photo cutout -------------------------------------------------------
  ipcMain.on('cutout:open', () => actions.openCutout())
  ipcMain.on('cutout:close', () => { const win = windows.cutout(); if (win) win.close() })

  ipcMain.handle('cutout:pick', async () => {
    const result = await dialog.showOpenDialog(windows.cutout() || windows.settings() || windows.pet(), {
      title: '挑一张人像照片',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    })
    if (result.canceled || !result.filePaths || !result.filePaths[0]) return { ok: false, canceled: true }
    const file = result.filePaths[0]
    let stat
    try { stat = fs.statSync(file) } catch (err) { return { ok: false, error: '找不到这个文件' } }
    if (stat.size > MAX_IMAGE_BYTES) return { ok: false, error: '图片超过 25MB 啦，先压缩一下好吗' }
    const image = nativeImage.createFromBuffer(fs.readFileSync(file))
    if (image.isEmpty()) return { ok: false, error: '这张图打不开呢' }
    const name = path.basename(file).replace(/\.[^.]+$/, '').slice(0, 30)
    return Object.assign({ ok: true }, cutoutService.inputPayload(image, name))
  })

  // Drag & drop: the file already lives in the renderer, so it arrives once and
  // is replaced by a token for every later call.
  ipcMain.handle('cutout:load', (ev, payload) => {
    let decoded
    try { decoded = cutoutService.decodeImageDataUrl(payload && payload.dataUrl) } catch (err) {
      return { ok: false, error: err.message }
    }
    const image = nativeImage.createFromBuffer(decoded.buffer)
    if (image.isEmpty()) return { ok: false, error: '这张图打不开呢' }
    return Object.assign({ ok: true }, cutoutService.inputPayload(image, payload && payload.name))
  })

  ipcMain.handle('cutout:run', async (ev, payload) => {
    const startedAt = Date.now()
    let image = null
    const token = payload && typeof payload.token === 'string' ? payload.token : ''
    if (token && cutoutService.takeInput(token)) {
      image = cutoutService.takeInput(token)
    } else if (payload && payload.dataUrl) {
      // Back-compat: an older renderer still hands over the base64 image.
      let decoded
      try { decoded = cutoutService.decodeImageDataUrl(payload.dataUrl) } catch (err) {
        cutoutService.trace({ ok: false, mode: 'none', code: 'BAD_IMAGE', ms: Date.now() - startedAt, error: err.message })
        return { ok: false, mode: 'none', code: 'BAD_IMAGE', error: err.message }
      }
      image = nativeImage.createFromBuffer(decoded.buffer)
    } else {
      cutoutService.trace({ ok: false, mode: 'none', code: 'BAD_IMAGE', ms: Date.now() - startedAt, error: '还没拿到照片' })
      return { ok: false, mode: 'none', code: 'BAD_IMAGE', error: '照片没拿到，重新选一张吧' }
    }
    if (!image || image.isEmpty()) {
      cutoutService.trace({ ok: false, mode: 'none', code: 'BAD_IMAGE', ms: Date.now() - startedAt })
      return { ok: false, mode: 'none', code: 'BAD_IMAGE', error: '这张图打不开呢' }
    }
    const inputSize = image.getSize()
    try {
      const result = await cutoutService.runDecoded(image, { canvas: 610 })
      const dataUrl = 'data:image/png;base64,' + result.png.toString('base64')
      cutoutService.trace({
        ok: true,
        mode: 'cutout',
        code: null,
        input: inputSize,
        working: result.working,
        shape: [1, 1, 320, 320],
        output: [610, 610],
        coverage: result.coverage,
        bands: result.bands,
        cutout: result.cutout,
        preprocess: result.preprocess,
        timings: result.timings,
        ms: Date.now() - startedAt,
      })
      return {
        ok: true,
        mode: 'cutout',
        dataUrl,
        maskDataUrl: 'data:image/png;base64,' + result.maskPng.toString('base64'),
        preprocess: result.preprocess,
        width: 610,
        height: 610,
        coverage: result.coverage,
        cutout: result.cutout,
        source: result.source,
        bands: result.bands,
        ms: result.ms,
      }
    } catch (err) {
      const code = (err && err.code) || 'CUTOUT_FAILED'
      // Fallback keeps the app usable, but it is explicitly labelled: the
      // renderer must show "整张照片" and ask for a second confirmation
      // before it can be saved as a role.
      const fallback = cutout.scaleOnly(image, 610)
      const fallbackSize = fallback.getSize()
      cutoutService.trace({
        ok: false,
        mode: 'fallback',
        code,
        input: inputSize,
        coverage: typeof err.coverage === 'number' ? err.coverage : null,
        output: [fallbackSize.width, fallbackSize.height],
        ms: Date.now() - startedAt,
        error: err.message,
      })
      return {
        ok: false,
        mode: 'fallback',
        code,
        error: cutoutService.errorMessage(code),
        fallbackDataUrl: 'data:image/png;base64,' + fallback.toPNG().toString('base64'),
        width: fallbackSize.width,
        height: fallbackSize.height,
      }
    }
  })

  ipcMain.handle('cutout:save', (ev, payload) => {
    let decoded
    try { decoded = cutoutService.decodeImageDataUrl(payload && payload.dataUrl) } catch (err) {
      return { ok: false, error: err.message }
    }
    const image = nativeImage.createFromBuffer(decoded.buffer)
    if (image.isEmpty()) return { ok: false, error: '生成的角色图打不开呢' }
    const mode = payload && payload.mode === 'fallback' ? 'fallback' : 'cutout'
    if (mode === 'fallback' && (!payload || payload.confirmFallback !== true)) {
      return { ok: false, code: 'FALLBACK_UNCONFIRMED', error: '要用整张照片当角色的话，得再确认一次' }
    }
    const send = cutout.scaleOnly(image, 610)
    const name = String((payload && payload.name) || '照片角色').trim().slice(0, 30) || '照片角色'
    const entry = store.addRole(name, send.toPNG(), { cutout: mode === 'cutout', mode })
    store.writeSettings({ roleId: entry.id })
    broadcastSettings()
    broadcastRoles()
    return { ok: true, role: entry, roles: roleList() }
  })

  ipcMain.handle('weather:get', () => weatherPump.current())

  ipcMain.handle('sounds:list', () => soundList())

  ipcMain.handle('sounds:import', async () => {
    const result = await dialog.showOpenDialog(windows.settings() || windows.pet(), {
      title: '添加一段音频',
      properties: ['openFile'],
      filters: [{ name: '音频', extensions: ['wav', 'mp3', 'ogg', 'm4a', 'flac'] }],
    })
    if (result.canceled || !result.filePaths || !result.filePaths[0]) return { ok: false, canceled: true }
    const file = result.filePaths[0]
    try {
      const bytes = fs.readFileSync(file)
      if (bytes.length > 8 * 1024 * 1024) return { ok: false, error: '音频超过 8MB 啦，换一段短一点的吧' }
      const ext = path.extname(file).replace('.', '').toLowerCase() || 'wav'
      const name = path.basename(file).replace(/\.[^.]+$/, '').slice(0, 30)
      const entry = store.addSound(name, ext, bytes)
      return { ok: true, file: entry, files: soundList() }
    } catch (err) {
      return { ok: false, error: String(err.message || err) }
    }
  })

  ipcMain.handle('sounds:delete', (ev, id) => {
    const deleted = store.deleteSound(id)
    if (deleted.ok) {
      const s = store.readSettings()
      const events = (s.sound && s.sound.events) || {}
      let touched = false
      for (const key of Object.keys(events)) {
        if (events[key] && events[key].fragment === 'file:' + id) {
          events[key] = Object.assign({}, events[key], { fragment: 'preset:ding' })
          touched = true
        }
      }
      if (touched) {
        const next = store.writeSettings({ sound: Object.assign({}, s.sound, { events }) })
        applySettingsSideEffects(s, next)
        broadcastSettings()
      }
    }
    return Object.assign({}, deleted, { files: soundList() })
  })

  ipcMain.handle('weather:refresh', () => weatherPump.refresh('manual'))
  ipcMain.handle('geocode', async (ev, q) => {
    try { return { ok: true, list: await lists.geocode(q) } }
    catch (err) { return { ok: false, error: String(err.message || err), list: [] } }
  })

  ipcMain.on('pet:drag', (ev, delta) => {
    const petWin = windows.pet()
    if (!petWin || !delta) return
    // Opt-in diagnostic: count how many window moves a drag actually performs
    // (the renderer coalesces them to one per animation frame).
    if (process.env.DESKPET_TRACE_DRAG === '1') log('pet-drag', Math.round(Number(delta.dx) || 0), Math.round(Number(delta.dy) || 0))
    const s = store.readSettings()
    const b = petWin.getBounds()
    const size = clamp(Number(s.size) || 220, 80, 480)
    const pet = placement.petRectOf({ x: b.x, y: layout.petTopLeft().y }, size, winPad)
    pet.x += Math.round(Number(delta.dx) || 0)
    pet.y += Math.round(Number(delta.dy) || 0)

    const displays = layout.getDisplays()
    const display = placement.displayForRect(displays, pet)
    if (!display) return
    let next = placement.clampPet(pet, display.workArea)
    if (s.snap && s.snap.enabled) next = placement.snapPet(next, display.workArea, s.snap.gap)
    // 0.6.2: never drag the pet closer to the top than the reserved bubble strip.
    const maxTop = display.workArea.y + Math.max(0, display.workArea.height - size)
    const floorTop = Math.min(maxTop, display.workArea.y + layout.reserve)
    if (next.y < floorTop) next = { ...next, y: floorTop }

    const extra = Math.max(0, b.height - size)
    // Window top = pet top - reserved bubble space (above) or exactly the pet
    // top (below), so dragging with a bubble open does not make the pet sink.
    layout.petPos = { x: next.x, y: next.y }
    petWin.setBounds(layout.windowBoundsForPet(next.x, next.y, size, extra))
    sendMirror()
  })

  ipcMain.on('pet:drag-end', () => {
    const petWin = windows.pet()
    if (!petWin) return
    const s = store.readSettings()
    const size = clamp(Number(s.size) || 220, 80, 480)
    const pos = layout.petTopLeft()
    const display = placement.displayAt(layout.getDisplays(), { x: pos.x + size / 2, y: pos.y + size / 2 })
    store.writeSettings({ position: { x: pos.x, y: pos.y, displayId: display ? display.id : null } })
    sendMirror()
  })

  // 0.6.2: interactivity is decided in the main process from the cursor
  // position and the rects the renderer reports. Renderer `mousemove` is not
  // reliable enough: the very first move after switching to click-through can
  // be swallowed, which made the pet unclickable until the pointer left and
  // came back.
  ipcMain.on('pet:rects', (ev, rects) => layout.setHitRects(rects))
  ipcMain.on('pet:dragging', (ev, on) => {
    if (on) winState.transition('drag-start')
    else if (winState.is('dragging')) winState.transition('drag-end')
    layout.updateInteractive()
  })

  // The menu is a renderer-side overlay; the machine needs to know whether it is
  // open because it changes the reserved strip and gates bubble/drag events.
  ipcMain.on('pet:menu', (ev, open) => {
    winState.transition(open ? 'menu-open' : 'menu-close')
  })

  ipcMain.handle('pet:bubble', (ev, payload) => {
    const visible = !!(payload && payload.visible)
    if (visible !== bubbleVisible) {
      bubbleVisible = visible
      winState.transition(visible ? 'bubble-show' : 'bubble-hide')
    }
    // Hiding keeps the reserved strip (0.6.4): pass null instead of 0.
    return layout.applyBubbleHeight(visible ? (payload && payload.height) : null)
  })

  ipcMain.handle('pet:reserve', (ev, height) => layout.applyBubbleHeight(height == null ? null : Number(height) || 0))

  // The renderer hides the bubble without touching the reserve (that resize was
  // the 0.6.4 flicker), but the machine still has to leave `bubble`.
  ipcMain.on('pet:bubble-hidden', () => {
    if (!bubbleVisible) return
    bubbleVisible = false
    winState.transition('bubble-hide')
  })

  ipcMain.on('pet:hide', () => { const win = windows.pet(); if (win) win.hide() })
  ipcMain.on('pet:open-settings', () => actions.openSettings())
  ipcMain.on('pet:open-editor', () => actions.openEditor())
  // P1-7：宠物上的任何动作都算「人还在」。
  ipcMain.on('pet:activity', () => { if (nudges) nudges.touch() })
  // 只读探针，给设置页与 CDP 验证用：不改状态；带 send 时才真的冒一句。
  ipcMain.handle('nudge:probe', (ev, opts) => {
    if (!nudges) return null
    const out = nudges.probe(opts && opts.now, opts || {})
    if (opts && opts.send) {
      try {
        const pet = windows.pet()
        pet.webContents.send('pet:nudge', { kind: (out.decision && out.decision.kind) || 'manual', text: opts.text || '试一下，看看我能不能冒个泡' })
      } catch (err) {}
    }
    return out
  })
  ipcMain.on('onboard:open', () => actions.openOnboard(true))
  ipcMain.on('onboard:dismiss', () => actions.dismissOnboard())
  registerWaterIpc({ ipcMain, store, path, fs, shell, clamp, log })

  ipcMain.on('app:quit', () => { setQuitting(true); app.quit() })
  ipcMain.handle('app:open-data-dir', () => shell.openPath(store.dir))
  ipcMain.handle('app:diagnostics', () => diagnostics.export())

  return { bubbleVisible: () => bubbleVisible }
}

module.exports = { registerIpc }