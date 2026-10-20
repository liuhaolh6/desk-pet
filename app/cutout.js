(function () {
  'use strict'

  const api = window.deskPet
  const $ = (id) => document.getElementById(id)
  const stage = $('stage')
  const canvas = $('canvas')
  const ctx = canvas.getContext('2d')
  const SIZE = 610
  const MAX = SIZE * 0.94

  const state = {
    original: '',
    current: '',
    image: null,
    mode: 'none',
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
    dragging: null,
    busy: false,
    name: '',
  }

  function status(text, kind) {
    const el = $('status')
    el.textContent = text
    el.className = 'status' + (kind ? ' ' + kind : '')
  }

  function mode(text) {
    $('modeLabel').textContent = text
  }

  function setBusy(value) {
    state.busy = value
    $('pickBtn').disabled = value
    $('runBtn').disabled = value || !state.original
    $('fallbackBtn').disabled = value || !state.original || state.mode === 'fallback'
    $('saveBtn').disabled = value || !state.current
  }

  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('图片加载失败'))
      image.src = dataUrl
    })
  }

  function draw() {
    ctx.clearRect(0, 0, SIZE, SIZE)
    const image = state.image
    if (!image) return
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    const w = image.naturalWidth
    const h = image.naturalHeight
    const square = w === SIZE && h === SIZE
    const base = square ? 1 : Math.min(MAX / w, MAX / h)
    const dw = w * base * state.zoom
    const dh = h * base * state.zoom
    const x = (SIZE - dw) / 2 + state.offsetX
    const y = (square ? SIZE - dh : SIZE - dh - 6) + state.offsetY
    ctx.drawImage(image, x, y, dw, dh)
  }

  async function useImage(dataUrl, nextMode, label) {
    state.current = dataUrl
    state.mode = nextMode
    state.image = await loadImage(dataUrl)
    state.zoom = 1
    state.offsetX = 0
    state.offsetY = 0
    $('zoom').value = '100'
    $('zoomVal').textContent = '100%'
    stage.classList.add('has-image')
    mode(label)
    draw()
    $('saveBtn').disabled = false
    $('fallbackBtn').disabled = nextMode === 'fallback' || !state.original
  }

  async function setSource(dataUrl, name) {
    state.original = dataUrl
    state.name = name || state.name || '照片角色'
    $('name').value = state.name
    $('runBtn').disabled = false
    $('fallbackBtn').disabled = false
    await useImage(dataUrl, 'original', '原图')
    $('saveBtn').disabled = true
    status('照片已载入。点“开始抠图”离线分割人像，或直接“仅缩放导入”。', '')
  }

  async function pick() {
    if (state.busy) return
    $('pickBtn').disabled = true
    status('正在选择照片…')
    try {
      const result = await api.pickCutoutPhoto()
      if (!result || result.canceled) { status('已取消'); return }
      if (!result.ok) { status(result.error || '读取失败', 'error'); return }
      await setSource(result.dataUrl, result.name)
    } catch (err) {
      status('读取照片失败', 'error')
    } finally {
      $('pickBtn').disabled = state.busy
    }
  }

  async function run() {
    if (state.busy || !state.original) return
    setBusy(true)
    status('正在离线抠图，第一次会加载模型，请稍候…')
    mode('处理中')
    try {
      const result = await api.runCutout(state.original)
      if (result && result.ok) {
        await useImage(result.dataUrl, 'cutout', '已抠图')
        status('抠图完成。拖动或缩放调整构图，然后保存为角色。', 'ok')
      } else {
        const fallback = result && result.fallbackDataUrl
        if (fallback) {
          await useImage(fallback, 'fallback', '仅缩放')
          status((result.error || '未检测到人像') + '。当前为仅缩放导入，可直接保存。', 'error')
        } else {
          status((result && result.error) || '抠图失败', 'error')
          mode('处理失败')
        }
      }
    } catch (err) {
      status('抠图进程异常，可以改用“仅缩放导入”。', 'error')
      mode('处理失败')
    } finally {
      setBusy(false)
    }
  }

  async function fallback() {
    if (!state.original) return
    await useImage(state.original, 'fallback', '仅缩放')
    status('已跳过抠图，当前为仅缩放导入。', '')
    $('fallbackBtn').disabled = true
  }

  async function save() {
    if (!state.current || state.busy) return
    setBusy(true)
    status('正在保存角色…')
    try {
      const name = ($('name').value || state.name || '照片角色').trim().slice(0, 30) || '照片角色'
      const result = await api.saveCutout({ dataUrl: canvas.toDataURL('image/png'), name })
      if (!result || !result.ok) {
        status((result && result.error) || '保存失败', 'error')
        return
      }
      status('已保存并切换角色：' + result.role.name, 'ok')
      setTimeout(() => api.closeCutout(), 700)
    } catch (err) {
      status('保存失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  stage.addEventListener('pointerdown', (ev) => {
    if (!state.image || state.busy) return
    stage.setPointerCapture(ev.pointerId)
    state.dragging = { x: ev.clientX, y: ev.clientY, ox: state.offsetX, oy: state.offsetY }
    stage.focus()
  })

  stage.addEventListener('pointermove', (ev) => {
    if (!state.dragging) return
    const scale = SIZE / stage.getBoundingClientRect().width
    state.offsetX = Math.max(-600, Math.min(600, state.dragging.ox + (ev.clientX - state.dragging.x) * scale))
    state.offsetY = Math.max(-600, Math.min(600, state.dragging.oy + (ev.clientY - state.dragging.y) * scale))
    draw()
  })

  stage.addEventListener('pointerup', () => { state.dragging = null })
  stage.addEventListener('pointercancel', () => { state.dragging = null })

  stage.addEventListener('wheel', (ev) => {
    if (!state.image) return
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
    if (!file || !/^image\//.test(file.type)) { status('请拖入图片文件', 'error'); return }
    const reader = new FileReader()
    reader.onload = () => setSource(String(reader.result), file.name.replace(/\.[^.]+$/, ''))
    reader.onerror = () => status('读取拖入的图片失败', 'error')
    reader.readAsDataURL(file)
  })

  $('zoom').addEventListener('input', (ev) => {
    state.zoom = Number(ev.target.value) / 100
    $('zoomVal').textContent = ev.target.value + '%'
    draw()
  })

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

  // Initial canvas is transparent; the checkerboard is CSS behind it.
  draw()
})()
