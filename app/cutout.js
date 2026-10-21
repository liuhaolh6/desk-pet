(function () {
  'use strict'

  const api = window.deskPet
  const $ = (id) => document.getElementById(id)
  const stage = $('stage')
  const canvas = $('canvas')
  const ctx = canvas.getContext('2d')
  const SIZE = 610
  const MAX = SIZE * 0.94
  const VIEW_LABEL = { result: '结果', original: '原图', mask: '蒙版' }

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
    $('saveBtn').textContent = '就它了，保存'
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
      image.onerror = () => reject(new Error('这张图打不开呢'))
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
    stage.setAttribute('aria-label', '角色预览：' + (VIEW_LABEL[state.view] || ''))
    const modeText = state.mode === 'cutout' ? '已抠图'
      : state.mode === 'fallback' ? '整张照片'
        : state.mode === 'original' ? '还没抠的原图' : '等你的照片'
    const el = $('previewAlt')
    if (el) {
      el.textContent = state.resultImage || state.originalImage
        ? '当前视图：' + (VIEW_LABEL[state.view] || '') + '；' + modeText + '。'
        : '还没有选照片哦。'
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
      status(next === 'erase'
        ? '擦一擦：在画面上拖动，去掉多余的地方；再点一次「擦一擦」，或者按 Esc 就退出。'
        : '找回来：在画面上拖动，把不小心擦掉的部分补回来；再点一次，或者按 Esc 就退出。', '')
    } else {
      status('退出修补啦。挪一挪、放大缩小摆好位置，再保存吧。', '')
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
    status('刚才那一下撤销啦。', '')
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
    state.name = name || state.name || '照片角色'
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
    mode('原图')
    updateViewButtons()
    draw()
    $('runBtn').disabled = false
    $('fallbackBtn').disabled = false
    status('照片收到啦。点「开始抠图」，我在你电脑里把人像留下来（不上传）；也可以选「不用抠，直接用整张」。', '')
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
    status('等你挑照片…')
    try {
      const result = await api.pickCutoutPhoto()
      if (!result || result.canceled) { status('好，那不选了'); return }
      if (!result.ok) { status(result.error || '这张照片读不进来呢', 'error'); return }
      await setSource(result.dataUrl, result.name, result.token)
    } catch (err) {
      status('这张照片读不进来呢', 'error')
    } finally {
      $('pickBtn').disabled = state.busy
    }
  }

  async function run() {
    if (state.busy || !state.original) return
    setBusy(true)
    status('在认真抠图啦～第一次会慢一点点，等我一下下')
    mode('忙一会儿')
    try {
      const result = await api.runCutout(state.token)
      if (result && result.ok) {
        await setResult(result.dataUrl, result.maskDataUrl, 'cutout', '已抠图')
        status('抠好啦。可以切到「蒙版」看看边缘，或者点「修一修」擦掉多余的地方。', 'ok')
      } else {
        const fallback = result && result.fallbackDataUrl
        if (fallback) {
          await setResult(fallback, '', 'fallback', '整张照片')
          status((result.error || '没找到人像呢') + '。现在显示的是整张原图，不是抠好的；保存前我会再问你一次。', 'error')
        } else {
          status((result && result.error) || '这次没抠成', 'error')
          mode('这次没处理成功')
        }
      }
    } catch (err) {
      status('抠图的时候出了点小状况，可以改用「不用抠，直接用整张」。', 'error')
      mode('这次没处理成功')
    } finally {
      setBusy(false)
    }
  }

  async function fallback() {
    if (!state.original) return
    await setResult(state.original, '', 'fallback', '整张照片')
    status('这次跳过抠图，用的就是整张照片。保存前我会再确认一次，角色库里也会标成「整张照片」。', '')
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
      $('saveBtn').textContent = '再确认一次：保存整张照片'
      status('现在是「不用抠，直接用整张」，保存下来会带着原来的背景。再点一次才会保存哦。', 'error')
      state.confirmTimer = setTimeout(() => resetFallbackConfirm(), 10000)
      return
    }
    // A stray double click must not count as the second confirmation.
    if (state.mode === 'fallback' && Date.now() - state.confirmAt < 600) return
    setBusy(true)
    status('在收好这张啦…')
    try {
      const name = ($('name').value || state.name || '照片角色').trim().slice(0, 30) || '照片角色'
      const payload = { dataUrl: captureResult(), name, mode: state.mode === 'fallback' ? 'fallback' : 'cutout' }
      if (payload.mode === 'fallback') payload.confirmFallback = true
      const result = await api.saveCutout(payload)
      if (!result || !result.ok) {
        status((result && result.error) || '没保存成功，再试一次？', 'error')
        return
      }
      status('收好啦，已经换成：' + result.role.name, 'ok')
      setTimeout(() => api.closeCutout(), 700)
    } catch (err) {
      status('没保存成功，再试一次？', 'error')
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
    if (!file || !/^image\//.test(file.type)) { status('把图片拖进来就可以啦', 'error'); return }
    const name = file.name.replace(/\.[^.]+$/, '')
    const reader = new FileReader()
    reader.onload = async () => {
      status('在打开照片啦…')
      try {
        const result = await api.loadCutoutPhoto(String(reader.result), name)
        if (!result || !result.ok) { status((result && result.error) || '这张图读不进来呢', 'error'); return }
        await setSource(result.dataUrl, result.name, result.token)
      } catch (err) {
        status('这张图读不进来呢', 'error')
      }
    }
    reader.onerror = () => status('这张图读不进来呢', 'error')
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
    status('修补都清空啦，回到最初的样子。', '')
  })

  function rotateBy(delta) {
    state.rotation = (state.rotation + delta + 360) % 360
    draw()
    status('转了一下，现在是 ' + state.rotation + '°', '')
  }

  function toggleFlip() {
    state.flipX = !state.flipX
    $('flipBtn').setAttribute('aria-pressed', state.flipX ? 'true' : 'false')
    draw()
    status(state.flipX ? '照过镜子啦' : '不照镜子了', '')
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