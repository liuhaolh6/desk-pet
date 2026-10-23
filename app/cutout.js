(function () {
  'use strict'

  const api = window.deskPet
  const i18nLib = window.deskPetI18n
  const i18n = (api && api.i18n) || null
  if (i18nLib && i18n) i18nLib.applyStatic(document, i18n)
  const t = (key, vars) => (i18n && typeof i18n.t === 'function' ? i18n.t(key, vars) : key)
  const viewLabel = (view) => t('cutout.view.' + view)
  const $ = (id) => document.getElementById(id)
  const stage = $('stage')
  const canvas = $('canvas')
  const ctx = canvas.getContext('2d')
  const SIZE = 610
  const MAX = SIZE * 0.94

  const state = {
    original: '',
    originalImage: null,
    // Main process keeps the full-size photo; the renderer only sees this token
    // plus a small preview (P1-5 token IPC).
    token: '',
    resultUrl: '',
    resultImage: null,
    maskUrl: '',
    maskImage: null,
    mode: 'none',
    view: 'original',
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
    rotation: 0,
    flipX: false,
    dragging: null,
    busy: false,
    name: '',
    confirmFallback: false,
    confirmAt: 0,
    confirmTimer: 0,
    // Erase/restore lives in image space (610x610), so zoom/rotation does not
    // move the strokes away from the pixels the user painted.
    maskCanvas: null,
    maskCtx: null,
    history: [],
    edited: false,
    editTool: null,
    brush: 24,
    stroke: null,
  }

  function status(text, kind) {
    const el = $('status')
    el.textContent = text
    el.className = 'status' + (kind ? ' ' + kind : '')
  }

  function mode(text, fallback) {
    const el = $('modeLabel')
    el.textContent = text
    el.className = 'pill' + (fallback ? ' warn' : '')
  }

  function resetFallbackConfirm() {
    state.confirmFallback = false
    state.confirmAt = 0
    if (state.confirmTimer) { clearTimeout(state.confirmTimer); state.confirmTimer = 0 }
    $('saveBtn').textContent = t('cutout.saveBtn')
  }

  function setBusy(value) {
    state.busy = value
    $('pickBtn').disabled = value
    $('runBtn').disabled = value || !state.original
    $('fallbackBtn').disabled = value || !state.original || state.mode === 'fallback'
    $('saveBtn').disabled = value || !state.resultImage
  }

  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error(t('cutout.error.openImage')))
      image.src = dataUrl
    })
  }

  function geometry(image) {
    const w = image.naturalWidth
    const h = image.naturalHeight
    const square = w === SIZE && h === SIZE
    const base = square ? 1 : Math.min(MAX / w, MAX / h)
    const dw = w * base * state.zoom
    const dh = h * base * state.zoom
    const x = (SIZE - dw) / 2 + state.offsetX
    const y = (square ? SIZE - dh : SIZE - dh - 6) + state.offsetY
    return { w, h, square, base, dw, dh, x, y, cx: x + dw / 2, cy: y + dh / 2 }
  }

  function withTransform(g, fn) {
    const rad = (state.rotation * Math.PI) / 180
    ctx.save()
    ctx.translate(g.cx, g.cy)
    ctx.rotate(rad)
    ctx.scale(state.flipX ? -1 : 1, 1)
    fn()
    ctx.restore()
  }

  function drawImageLayer(image) {
    const g = geometry(image)
    withTransform(g, () => {
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(image, -g.dw / 2, -g.dh / 2, g.dw, g.dh)
    })
    return g
  }

  function draw() {
    ctx.clearRect(0, 0, SIZE, SIZE)
    let image = null
    if (state.view === 'original') image = state.originalImage
    else if (state.view === 'mask') image = state.maskImage
    else image = state.resultImage
    if (!image) return
    const g = drawImageLayer(image)
    if (state.view === 'result' && state.mode === 'cutout' && state.maskCanvas && state.edited) {
      withTransform(g, () => {
        ctx.globalCompositeOperation = 'destination-in'
        ctx.drawImage(state.maskCanvas, -g.dw / 2, -g.dh / 2, g.dw, g.dh)
      })
    }
  }

  function resetViewState() {
    state.zoom = 1
    state.offsetX = 0
    state.offsetY = 0
    state.rotation = 0
    state.flipX = false
    state.stroke = null
    $('zoom').value = '100'
    $('zoomVal').textContent = '100%'
    $('flipBtn').setAttribute('aria-pressed', 'false')
  }

  function updateViewButtons() {
    document.querySelectorAll('.seg[data-view]').forEach((btn) => {
      const on = btn.dataset.view === state.view
      btn.classList.toggle('is-on', on)
      btn.setAttribute('aria-pressed', on ? 'true' : 'false')
    })
    stage.setAttribute('aria-label', t('cutout.stage.labelWith', { view: viewLabel(state.view) }))
    const modeText = t('cutout.mode.' + state.mode)
    const el = $('previewAlt')
    if (el) {
      el.textContent = state.resultImage || state.originalImage
        ? t('cutout.preview.current', { view: viewLabel(state.view), mode: modeText })
        : t('cutout.preview.empty')
    }
  }

  function ensureMaskCanvas() {
    if (state.maskCanvas) return
    const layer = document.createElement('canvas')
    layer.width = SIZE
    layer.height = SIZE
    state.maskCanvas = layer
    state.maskCtx = layer.getContext('2d', { willReadFrequently: true })
    state.maskCtx.fillStyle = '#fff'
    state.maskCtx.fillRect(0, 0, SIZE, SIZE)
  }

  function maskHasEdits() {
    if (!state.maskCtx) return false
    const data = state.maskCtx.getImageData(0, 0, SIZE, SIZE).data
    for (let i = 3; i < data.length; i += 4) if (data[i] < 250) return true
    return false
  }

  function updateEditButtons() {
    $('eraseBtn').setAttribute('aria-pressed', state.editTool === 'erase' ? 'true' : 'false')
    $('restoreBtn').setAttribute('aria-pressed', state.editTool === 'restore' ? 'true' : 'false')
    $('undoBtn').disabled = state.history.length === 0
    $('resetEditBtn').disabled = !state.edited
    $('brush').value = String(state.brush)
    $('brushVal').textContent = state.brush + 'px'
  }

  function resetEdits() {
    ensureMaskCanvas()
    state.maskCtx.save()
    state.maskCtx.globalCompositeOperation = 'source-over'
    state.maskCtx.clearRect(0, 0, SIZE, SIZE)
    state.maskCtx.fillStyle = '#fff'
    state.maskCtx.fillRect(0, 0, SIZE, SIZE)
    state.maskCtx.restore()
    state.history = []
    state.edited = false
    state.stroke = null
    updateEditButtons()
  }

  function setEditTool(tool) {
    const was = state.editTool
    const next = state.editTool === tool ? null : tool
    state.editTool = next
    state.stroke = null
    stage.classList.toggle('is-editing', !!next)
    if (next) {
      state.view = 'result'
      updateViewButtons()
      draw()
      stage.focus()
      status(t(next === 'erase' ? 'cutout.edit.eraseOn' : 'cutout.edit.restoreOn'), '')
    } else {
      status(t('cutout.edit.off'), '')
      // Keep keyboard focus on the tool that was just turned off.
      const back = was === 'restore' ? $('restoreBtn') : $('eraseBtn')
      if (back && typeof back.focus === 'function') back.focus()
    }
    updateEditButtons()
  }

  function setBrush(value, syncInput) {
    const next = Math.max(8, Math.min(80, Math.round(Number(value) || 24)))
    state.brush = next
    if (syncInput) $('brush').value = String(next)
    $('brushVal').textContent = next + 'px'
  }

  function pointerToImage(ev) {
    const rect = stage.getBoundingClientRect()
    const scale = SIZE / rect.width
    const px = (ev.clientX - rect.left) * scale
    const py = (ev.clientY - rect.top) * scale
    const g = geometry(state.resultImage)
    const dx = (px - g.cx) / state.zoom
    const dy = (py - g.cy) / state.zoom
    const rad = (-state.rotation * Math.PI) / 180
    const c = Math.cos(rad)
    const s = Math.sin(rad)
    let rx = dx * c - dy * s
    const ry = dx * s + dy * c
    if (state.flipX) rx = -rx
    return { x: rx + SIZE / 2, y: ry + SIZE / 2 }
  }

  function paintCircle(x, y) {
    const radius = state.brush / 2
    const c = state.maskCtx
    c.save()
    c.globalCompositeOperation = state.editTool === 'erase' ? 'destination-out' : 'source-over'
    c.fillStyle = '#fff'
    c.beginPath()
    c.arc(x, y, radius, 0, Math.PI * 2)
    c.fill()
    c.restore()
  }

  function strokeTo(x, y) {
    const last = state.stroke
    if (!last) {
      paintCircle(x, y)
      state.stroke = { x, y }
      return
    }
    const radius = Math.max(1, state.brush / 2)
    const dist = Math.hypot(x - last.x, y - last.y)
    const steps = Math.max(1, Math.ceil(dist / Math.max(1, radius / 3)))
    for (let i = 1; i <= steps; i++) {
      paintCircle(last.x + ((x - last.x) * i) / steps, last.y + ((y - last.y) * i) / steps)
    }
    state.stroke = { x, y }
  }

  function pushHistory() {
    const snap = state.maskCtx.getImageData(0, 0, SIZE, SIZE)
    state.history.push(snap)
    if (state.history.length > 3) state.history.shift()
    state.edited = true
    updateEditButtons()
  }

  function undoEdit() {
    if (!state.history.length) return
    const snap = state.history.pop()
    state.maskCtx.putImageData(snap, 0, 0)
    state.edited = maskHasEdits()
    state.stroke = null
    draw()
    updateEditButtons()
    status(t('cutout.undoDone'), '')
  }

  function selectView(view) {
    if (view === 'mask' && !state.maskImage) return
    if (view === 'result' && !state.resultImage) return
    if (view === 'original' && !state.originalImage) return
    if (state.editTool && view !== 'result') setEditTool(null)
    state.view = view
    updateViewButtons()
    draw()
  }

  async function setSource(dataUrl, name, token) {
    state.original = dataUrl
    state.token = token || ''
    state.name = name || state.name || t('cutout.defaultName')
    $('name').value = state.name
    state.originalImage = await loadImage(dataUrl)
    state.resultUrl = ''
    state.resultImage = null
    state.maskUrl = ''
    state.maskImage = null
    state.mode = 'original'
    state.view = 'original'
    state.editTool = null
    stage.classList.remove('is-editing')
    resetViewState()
    resetFallbackConfirm()
    ensureMaskCanvas()
    resetEdits()
    $('viewRow').hidden = true
    $('editCard').hidden = true
    $('maskViewBtn').hidden = true
    $('saveBtn').disabled = true
    stage.classList.add('has-image')
    stage.classList.remove('is-fallback')
    mode(t('cutout.view.original'))
    updateViewButtons()
    draw()
    $('runBtn').disabled = false
    $('fallbackBtn').disabled = false
    status(t('cutout.status.picked'), '')
  }

  async function setResult(resultUrl, maskUrl, nextMode, label) {
    state.resultUrl = resultUrl
    state.resultImage = await loadImage(resultUrl)
    state.maskUrl = maskUrl || ''
    state.maskImage = maskUrl ? await loadImage(maskUrl) : null
    state.mode = nextMode
    state.view = 'result'
    state.editTool = null
    stage.classList.remove('is-editing')
    resetViewState()
    resetFallbackConfirm()
    ensureMaskCanvas()
    resetEdits()
    $('viewRow').hidden = false
    $('maskViewBtn').hidden = !state.maskImage
    $('editCard').hidden = nextMode !== 'cutout'
    stage.classList.add('has-image')
    stage.classList.toggle('is-fallback', nextMode === 'fallback')
    mode(label, nextMode === 'fallback')
    updateViewButtons()
    draw()
    $('saveBtn').disabled = false
    $('fallbackBtn').disabled = nextMode === 'fallback' || !state.original
  }

  async function pick() {
    if (state.busy) return
    $('pickBtn').disabled = true
    status(t('cutout.status.picking'))
    try {
      const result = await api.pickCutoutPhoto()
      if (!result || result.canceled) { status(t('cutout.status.pickCanceled')); return }
      if (!result.ok) { status(result.error || t('cutout.error.readPhoto'), 'error'); return }
      await setSource(result.dataUrl, result.name, result.token)
    } catch (err) {
      status(t('cutout.error.readPhoto'), 'error')
    } finally {
      $('pickBtn').disabled = state.busy
    }
  }

  async function run() {
    if (state.busy || !state.original) return
    setBusy(true)
    status(t('cutout.status.running'))
    mode(t('cutout.mode.busy'))
    try {
      const result = await api.runCutout(state.token)
      if (result && result.ok) {
        await setResult(result.dataUrl, result.maskDataUrl, 'cutout', t('cutout.mode.cutout'))
        status(t('cutout.status.done'), 'ok')
      } else {
        const fallback = result && result.fallbackDataUrl
        if (fallback) {
          await setResult(fallback, '', 'fallback', t('cutout.mode.fallback'))
          status(t('cutout.status.fallback', { message: result.error || t('cutout.error.noPortrait') }), 'error')
        } else {
          status((result && result.error) || t('cutout.error.runFailed'), 'error')
          mode(t('cutout.mode.failed'))
        }
      }
    } catch (err) {
      status(t('cutout.status.runError'), 'error')
      mode(t('cutout.mode.failed'))
    } finally {
      setBusy(false)
    }
  }

  async function fallback() {
    if (!state.original) return
    await setResult(state.original, '', 'fallback', t('cutout.mode.fallback'))
    status(t('cutout.status.fallbackUsed'), '')
    $('fallbackBtn').disabled = true
  }

  /** The saved PNG must always be the result layer, not the mask/original view. */
  function captureResult() {
    if (state.view === 'result') return canvas.toDataURL('image/png')
    const previous = state.view
    state.view = 'result'
    draw()
    const dataUrl = canvas.toDataURL('image/png')
    state.view = previous
    draw()
    return dataUrl
  }

  async function save() {
    if (!state.resultImage || state.busy) return
    // Saving a fallback image silently is exactly the M11 "fake success" path.
    if (state.mode === 'fallback' && !state.confirmFallback) {
      state.confirmFallback = true
      state.confirmAt = Date.now()
      $('saveBtn').textContent = t('cutout.saveBtnConfirm')
      status(t('cutout.status.confirmFallback'), 'error')
      state.confirmTimer = setTimeout(() => resetFallbackConfirm(), 10000)
      return
    }
    // A stray double click must not count as the second confirmation.
    if (state.mode === 'fallback' && Date.now() - state.confirmAt < 600) return
    setBusy(true)
    status(t('cutout.status.saving'))
    try {
      const name = ($('name').value || state.name || t('cutout.defaultName')).trim().slice(0, 30) || t('cutout.defaultName')
      const payload = { dataUrl: captureResult(), name, mode: state.mode === 'fallback' ? 'fallback' : 'cutout' }
      if (payload.mode === 'fallback') payload.confirmFallback = true
      const result = await api.saveCutout(payload)
      if (!result || !result.ok) {
        status((result && result.error) || t('cutout.error.saveFailed'), 'error')
        return
      }
      status(t('cutout.status.saved', { name: result.role.name }), 'ok')
      setTimeout(() => api.closeCutout(), 700)
    } catch (err) {
      status(t('cutout.error.saveFailed'), 'error')
    } finally {
      setBusy(false)
    }
  }

  stage.addEventListener('pointerdown', (ev) => {
    if (!state.resultImage || state.busy) return
    if (state.editTool && state.mode === 'cutout' && state.view === 'result') {
      ev.preventDefault()
      stage.setPointerCapture(ev.pointerId)
      pushHistory()
      const point = pointerToImage(ev)
      state.stroke = null
      strokeTo(point.x, point.y)
      draw()
      return
    }
    if (state.editTool) return
    stage.setPointerCapture(ev.pointerId)
    state.dragging = { x: ev.clientX, y: ev.clientY, ox: state.offsetX, oy: state.offsetY }
    stage.focus()
  })

  stage.addEventListener('pointermove', (ev) => {
    if (state.stroke && state.editTool) {
      const point = pointerToImage(ev)
      strokeTo(point.x, point.y)
      draw()
      return
    }
    if (!state.dragging) return
    const scale = SIZE / stage.getBoundingClientRect().width
    state.offsetX = Math.max(-600, Math.min(600, state.dragging.ox + (ev.clientX - state.dragging.x) * scale))
    state.offsetY = Math.max(-600, Math.min(600, state.dragging.oy + (ev.clientY - state.dragging.y) * scale))
    draw()
  })

  stage.addEventListener('pointerup', () => {
    if (state.stroke) {
      state.stroke = null
      state.edited = maskHasEdits()
      updateEditButtons()
    }
    state.dragging = null
  })
  stage.addEventListener('pointercancel', () => {
    state.stroke = null
    state.dragging = null
  })

  stage.addEventListener('wheel', (ev) => {
    if (!state.resultImage && !state.originalImage) return
    if (state.editTool) return
    ev.preventDefault()
    const next = Math.max(0.6, Math.min(1.6, state.zoom + (ev.deltaY < 0 ? 0.05 : -0.05)))
    state.zoom = next
    $('zoom').value = String(Math.round(next * 100))
    $('zoomVal').textContent = Math.round(next * 100) + '%'
    draw()
  }, { passive: false })

  stage.addEventListener('dragover', (ev) => { ev.preventDefault() })
  stage.addEventListener('drop', (ev) => {
    ev.preventDefault()
    const file = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0]
    if (!file || !/^image\//.test(file.type)) { status(t('cutout.status.dropHint'), 'error'); return }
    const name = file.name.replace(/\.[^.]+$/, '')
    const reader = new FileReader()
    reader.onload = async () => {
      status(t('cutout.status.opening'))
      try {
        const result = await api.loadCutoutPhoto(String(reader.result), name)
        if (!result || !result.ok) { status((result && result.error) || t('cutout.error.readImage'), 'error'); return }
        await setSource(result.dataUrl, result.name, result.token)
      } catch (err) {
        status(t('cutout.error.readImage'), 'error')
      }
    }
    reader.onerror = () => status(t('cutout.error.readImage'), 'error')
    reader.readAsDataURL(file)
  })

  document.querySelectorAll('.seg[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => selectView(btn.dataset.view))
  })

  $('zoom').addEventListener('input', (ev) => {
    state.zoom = Number(ev.target.value) / 100
    $('zoomVal').textContent = ev.target.value + '%'
    draw()
  })

  $('brush').addEventListener('input', (ev) => setBrush(ev.target.value, false))
  $('eraseBtn').addEventListener('click', () => setEditTool('erase'))
  $('restoreBtn').addEventListener('click', () => setEditTool('restore'))
  $('undoBtn').addEventListener('click', undoEdit)
  $('resetEditBtn').addEventListener('click', () => {
    resetEdits()
    draw()
    status(t('cutout.status.editsReset'), '')
  })

  function rotateBy(delta) {
    state.rotation = (state.rotation + delta + 360) % 360
    draw()
    status(t('cutout.status.rotated', { degree: state.rotation }), '')
  }

  function toggleFlip() {
    state.flipX = !state.flipX
    $('flipBtn').setAttribute('aria-pressed', state.flipX ? 'true' : 'false')
    draw()
    status(t(state.flipX ? 'cutout.flip.on' : 'cutout.flip.off'), '')
  }

  $('rotateLeftBtn').addEventListener('click', () => rotateBy(270))
  $('rotateRightBtn').addEventListener('click', () => rotateBy(90))
  $('flipBtn').addEventListener('click', toggleFlip)

  $('pickBtn').addEventListener('click', pick)
  $('runBtn').addEventListener('click', run)
  $('fallbackBtn').addEventListener('click', fallback)
  $('saveBtn').addEventListener('click', save)
  $('resetBtn').addEventListener('click', () => {
    state.zoom = 1
    state.offsetX = 0
    state.offsetY = 0
    $('zoom').value = '100'
    $('zoomVal').textContent = '100%'
    draw()
  })
  $('closeBtn').addEventListener('click', () => api.closeCutout())

  $('name').addEventListener('input', (ev) => { state.name = ev.target.value })

  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      if (state.editTool) { setEditTool(null); ev.preventDefault() }
      return
    }
    const el = document.activeElement
    const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')
    if (typing) return
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') {
      ev.preventDefault()
      undoEdit()
      return
    }
    if (state.mode !== 'cutout' || !state.resultImage) {
      if (state.resultImage && (ev.key === 'q' || ev.key === 'Q')) { ev.preventDefault(); rotateBy(270) }
      else if (state.resultImage && (ev.key === 'w' || ev.key === 'W')) { ev.preventDefault(); rotateBy(90) }
      else if (state.resultImage && (ev.key === 'f' || ev.key === 'F')) { ev.preventDefault(); toggleFlip() }
      return
    }
    if (ev.key === 'e' || ev.key === 'E') { ev.preventDefault(); setEditTool('erase') }
    else if (ev.key === 'r' || ev.key === 'R') { ev.preventDefault(); setEditTool('restore') }
    else if (ev.key === '[') { ev.preventDefault(); setBrush(state.brush - 4, true) }
    else if (ev.key === ']') { ev.preventDefault(); setBrush(state.brush + 4, true) }
    else if (ev.key === 'q' || ev.key === 'Q') { ev.preventDefault(); rotateBy(270) }
    else if (ev.key === 'w' || ev.key === 'W') { ev.preventDefault(); rotateBy(90) }
    else if (ev.key === 'f' || ev.key === 'F') { ev.preventDefault(); toggleFlip() }
  })

  // Initial canvas is transparent; the checkerboard is CSS behind it.
  ensureMaskCanvas()
  resetEdits()
  updateViewButtons()
  draw()
})()