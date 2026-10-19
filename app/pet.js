/**
 * Pet renderer: sprite, speech bubble, click queue, drag, sounds.
 *
 * The window is transparent and only as large as the pet (plus whatever height
 * the bubble needs), so `setBubble` tells main to grow/shrink it upwards.
 */
(function () {
  const api = window.deskPet
  const pet = document.getElementById('pet')
  const bubble = document.getElementById('bubble')

  const state = {
    settings: null,
    roles: [],
    weather: null,
    queue: [],
    queueIndex: 0,
    timer: 0,
    drag: null,
  }

  // ------------------------------------------------------------------ utils
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))

  function todayKey() {
    const d = new Date()
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate()
  }

  function inQuietHours(w) {
    const from = clamp(Number(w.quietFrom), 0, 23) * 60
    const to = clamp(Number(w.quietTo), 0, 23) * 60
    if (from === to) return false
    const now = new Date()
    const mins = now.getHours() * 60 + now.getMinutes()
    return from < to ? (mins >= from && mins < to) : (mins >= from || mins < to)
  }

  function fmtTime(ts) {
    if (!ts) return ''
    const d = new Date(ts)
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
  }

  function el(tag, className, text) {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (text != null) node.textContent = text
    return node
  }

  // ------------------------------------------------------------------ sound
  let audio = null
  function beep(freq, ms, gain) {
    if (!state.settings || !state.settings.sound || !state.settings.sound.enabled) return
    try {
      audio = audio || new AudioContext()
      const osc = audio.createOscillator()
      const amp = audio.createGain()
      const vol = clamp(Number(state.settings.sound.volume) || 0.4, 0, 1) * (gain || 0.25)
      osc.type = 'sine'
      osc.frequency.value = freq
      amp.gain.setValueAtTime(0.0001, audio.currentTime)
      amp.gain.exponentialRampToValueAtTime(vol, audio.currentTime + 0.01)
      amp.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + ms / 1000)
      osc.connect(amp).connect(audio.destination)
      osc.start()
      osc.stop(audio.currentTime + ms / 1000 + 0.02)
    } catch (err) {}
  }

  // ------------------------------------------------------------------ apply
  function applySettings(settings) {
    if (!settings) return
    state.settings = settings
    const size = clamp(Number(settings.size) || 220, 80, 480)
    document.documentElement.style.setProperty('--pet-size', size + 'px')
    pet.alt = settings.name || '桌宠'
    const role = (state.roles || []).find((r) => r.id === settings.roleId)
    const src = role ? role.url : 'pet-role://default/'
    if (pet.getAttribute('src') !== src) pet.setAttribute('src', src)
  }

  function currentSize() {
    return clamp(Number(state.settings && state.settings.size) || 220, 80, 480)
  }

  // ---------------------------------------------------------------- queue
  function waterDue() {
    const s = state.settings
    if (!s || s.mode === 'quiet') return false
    const w = s.water || {}
    if (inQuietHours(w)) return false
    const last = Number(w.lastDrinkAt) || 0
    if (!last) return true
    return Date.now() - last >= (Number(w.intervalMinutes) || 60) * 60000
  }

  function cupsToday() {
    const w = (state.settings && state.settings.water) || {}
    const t = w.today || {}
    return t.date === todayKey() ? Number(t.cups) || 0 : 0
  }

  function weatherAllowed() {
    const b = (state.settings && state.settings.bubble) || {}
    return Date.now() - (Number(b.lastWeatherShownAt) || 0) >= (Number(b.cooldownMinutes) || 30) * 60000
  }

  function buildQueue() {
    const order = (state.settings.bubble && state.settings.bubble.queue) || ['weather', 'water', 'random']
    const out = []
    for (const kind of order) {
      if (kind === 'weather' && weatherAllowed()) out.push('weather')
      else if (kind === 'water' && waterDue()) out.push('water')
      else if (kind === 'random') out.push('random')
    }
    if (!out.length) out.push('random')
    return out
  }

  // --------------------------------------------------------------- bubble
  function clearTimer() {
    if (state.timer) { clearTimeout(state.timer); state.timer = 0 }
  }

  function resizeForBubble(height) {
    const extra = Math.max(0, Math.round(height))
    api.setBubble(extra > 0, extra)
  }

  function showBubble(node) {
    clearTimer()
    bubble.innerHTML = ''
    bubble.appendChild(node)
    bubble.classList.add('show')
    // measure after layout, then let the window grow so the bubble is visible
    const height = Math.ceil(bubble.getBoundingClientRect().height) + 14
    resizeForBubble(height)
    const sec = Number(state.settings.bubble && state.settings.bubble.autoHideSeconds) || 0
    if (sec > 0) state.timer = setTimeout(hideBubble, sec * 1000)
  }

  function hideBubble() {
    clearTimer()
    bubble.classList.remove('show')
    resizeForBubble(0)
  }

  function advance() {
    if (!bubble.classList.contains('show')) {
      state.queue = buildQueue()
      state.queueIndex = 0
      render(state.queue[0])
      return
    }
    state.queueIndex += 1
    if (state.queueIndex >= state.queue.length) { hideBubble(); return }
    render(state.queue[state.queueIndex])
  }

  function render(kind) {
    if (kind === 'weather') return renderWeather()
    if (kind === 'water') return renderWater()
    return renderRandom()
  }

  function renderWeather() {
    const frame = el('div')
    frame.appendChild(el('div', 'title', '🌤️ 天气'))
    const body = el('div', 'sub', '正在获取…')
    frame.appendChild(body)
    const w = state.settings.weather || {}
    showBubble(frame)

    if (state.weather && state.weather.ok) paintWeather(body, state.weather)
    else if (!w.lat && !w.lon) {
      body.textContent = '还没设置城市'
      const actions = el('div', 'actions')
      const go = el('button', 'primary', '去设置')
      go.onclick = () => { hideBubble(); api.openSettings() }
      actions.appendChild(go)
      frame.appendChild(actions)
      const height = Math.ceil(frame.getBoundingClientRect().height) + 20
      resizeForBubble(Math.max(height, 80))
      return
    }

    api.refreshWeather().then((data) => {
      if (!data) return
      state.weather = data
      if (!bubble.classList.contains('show')) return
      if (data.ok) {
        body.innerHTML = ''
        paintWeather(body, data)
        const height = Math.ceil(bubble.getBoundingClientRect().height) + 14
        resizeForBubble(height)
      } else {
        body.textContent = '天气取不到：' + (data.message || '未知原因')
      }
    }).catch(() => { body.textContent = '天气服务连不上' })

    const b = Object.assign({}, state.settings.bubble, { lastWeatherShownAt: Date.now() })
    api.setSettings({ bubble: b }).catch(() => {})
  }

  function paintWeather(body, data) {
    body.innerHTML = ''
    const head = el('div', 'title')
    head.textContent = (data.icon || '🌤️') + ' ' + (data.city || '当前') + ' ' + data.temp + '°'
    body.appendChild(head)
    body.appendChild(el('div', '', data.text + '，今日 ' + data.low + '~' + data.high + '°'))
    if (Number(data.precip) > 0) body.appendChild(el('div', '', '降水概率 ' + data.precip + '%'))
    body.appendChild(el('div', 'hint', (data.stale ? '离线缓存 · ' : '') +
      '更新于 ' + fmtTime(data.updatedAt) + ' · ' + data.humidity + '% 湿度'))
  }

  function renderWater() {
    const frame = el('div')
    frame.appendChild(el('div', 'title', '💧 该喝水啦'))
    frame.appendChild(el('div', 'sub', '今天第 ' + (cupsToday() + 1) + ' 杯，慢慢喝'))
    const actions = el('div', 'actions')
    const done = el('button', 'primary', '喝过了')
    done.onclick = () => {
      api.drinkDone()
      hideBubble()
      beep(880, 90, 0.2)
      setTimeout(() => beep(1100, 110, 0.16), 110)
    }
    const later = el('button', '', '待会儿')
    later.onclick = hideBubble
    actions.appendChild(done)
    actions.appendChild(later)
    frame.appendChild(actions)
    showBubble(frame)
    beep(660, 80, 0.18)
  }

  function renderRandom() {
    const phrases = (state.settings.bubble && state.settings.bubble.phrases) || ['我在呢～']
    const frame = el('div')
    frame.appendChild(el('div', 'title', '💬 ' + (state.settings.name || '桌宠')))
    frame.appendChild(el('div', '', phrases[Math.floor(Math.random() * phrases.length)] || '我在呢～'))
    showBubble(frame)
    beep(660, 80, 0.18)
  }

  // ------------------------------------------------------------------ input
  function wirePet() {
    pet.addEventListener('pointerdown', (ev) => {
      if (ev.button != null && ev.button !== 0) return
      state.drag = { x: ev.screenX, y: ev.screenY, moved: false }
      pet.classList.add('dragging')
      try { pet.setPointerCapture(ev.pointerId) } catch (err) {}
    })

    pet.addEventListener('pointermove', (ev) => {
      const d = state.drag
      if (!d) return
      const dx = ev.screenX - d.x
      const dy = ev.screenY - d.y
      if (!d.moved && Math.abs(dx) + Math.abs(dy) < 4) return
      d.moved = true
      api.drag({ dx, dy })
      d.x = ev.screenX
      d.y = ev.screenY
    })

    function endDrag(ev) {
      const d = state.drag
      state.drag = null
      pet.classList.remove('dragging')
      try { pet.releasePointerCapture(ev.pointerId) } catch (err) {}
      if (d && d.moved) api.dragEnd()
    }
    pet.addEventListener('pointerup', endDrag)
    pet.addEventListener('pointercancel', endDrag)

    // Single click advances the queue, double click opens settings. The short
    // debounce keeps a double click from advancing twice.
    let clickTimer = 0
    pet.addEventListener('click', () => {
      if (pet.classList.contains('dragging')) return
      if (clickTimer) return
      clickTimer = setTimeout(() => { clickTimer = 0; advance() }, 240)
    })

    pet.addEventListener('contextmenu', (ev) => {
      ev.preventDefault()
      api.showMenu()
    })

    pet.addEventListener('dblclick', () => {
      if (clickTimer) { clearTimeout(clickTimer); clickTimer = 0 }
      api.openSettings()
    })
  }

  // ------------------------------------------------------------------- boot
  pet.addEventListener('load', () => console.log('pet image loaded', pet.naturalWidth + 'x' + pet.naturalHeight, pet.getAttribute('src')))
  pet.addEventListener('error', () => console.log('pet image failed', pet.getAttribute('src')))

  async function boot() {
    wirePet()
    try {
      const initial = await api.getState()
      state.roles = initial.roles || []
      state.weather = initial.weather || null
      applySettings(initial.settings)
    } catch (err) {
      console.error('[desk-pet] 初始化失败', err)
    }

    api.onSettings((settings) => {
      applySettings(settings)
      if (bubble.classList.contains('show')) {
        const height = Math.ceil(bubble.getBoundingClientRect().height) + 14
        resizeForBubble(height)
      }
    })
    api.onWeather((w) => { state.weather = w })
    api.onRemind(() => {
      if (bubble.classList.contains('show')) return
      state.queue = ['water']
      state.queueIndex = 0
      renderWater()
    })
  }

  boot()
})()
