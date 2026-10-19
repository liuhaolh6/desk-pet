/**
 * Pet renderer: sprite, speech bubble (modular), click queue, drag, sounds.
 *
 * Bubble content is data: `settings.bubble.layout` (see bubble-model.js) holds
 * cards made of rows of modules. The editor window edits that same structure.
 */
(function () {
  const api = window.deskPet
  const model = window.DeskPetBubble
  const pet = document.getElementById('pet')
  const bubble = document.getElementById('bubble')

  const state = {
    settings: null,
    roles: [],
    weather: null,
    layout: null,
    queue: [],
    queueIndex: 0,
    currentCard: null,
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
    state.layout = model.normalizeLayout(settings.bubble && settings.bubble.layout)
    const size = clamp(Number(settings.size) || 220, 80, 480)
    document.documentElement.style.setProperty('--pet-size', size + 'px')
    pet.alt = settings.name || '桌宠'
    const role = (state.roles || []).find((r) => r.id === settings.roleId)
    const src = role ? role.url : 'pet-role://default/'
    if (pet.getAttribute('src') !== src) pet.setAttribute('src', src)
  }

  // ---------------------------------------------------------------- queue
  function cupsToday() {
    const w = (state.settings && state.settings.water) || {}
    const t = w.today || {}
    return t.date === todayKey() ? Number(t.cups) || 0 : 0
  }

  function waterDue() {
    const s = state.settings
    if (!s || s.mode === 'quiet') return false
    const w = s.water || {}
    if (inQuietHours(w)) return false
    const last = Number(w.lastDrinkAt) || 0
    if (!last) return true
    return Date.now() - last >= (Number(w.intervalMinutes) || 60) * 60000
  }

  function weatherAllowed() {
    const b = (state.settings && state.settings.bubble) || {}
    return Date.now() - (Number(b.lastWeatherShownAt) || 0) >= (Number(b.cooldownMinutes) || 30) * 60000
  }

  /** The queue stores card ids; each card decides whether it is "due" now. */
  function available(cardId) {
    if (cardId === 'weather') return weatherAllowed()
    if (cardId === 'water') return waterDue()
    return true
  }

  function buildQueue() {
    const ids = (state.layout && state.layout.queue) || []
    const cards = (state.layout && state.layout.cards) || []
    const out = ids.filter((id) => cards.some((c) => c.id === id) && available(id))
    if (!out.length) {
      const fallback = cards.find((c) => c.id === 'random') || cards[0]
      if (fallback) out.push(fallback.id)
    }
    return out
  }

  function cardById(id) {
    return ((state.layout && state.layout.cards) || []).find((c) => c.id === id) || null
  }

  // --------------------------------------------------------------- bubble
  function clearTimer() {
    if (state.timer) { clearTimeout(state.timer); state.timer = 0 }
  }

  function resizeForBubble(height) {
    const extra = Math.max(0, Math.round(height))
    api.setBubble(extra > 0, extra)
  }

  function measureBubble() {
    return Math.ceil(bubble.getBoundingClientRect().height) + 14
  }

  function showBubble(node) {
    clearTimer()
    bubble.innerHTML = ''
    bubble.appendChild(node)
    bubble.classList.add('show')
    resizeForBubble(measureBubble())
    const sec = Number(state.settings.bubble && state.settings.bubble.autoHideSeconds) || 0
    if (sec > 0) state.timer = setTimeout(hideBubble, sec * 1000)
  }

  function hideBubble() {
    clearTimer()
    state.currentCard = null
    bubble.classList.remove('show')
    resizeForBubble(0)
  }

  function advance() {
    if (!bubble.classList.contains('show')) {
      state.queue = buildQueue()
      state.queueIndex = 0
      renderCurrent()
      return
    }
    state.queueIndex += 1
    if (state.queueIndex >= state.queue.length) { hideBubble(); return }
    renderCurrent()
  }

  function renderCurrent() {
    const id = state.queue[state.queueIndex]
    const card = cardById(id)
    if (!card) return hideBubble()
    renderCard(card, id)
  }

  function contextFor(card) {
    const s = state.settings
    const w = s.water || {}
    return {
      weather: state.weather,
      phrases: (s.bubble && s.bubble.phrases) || [],
      name: s.name,
      cups: card.id === 'water' ? cupsToday() + 1 : cupsToday(),
      nextAt: (Number(w.lastDrinkAt) || 0) + (Number(w.intervalMinutes) || 60) * 60000,
    }
  }

  function renderCard(card, cardId) {
    state.currentCard = cardId
    const ctx = contextFor(card)
    const frame = el('div')
    let rows = model.pruneRows(model.resolveCard(card, ctx))
    if (!rows.length) rows = [[{ text: '…', css: '' }]]

    rows.forEach((row) => {
      const line = el('div', 'bubble-row')
      row.forEach((item) => {
        const span = el('span', 'bubble-mod', item.text)
        if (item.css) span.setAttribute('style', item.css)
        line.appendChild(span)
      })
      frame.appendChild(line)
    })

    if (card.action) frame.appendChild(actionButtons())
    showBubble(frame)

    if (cardId === 'weather') {
      const b = Object.assign({}, state.settings.bubble, { lastWeatherShownAt: Date.now() })
      api.setSettings({ bubble: b }).catch(() => {})
      api.refreshWeather().then((data) => {
        if (!data) return
        state.weather = data
        if (state.currentCard === 'weather' && bubble.classList.contains('show')) {
          renderCard(card, cardId)
        }
      }).catch(() => {})
    }
    beep(660, 80, 0.18)
  }

  function actionButtons() {
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
    return actions
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

    // Single click advances, double click opens settings; the debounce keeps a
    // double click from advancing twice.
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
        const id = state.currentCard
        const card = id ? cardById(id) : null
        if (card) renderCard(card, id)
        else resizeForBubble(measureBubble())
      }
    })
    api.onWeather((w) => {
      state.weather = w
      if (state.currentCard === 'weather' && bubble.classList.contains('show')) {
        const card = cardById('weather')
        if (card) renderCard(card, 'weather')
      }
    })
    api.onRemind(() => {
      if (bubble.classList.contains('show')) return
      const card = cardById('water')
      if (!card) return
      state.queue = ['water']
      state.queueIndex = 0
      renderCard(card, 'water')
    })
  }

  boot()
})()
