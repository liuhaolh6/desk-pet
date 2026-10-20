/**
 * Pet renderer: sprite, speech bubble (modular), click queue, drag, sounds.
 *
 * Bubble content is data: `settings.bubble.layout` (see bubble-model.js) holds
 * cards made of rows of modules. The editor window edits that same structure.
 */
(function () {
  const api = window.deskPet
  const model = window.DeskPetBubble
  const sound = window.DeskPetSound
  const pet = document.getElementById('pet')
  const petWrap = document.getElementById('petWrap')
  const petFlip = document.getElementById('petFlip')
  const menuBtn = document.getElementById('menuBtn')
  const petMenu = document.getElementById('petMenu')
  const bubble = document.getElementById('bubble')
  const menuActions = Array.from(petMenu.querySelectorAll('button[data-action]'))

  const state = {
    settings: null,
    roles: [],
    weather: null,
    layout: null,
    sounds: [],
    queue: [],
    queueIndex: 0,
    currentCard: null,
    timer: 0,
    drag: null,
    weatherMarked: false,
    weatherFetchedAt: 0,
    menuOpen: false,
    menuDismissAt: 0,
    bubbleToken: 0,
    showTimer: 0,
    shrinkTimer: 0,
    menuShowTimer: 0,
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
  function playSound(key) {
    const settings = state.settings
    if (!settings) return
    const volume = sound.eventVolume(settings.sound, key)
    if (!(volume > 0)) return
    const event = sound.normalizeSound(settings.sound).events[key]
    if (!event || !event.enabled) return
    sound.playFragment(event.fragment, volume, state.sounds)
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
    // +30 leaves room for the two thought-dots below the cloud (20px) and a
    // small top margin (10px). offsetHeight ignores the closed-state transform.
    return Math.ceil(bubble.offsetHeight) + 30
  }

  function showBubble(node) {
    clearTimer()
    clearTimeout(state.showTimer)
    clearTimeout(state.shrinkTimer)
    if (state.menuOpen) closeMenu(true)
    const token = ++state.bubbleToken
    bubble.classList.remove('show')
    bubble.innerHTML = ''
    bubble.appendChild(node)
    // Reserve the window height first, then fade the cloud in on the next
    // frame. Showing it before the OS resize lands clips the top of the cloud.
    const height = measureBubble()
    resizeForBubble(height)
    void bubble.offsetHeight
    state.showTimer = setTimeout(() => {
      if (state.bubbleToken !== token) return
      bubble.classList.add('show')
    }, 50)
    const sec = Number(state.settings.bubble && state.settings.bubble.autoHideSeconds) || 0
    if (sec > 0) state.timer = setTimeout(hideBubble, sec * 1000)
  }

  function hideBubble() {
    clearTimer()
    clearTimeout(state.showTimer)
    state.bubbleToken += 1
    state.currentCard = null
    state.weatherMarked = false
    bubble.classList.remove('show')
    // Let the fade-out finish before removing the reserved window space.
    clearTimeout(state.shrinkTimer)
    state.shrinkTimer = setTimeout(() => {
      if (!bubble.classList.contains('show') && !state.menuOpen) resizeForBubble(0)
    }, 200)
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

  function renderCard(card, cardId, options) {
    const opts = options || {}
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

    if (opts.playSound !== false) playSound(cardId === 'water' ? 'water' : 'bubble')

    // Weather bookkeeping must happen ONCE per showing. Doing it on every
    // render used to loop: setSettings -> settings broadcast -> re-render -> ...
    if (cardId === 'weather' && opts.markWeather !== false && !state.weatherMarked) {
      state.weatherMarked = true
      const b = Object.assign({}, state.settings.bubble, { lastWeatherShownAt: Date.now() })
      api.setSettings({ bubble: b }).catch(() => {})
    }

    if (cardId === 'weather' && Date.now() - state.weatherFetchedAt > 60000) {
      state.weatherFetchedAt = Date.now()
      api.refreshWeather().then((data) => {
        if (!data || !data.ok) return
        state.weather = data
        if (state.currentCard === 'weather' && bubble.classList.contains('show')) {
          renderCard(card, cardId, { playSound: false, markWeather: false })
        }
      }).catch(() => {})
    }
  }

  function actionButtons() {
    const actions = el('div', 'actions')
    const done = el('button', 'primary', '喝过了')
    done.onclick = () => {
      api.drinkDone()
      hideBubble()
      playSound('water')
    }
    const later = el('button', '', '待会儿')
    later.onclick = hideBubble
    actions.appendChild(done)
    actions.appendChild(later)
    return actions
  }

  // ----------------------------------------------------------------- hover
  let hoverTimer = 0

  function showHover() {
    clearTimeout(hoverTimer)
    petWrap.classList.add('hover')
  }

  function hideHoverSoon() {
    clearTimeout(hoverTimer)
    hoverTimer = setTimeout(() => {
      if (!state.menuOpen) petWrap.classList.remove('hover')
    }, 260)
  }

  // ------------------------------------------------------------------ menu
  function measureMenu() {
    return Math.ceil(petMenu.offsetHeight) + 20
  }

  function openMenu() {
    if (state.menuOpen) return
    if (bubble.classList.contains('show')) hideBubble()
    clearTimeout(state.shrinkTimer)
    clearTimeout(state.showTimer)
    state.menuOpen = true
    petMenu.hidden = false
    petWrap.classList.add('hover', 'menu-open')
    void petMenu.offsetHeight
    // Reserve the window height before the panel becomes visible.
    const height = measureMenu()
    api.setBubble(true, height)
    clearTimeout(state.menuShowTimer)
    state.menuShowTimer = setTimeout(() => {
      if (!state.menuOpen) return
      petMenu.classList.add('open')
      const first = petMenu.querySelector('button')
      if (first) first.focus({ preventScroll: true })
    }, 50)
  }

  function closeMenu(immediate) {
    if (!state.menuOpen) return
    state.menuOpen = false
    clearTimeout(state.menuShowTimer)
    petMenu.classList.remove('open')
    petWrap.classList.remove('menu-open')
    const finish = () => {
      if (state.menuOpen) return
      petMenu.hidden = true
      // Do not shrink the window if a bubble was opened in the meantime.
      if (!bubble.classList.contains('show')) api.setBubble(false, 0)
    }
    if (immediate) finish()
    else setTimeout(finish, 180)
    if (!petMenu.matches(':hover')) hideHoverSoon()
  }

  function toggleMenu() {
    if (state.menuOpen) closeMenu()
    else openMenu()
  }

  function wireMenu() {
    menuBtn.addEventListener('click', (ev) => {
      ev.preventDefault()
      ev.stopPropagation()
      showHover()
      toggleMenu()
    })
    menuBtn.addEventListener('pointerenter', showHover)
    petWrap.addEventListener('pointerenter', showHover)
    petWrap.addEventListener('pointerleave', hideHoverSoon)
    petMenu.addEventListener('pointerenter', showHover)
    petMenu.addEventListener('pointerleave', hideHoverSoon)

    menuActions.forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.preventDefault()
        ev.stopPropagation()
        const action = btn.dataset.action
        closeMenu()
        if (action === 'settings') api.openSettings()
        else if (action === 'editor') api.openEditor()
        else if (action === 'weather') api.refreshWeather()
        else if (action === 'hide') api.hidePet()
        else if (action === 'quit') api.quit()
      })
    })

    document.addEventListener('pointerdown', (ev) => {
      if (!state.menuOpen) return
      if (petMenu.contains(ev.target) || menuBtn.contains(ev.target)) return
      closeMenu()
      state.menuDismissAt = Date.now()
    }, true)

    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && state.menuOpen) {
        closeMenu()
        menuBtn.focus({ preventScroll: true })
      }
    })

    window.addEventListener('blur', () => closeMenu(true))
  }

  // ------------------------------------------------------------------ input
  // A drag ends with a synthetic click; suppress it so dragging never pops a
  // bubble open.
  let suppressClickUntil = 0

  function wirePet() {
    pet.addEventListener('pointerdown', (ev) => {
      if (ev.button != null && ev.button !== 0) return
      state.drag = { x: ev.screenX, y: ev.screenY, moved: false, totalX: 0, startAt: performance.now() }
      petWrap.classList.add('pressing')
      try { pet.setPointerCapture(ev.pointerId) } catch (err) {}
    })

    pet.addEventListener('pointermove', (ev) => {
      const d = state.drag
      if (!d) return
      const dx = ev.screenX - d.x
      const dy = ev.screenY - d.y
      if (!d.moved && Math.abs(dx) + Math.abs(dy) < 4) return
      if (!d.moved) {
        d.moved = true
        // Drop the bubble only once a real drag starts. Hiding it on every
        // pointerdown used to reset the click queue before `advance()` ran.
        if (bubble.classList.contains('show')) hideBubble()
        petWrap.classList.remove('pressing')
        petWrap.classList.add('dragging')
      }
      d.totalX += dx
      const tilt = clamp(d.totalX * 0.15, -3, 3)
      petWrap.style.setProperty('--drag-tilt', tilt.toFixed(2) + 'deg')
      api.drag({ dx, dy })
      d.x = ev.screenX
      d.y = ev.screenY
    })

    function endDrag(ev) {
      const d = state.drag
      state.drag = null
      petWrap.classList.remove('dragging')
      petWrap.style.setProperty('--drag-tilt', '0deg')
      try { pet.releasePointerCapture(ev.pointerId) } catch (err) {}
      if (d && d.moved) {
        petWrap.classList.remove('pressing')
        suppressClickUntil = Date.now() + 600
        api.dragEnd()
      } else {
        const elapsed = performance.now() - (d ? d.startAt : 0)
        if (elapsed < 36) setTimeout(() => petWrap.classList.remove('pressing'), 36 - elapsed)
        else petWrap.classList.remove('pressing')
      }
    }
    pet.addEventListener('pointerup', endDrag)
    pet.addEventListener('pointercancel', endDrag)

    // Single click advances, double click opens settings; the debounce keeps a
    // double click from advancing twice.
    let clickTimer = 0
    pet.addEventListener('click', () => {
      if (petWrap.classList.contains('dragging')) return
      if (Date.now() < suppressClickUntil) return
      if (Date.now() - state.menuDismissAt < 260) return
      if (clickTimer) return
      clickTimer = setTimeout(() => {
        clickTimer = 0
        playSound('click')
        advance()
      }, 240)
    })

    pet.addEventListener('contextmenu', (ev) => {
      ev.preventDefault()
      if (state.menuOpen) closeMenu(true)
      api.showMenu()
    })

    pet.addEventListener('dblclick', () => {
      if (clickTimer) { clearTimeout(clickTimer); clickTimer = 0 }
      api.openSettings()
    })
  }

  // ------------------------------------------------------------------- boot
  async function boot() {
    wireMenu()
    wirePet()
    api.onMirror((side) => {
      petFlip.style.setProperty('--pet-flip', side === 'none' ? 1 : -1)
    })
    try {
      const initial = await api.getState()
      state.roles = initial.roles || []
      state.weather = initial.weather || null
      applySettings(initial.settings)
      try { state.sounds = await api.listSounds() } catch (err) {}
    } catch (err) {
      console.error('[desk-pet] 初始化失败', err)
    }

    api.onSettings((settings) => {
      const prevLayout = JSON.stringify(state.layout)
      const prevName = state.settings && state.settings.name
      applySettings(settings)
      // Size/theme changes can move the menu anchor; just close it and let the
      // next hover measure again.
      if (state.menuOpen) closeMenu(true)
      // Only redraw when the bubble itself changed; settings broadcasts caused by
      // our own weather bookkeeping must not trigger another render/sound.
      const changed = JSON.stringify(state.layout) !== prevLayout || settings.name !== prevName
      if (!changed) return
      if (bubble.classList.contains('show')) {
        const id = state.currentCard
        const card = id ? cardById(id) : null
        if (card) renderCard(card, id, { playSound: false, markWeather: false })
        else resizeForBubble(measureBubble())
      }
    })
    api.onWeather((w) => {
      state.weather = w
      if (state.currentCard === 'weather' && bubble.classList.contains('show')) {
        const card = cardById('weather')
        if (card) renderCard(card, 'weather', { playSound: false, markWeather: false })
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
