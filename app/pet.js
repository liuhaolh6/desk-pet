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
  const bubbleContent = document.getElementById('bubbleContent')
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
    lastReserve: -1,
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
    // Photo-derived roles (and the built-in portrait, which is `builtin: true`)
    // have soft alpha edges; the normal desktop shadow turns them into a dark
    // halo, so use a lighter one for them.
    document.body.classList.toggle('photo-role', !!(role && (role.mode || role.builtin)))
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

  // ------------------------------------------- mouse passthrough (0.6.2)
  // The window keeps a fixed bubble strip reserved, so most of its area is
  // transparent. The main process decides click-through from the OS cursor and
  // the rects reported here (renderer mousemove is not reliable enough for the
  // first move after switching modes).
  let rectsDirty = false
  function reportHitRects() {
    rectsDirty = false
    const rects = []
    const push = (el) => {
      if (!el) return
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) rects.push({ x: r.left, y: r.top, w: r.width, h: r.height })
    }
    push(petWrap)
    if (bubble.classList.contains('show')) {
      // The cloud is an ellipse-ish shape inside a rectangular SVG box. Three
      // stacked bands approximate it, so the empty corners stay click-through
      // while the body of the bubble is a solid target.
      const r = bubble.getBoundingClientRect()
      const band = (topF, hF, wF) => {
        const w = r.width * wF
        rects.push({ x: r.left + (r.width - w) / 2, y: r.top + r.height * topF, w, h: r.height * hF })
      }
      band(0.05, 0.26, 0.74)
      band(0.30, 0.26, 0.92)
      band(0.55, 0.20, 0.70)
    }
    if (state.menuOpen) { push(petMenu); push(menuBtn) }
    try { api.sendRects(rects) } catch (err) {}
  }

  function scheduleRectReport() {
    if (rectsDirty) return
    rectsDirty = true
    requestAnimationFrame(reportHitRects)
  }

  async function resizeForBubble(height) {
    const extra = Math.max(0, Math.round(height))
    if (window.DESKPET_TRACE_BUBBLE && extra !== state.lastReserve) {
      state.lastReserve = extra
      console.log('bubble-resize', extra)
    }
    let res = { reserve: extra, side: 'above' }
    try {
      const granted = await api.setBubble(extra > 0, extra)
      if (granted && typeof granted === 'object') res = granted
    } catch (err) {}
    applyBubbleRoom(res)
    return res
  }

  function applyBubbleRoom(res) {
    const side = res && res.side === 'below' ? 'below' : 'above'
    const reserve = Math.max(0, Math.round(Number(res && res.reserve) || 0))
    document.body.dataset.bubbleSide = side
    document.body.style.setProperty('--bubble-room', reserve + 'px')
  }

  // ------------------------------------------------- bubble geometry (0.6.1)
  // Contract borrowed from dsh-whale-widget: one fixed-aspect SVG frame, one
  // scale unit (--u), text inside the frame's safe area. Font sizes authored in
  // the editor are px at BUBBLE_REF_W, and are re-expressed in --u at render
  // time, so shape and text always scale together and text cannot overflow.
  const BUBBLE_REF_W = 300
  const BUBBLE_MIN_W = 220
  const BUBBLE_MAX_W = 340

  function syncBubbleMetrics() {
    const avail = Math.round(window.innerWidth) - 12
    const w = Math.max(BUBBLE_MIN_W, Math.min(BUBBLE_MAX_W, avail))
    document.body.style.setProperty('--bubble-w', w + 'px')
    document.body.style.setProperty('--u', (w / 1026).toFixed(4) + 'px')
    measureBubbleCentre()
  }

  /**
 * Centre the text on where the cloud is actually painted, not on the viewBox
 * geometry: the frame has a wide arc plus an 18-unit stroke, so the geometric
 * bbox centre and the painted centre differ by ~6% (that was the "text sits to
 * the left" bug). Measured in screen space against the bubble box.
 */
  function measureBubbleCentre() {
    try {
      const shape = bubble.querySelector('.bubble-bshape')
      if (!shape) return
      const br = bubble.getBoundingClientRect()
      const sr = shape.getBoundingClientRect()
      if (!br.width || !br.height || !sr.width || !sr.height) return
      const vx = ((sr.left + sr.width / 2 - br.left) / br.width) * 100
      const vy = ((sr.top + sr.height / 2 - br.top) / br.height) * 100
      if (!isFinite(vx) || !isFinite(vy)) return
      bubble.style.setProperty('--bubble-vx', vx.toFixed(2) + '%')
      bubble.style.setProperty('--bubble-vy', vy.toFixed(2) + '%')
    } catch (err) {}
  }

  /** Editor px -> --u multiples (1026 design units per frame width). */
  function scaleModuleCss(css) {
    if (!css) return ''
    const k = 1026 / BUBBLE_REF_W
    return css
      .replace(/font-size:\s*([\d.]+)px/g, (m, n) => 'font-size:calc(var(--u) * ' + (Number(n) * k).toFixed(2) + ')')
      .replace(/border-radius:\s*([\d.]+)px/g, (m, n) => 'border-radius:calc(var(--u) * ' + (Number(n) * k).toFixed(2) + ')')
      .replace(/padding:\s*0\s+([\d.]+)px/g, (m, n) => 'padding:0 calc(var(--u) * ' + (Number(n) * k).toFixed(2) + ')')
  }

  /** Shrink the text layer until it fits its safe area (never grows past 1). */
  // Shrinking stops here (P0-2, 0.6.6): below 60% of the base size the text turns
  // into unreadable mush, so past the floor we drop words instead of pixels and
  // keep the full string on the span (title + aria-label) for hover and AT.
  const FIT_FLOOR = 0.6

  // Overflow is measured from the rendered child's rect so it covers spill on
  // either end (the safe area is centred with `justify-content: center`). The
  // earlier "long text never truncated" report was NOT this metric: a module is
  // capped at 200 chars by bubble-model.js, so a single 500-char test module was
  // silently cut to 200 and fit fine. Long cards need several modules to test.
  function overflowAmount() {
    const frame = bubbleContent.firstElementChild
    if (!frame) return { w: 0, h: 0 }
    const box = bubbleContent.getBoundingClientRect()
    const inner = frame.getBoundingClientRect()
    return {
      w: Math.max(0, inner.width - box.width),
      h: Math.max(0, box.top - inner.top, inner.bottom - box.bottom),
    }
  }

  /**
   * Trim the longest module until the card fits the cloud's safe area.
   *
   * Runs after the font-size fit. Re-entrant on purpose: every call restores the
   * original text from `data-full` first, so switching cards (or a settings
   * broadcast that re-renders) never truncates twice.
   */
  function clampBubbleText() {
    const spans = Array.from(bubbleContent.querySelectorAll('.bubble-mod'))
    if (!spans.length) return
    spans.forEach((span) => {
      if (span.dataset.full == null) span.dataset.full = span.textContent || ''
      else span.textContent = span.dataset.full
      const full = span.dataset.full
      if (full) {
        span.title = full
        span.setAttribute('aria-label', full)
      }
    })
    // Proportional trim: the first implementation shaved 10% off the longest
    // module per pass, which needs ~80 passes for a genuinely long card and ran
    // into the guard while still 35px too tall (P0-2 CDP check). Estimate the
    // overshoot from the actual box and shorten every module by that ratio.
    for (let guard = 0; guard < 40; guard++) {
      const over = overflowAmount()
      if (!over.w && !over.h) return
      const h = bubbleContent.clientHeight || 1
      const w = bubbleContent.clientWidth || 1
      const ratio = Math.max(over.h / h, over.w / w, 0.05)
      const keepRatio = Math.max(0.5, 1 - ratio * 1.1)
      let changed = false
      for (const span of spans) {
        const text = span.textContent || ''
        if (text.length <= 1) continue
        const keep = Math.max(1, Math.floor(text.length * keepRatio))
        if (keep >= text.length) continue
        span.textContent = text.slice(0, keep).replace(/[\s，、,。.!！?？;；:：]+$/u, '') + '…'
        changed = true
      }
      if (!changed) return
    }
  }

  function fitBubbleText() {
    let fit = 1
    for (let i = 0; i < 4; i++) {
      document.body.style.setProperty('--bubble-fit', fit.toFixed(3))
      const cw = bubbleContent.clientWidth
      const ch = bubbleContent.clientHeight
      if (!cw || !ch) break
      const need = Math.min(1, cw / Math.max(bubbleContent.scrollWidth, 1), ch / Math.max(bubbleContent.scrollHeight, 1))
      if (need >= 0.995) break
      fit = Math.max(FIT_FLOOR, fit * need * 0.97)
    }
    document.body.style.setProperty('--bubble-fit', fit.toFixed(3))
    clampBubbleText()
  }

  function bubbleReserve() {
    return Math.ceil(bubble.getBoundingClientRect().height) + 8
  }

  /** Re-measure after a size change. The strip stays reserved (0.6.4). */
  async function syncBubbleSpace() {
    syncBubbleMetrics()
    fitBubbleText()
    if (state.menuOpen) return resizeForBubble(Math.max(bubbleReserve(), measureMenu()))
    return resizeForBubble(bubbleReserve())
  }

  async function showBubble(node) {
    state.wantBubble = true
    clearTimer()
    clearTimeout(state.showTimer)
    if (state.menuOpen) closeMenu(true)
    const token = ++state.bubbleToken
    bubble.classList.remove('show')
    bubbleContent.innerHTML = ''
    bubbleContent.appendChild(node)
    // The space is constant per pet size (see 0.6.1 fixed reserve), so this
    // call never resizes the window between two cards: it only re-decides which
    // side of the pet can host the bubble.
    syncBubbleMetrics()
    fitBubbleText()
    const reserve = bubbleReserve()
    if (window.DESKPET_TRACE_BUBBLE) console.log('bubble-reserve', reserve, 'w=' + bubble.offsetWidth, 'h=' + bubble.offsetHeight, 'inner=' + window.innerWidth)
    await resizeForBubble(reserve)
    if (state.bubbleToken !== token) return
    void bubble.offsetHeight
    state.showTimer = setTimeout(() => {
      if (state.bubbleToken !== token) return
      bubble.classList.add('show')
      scheduleRectReport()
      setTimeout(scheduleRectReport, 520)
    }, 50)
    const sec = Number(state.settings.bubble && state.settings.bubble.autoHideSeconds) || 0
    if (sec > 0) state.timer = setTimeout(hideBubble, sec * 1000)
  }

  function hideBubble() {
    state.wantBubble = false
    clearTimer()
    clearTimeout(state.showTimer)
    state.bubbleToken += 1
    state.currentCard = null
    state.weatherMarked = false
    bubble.classList.remove('show')
    // 0.6.4: no shrink here. Resizing the transparent window is what produced
    // the flicker; the strip is click-through instead (main-process hit poll).
    scheduleRectReport()
  }

  function wireBubbleClick() {
    // Clicking the bubble puts it away (0.6.3). The action chips inside it do
    // their own thing first and the click bubbles up to here afterwards.
    bubble.addEventListener('click', (ev) => {
      if (!bubble.classList.contains('show')) return
      const btn = ev.target && ev.target.closest ? ev.target.closest('.bubble-act') : null
      void btn
      hideBubble()
    })
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

  const WATER_TIPS = [
    '慢慢喝，别急呀',
    '温温的水最舒服',
    '喝一口，歇一会儿',
    '我在旁边陪你喝',
    '小口小口，刚刚好',
  ]

  /** One warm line that fits the current hour and cup count. */
  function waterTip(cups, hour) {
    if (hour >= 22 || hour < 6) return '太晚啦，抿一小口就好'
    if (cups <= 1) return '才刚开始，慢慢来呀'
    if (cups >= 8) return '今天很乖，睡前少喝一点点'
    return WATER_TIPS[(cups + hour) % WATER_TIPS.length]
  }

  function contextFor(card) {
    const s = state.settings
    const w = s.water || {}
    const cups = card.id === 'water' ? cupsToday() + 1 : cupsToday()
    const quietFrom = Number(w.quietFrom)
    const quietTo = Number(w.quietTo)
    const quiet = Number.isFinite(quietFrom) && Number.isFinite(quietTo) && quietFrom !== quietTo
      ? { from: quietFrom, to: quietTo }
      : null
    return {
      weather: state.weather,
      phrases: (s.bubble && s.bubble.phrases) || [],
      name: s.name,
      cups,
      nextAt: (Number(w.lastDrinkAt) || 0) + (Number(w.intervalMinutes) || 60) * 60000,
      interval: Number(w.intervalMinutes) || 60,
      quiet,
      lastDrinkAt: Number(w.lastDrinkAt) || 0,
      waterTip: waterTip(cups, new Date().getHours()),
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
        const css = scaleModuleCss(item.css)
        if (css) span.setAttribute('style', css)
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

  // Hybrid touch devices (touch screen + mouse) report `hover: hover`, so the
  // `@media (hover: none)` menu affordance does not apply. Reveal the menu button
  // for a few seconds after a touch without touching #pet's filter (which used to
  // flash on press).
  let touchUiTimer = 0

  function showTouchUi() {
    clearTimeout(touchUiTimer)
    petWrap.classList.add('touch-ui')
    touchUiTimer = setTimeout(() => petWrap.classList.remove('touch-ui'), 4000)
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
    clearTimeout(state.showTimer)
    state.menuOpen = true
    petMenu.hidden = false
    scheduleRectReport()
    petWrap.classList.add('hover', 'menu-open')
    void petMenu.offsetHeight
    // 0.6.2: reserve max(bubble strip, menu) so opening/closing the menu never
    // shrinks the transparent window (one less flash source).
    resizeForBubble(Math.max(bubbleReserve(), measureMenu()))
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
    scheduleRectReport()
    clearTimeout(state.menuShowTimer)
    petMenu.classList.remove('open')
    petWrap.classList.remove('menu-open')
    const finish = () => {
      if (state.menuOpen) return
      petMenu.hidden = true
      if (!bubble.classList.contains('show')) resizeForBubble(bubbleReserve())
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
    // Touch has no hover: firing pointerenter on a touch press used to apply the
    // hover drop-shadow, which animates `filter` on a transparent window and
    // shows as a screen flash. Only real pointer hover may trigger it.
    // Chromium also emits compatibility mouse events right after a tap, so keep
    // a short suppression window after any touch pointer.
    let lastTouchAt = 0
    const markTouch = (ev) => { if (ev && ev.pointerType === 'touch') lastTouchAt = performance.now() }
    const hoverForPointer = (ev) => {
      markTouch(ev)
      if (ev && ev.pointerType === 'touch') return
      if (performance.now() - lastTouchAt < 900) return
      showHover()
    }
    const leaveForPointer = (ev) => {
      markTouch(ev)
      if (ev && ev.pointerType === 'touch') return
      hideHoverSoon()
    }
    menuBtn.addEventListener('pointerenter', hoverForPointer)
    petWrap.addEventListener('pointerenter', hoverForPointer)
    petWrap.addEventListener('pointerleave', leaveForPointer)
    petMenu.addEventListener('pointerenter', hoverForPointer)
    petMenu.addEventListener('pointerleave', leaveForPointer)

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
    // Coalesce drag updates to one per animation frame: one IPC + one window
    // move per frame instead of one per pointer event (which stutters).
    let dragAccX = 0
    let dragAccY = 0
    let dragRaf = 0

    function flushDrag() {
      dragRaf = 0
      if (!dragAccX && !dragAccY) return
      const dx = dragAccX
      const dy = dragAccY
      dragAccX = 0
      dragAccY = 0
      api.drag({ dx, dy })
    }

    function queueDrag(dx, dy) {
      dragAccX += dx
      dragAccY += dy
      if (!dragRaf) dragRaf = requestAnimationFrame(flushDrag)
    }

    pet.addEventListener('pointerdown', (ev) => {
      if (ev.button != null && ev.button !== 0) return
      if (ev.pointerType === 'touch') showTouchUi()
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
        try { api.setDragging(true) } catch (err) {}
      }
      d.totalX += dx
      const tilt = clamp(d.totalX * 0.15, -3, 3)
      petWrap.style.setProperty('--drag-tilt', tilt.toFixed(2) + 'deg')
      queueDrag(dx, dy)
      d.x = ev.screenX
      d.y = ev.screenY
    })

    function endDrag(ev) {
      const d = state.drag
      state.drag = null
      petWrap.classList.remove('dragging')
      try { api.setDragging(false) } catch (err) {}
      petWrap.style.setProperty('--drag-tilt', '0deg')
      try { pet.releasePointerCapture(ev.pointerId) } catch (err) {}
      if (dragRaf) { cancelAnimationFrame(dragRaf); dragRaf = 0 }
      if (d && d.moved) {
        // Flush whatever is still pending so the window lands where the pointer
        // ended instead of one frame behind.
        if (dragAccX || dragAccY) flushDrag()
        petWrap.classList.remove('pressing')
        suppressClickUntil = Date.now() + 600
        api.dragEnd()
      } else {
        // Hold the dip long enough to finish its (monotone) transition before
        // reversing. Reversing mid-flight is what produced stray scale frames.
        const elapsed = performance.now() - (d ? d.startAt : 0)
        if (elapsed < 110) setTimeout(() => petWrap.classList.remove('pressing'), 110 - elapsed)
        else petWrap.classList.remove('pressing')
      }
    }
    pet.addEventListener('pointerup', endDrag)
    pet.addEventListener('pointercancel', endDrag)

    // Single click advances the card queue. Settings live in the hover menu;
    // there is intentionally no double-click shortcut or pet right-click menu.
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
  }

  // ------------------------------------------------------------------- boot
  async function boot() {
    wireMenu()
    wirePet()
    wireBubbleClick()
    // 0.6.1: reserve the bubble strip once and keep it; content swaps never
    // resize the transparent window again.
    syncBubbleMetrics()
    fitBubbleText()
    resizeForBubble(bubbleReserve()).catch(() => {})
    window.addEventListener('resize', () => { syncBubbleSpace().catch(() => {}) })
    reportHitRects()
    window.addEventListener('resize', scheduleRectReport)
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
    // Role list can change without a settings write (import/cutout/delete).
    // Without this the pet keeps the stale list and falls back to the default
    // sprite after saving a new role.
    api.onRoles((roles) => {
      state.roles = Array.isArray(roles) ? roles : []
      if (state.settings) applySettings(state.settings)
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
