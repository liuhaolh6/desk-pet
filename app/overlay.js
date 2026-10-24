'use strict'

/**
 * P2-4：独立气泡/菜单窗口的渲染层。
 *
 * 卡片数据由桌宠窗口算好（require 气泡模型、天气、喝水状态都在那边），
 * 这里只负责画：换算 --u、渲染行、缩字号到下限（0.6）后按比例截断、
 * 把点击/按钮转发回桌宠窗口。这样气泡窗口本身没有任何业务状态。
 *
 * 阶段二起悬停菜单也画在这里：面板尺寸由主进程量、窗口跟着变，
 * 点击按 data-action 回给主进程再转给桌宠窗口，和气泡按钮同一条路。
 */
;(() => {
  const api = window.deskPet
  const bubble = document.getElementById('bubble')
  const content = document.getElementById('bubbleContent')
  const menu = document.getElementById('petMenu')

  const BUBBLE_REF_W = 300
  const FIT_FLOOR = 0.6
  // 0.6.11：内容装不下时，气泡窗口按 0.18 一档变大（最多 1.54 倍宽），
  // 而不是把字缩到看不清或把按钮挤出窗口。主进程负责真实尺寸。
  const GROW_STEP = 0.18
  const MAX_SCALE = 1.54
  let askedScale = 1

  function el(tag, cls, text) {
    const node = document.createElement(tag)
    if (cls) node.className = cls
    if (text != null) node.textContent = text
    return node
  }

  /** 编辑器的 px 是 BUBBLE_REF_W 下的尺寸，这里换算成 --u 的倍数。 */
  function scaleModuleCss(css) {
    if (!css) return ''
    const k = 1026 / BUBBLE_REF_W
    return css
      .replace(/font-size:\s*([\d.]+)px/g, (m, n) => 'font-size:calc(var(--u) * ' + (Number(n) * k).toFixed(2) + ')')
      .replace(/border-radius:\s*([\d.]+)px/g, (m, n) => 'border-radius:calc(var(--u) * ' + (Number(n) * k).toFixed(2) + ')')
      .replace(/padding:\s*0\s+([\d.]+)px/g, (m, n) => 'padding:0 calc(var(--u) * ' + (Number(n) * k).toFixed(2) + ')')
  }

  function syncMetrics() {
    const w = Math.max(1, Math.round(window.innerWidth))
    document.body.style.setProperty('--bubble-w', w + 'px')
    document.body.style.setProperty('--u', (w / 1026).toFixed(4) + 'px')
  }

  function overflowAmount() {
    const frame = content.firstElementChild
    if (!frame) return { w: 0, h: 0 }
    const box = content.getBoundingClientRect()
    const inner = frame.getBoundingClientRect()
    return {
      w: Math.max(0, inner.width - box.width),
      h: Math.max(0, box.top - inner.top, inner.bottom - box.bottom),
    }
  }

  function clampText() {
    const spans = Array.from(content.querySelectorAll('.bubble-mod'))
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
    for (let guard = 0; guard < 40; guard++) {
      const over = overflowAmount()
      if (!over.w && !over.h) return
      const h = content.clientHeight || 1
      const w = content.clientWidth || 1
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

  function fitText() {
    let fit = 1
    for (let i = 0; i < 4; i++) {
      document.body.style.setProperty('--bubble-fit', fit.toFixed(3))
      const cw = content.clientWidth
      const ch = content.clientHeight
      if (!cw || !ch) break
      const need = Math.min(1, cw / Math.max(content.scrollWidth, 1), ch / Math.max(content.scrollHeight, 1))
      if (need >= 0.995) break
      fit = Math.max(FIT_FLOOR, fit * need * 0.97)
    }
    document.body.style.setProperty('--bubble-fit', fit.toFixed(3))
    clampText()
    return fit
  }

  /** 还有字被截断（或按钮溢出）就请求主进程把窗口放大一档，最多到 MAX_SCALE。 */
  function growIfNeeded(fit) {
    const over = overflowAmount()
    const clipped = Array.from(content.querySelectorAll('.bubble-mod'))
      .some((span) => span.dataset.full != null && span.textContent !== span.dataset.full)
    // 字号已经缩到下限还不宽裕，说明该把窗口变大了（而不是继续压字号）。
    const atFloor = Number(fit) <= FIT_FLOOR + 0.002
    if (!clipped && !over.h && !over.w && !atFloor) return
    if (askedScale >= MAX_SCALE - 0.001) return
    askedScale = Math.min(MAX_SCALE, askedScale + GROW_STEP)
    try { api.askBubbleSize(askedScale) } catch (err) {}
  }

  function render(payload) {
    const data = payload || {}
    askedScale = 1
    syncMetrics()
    bubble.classList.remove('show')
    content.innerHTML = ''
    const frame = el('div')
    const rows = Array.isArray(data.rows) ? data.rows : []
    rows.forEach((row) => {
      const line = el('div', 'bubble-row')
      ;(row || []).forEach((item) => {
        const span = el('span', 'bubble-mod', item && item.text != null ? item.text : '')
        const css = scaleModuleCss(item && item.css)
        if (css) span.setAttribute('style', css)
        line.appendChild(span)
      })
      frame.appendChild(line)
    })
    if (Array.isArray(data.actions) && data.actions.length) {
      const actions = el('div', 'actions')
      data.actions.forEach((action) => {
        const btn = el('button', action && action.primary ? 'primary' : '', (action && action.label) || '')
        if (action && action.id) btn.dataset.action = action.id
        btn.type = 'button'
        actions.appendChild(btn)
      })
      frame.appendChild(actions)
    }
    content.appendChild(frame)
    // 先量再显示：把字体缩放做完，避免"先以 100% 闪一下再缩"。
    requestAnimationFrame(() => {
      const fit = fitText()
      growIfNeeded(fit)
      requestAnimationFrame(() => {
        bubble.classList.add('show')
        requestAnimationFrame(() => syncMetrics())
      })
    })
  }

  function clear() {
    bubble.classList.remove('show')
    content.innerHTML = ''
  }

  /* ----------------------------------------------------------- hover menu */

  let menuOpen = false
  let menuCloseTimer = 0

  /** 量面板本体（不含窗口留白），窗口尺寸由主进程 = 面板 + 2 * 6px。 */
  function menuSize() {
    const wasHidden = menu.hidden
    menu.hidden = false
    const rect = menu.getBoundingClientRect()
    const size = { width: Math.ceil(rect.width), height: Math.ceil(rect.height) }
    menu.hidden = wasHidden
    return size
  }

  function reportMenuSize() {
    const size = menuSize()
    if (!size.width || !size.height) return
    try { api.reportMenuSize(size) } catch (err) {}
  }

  function openMenu() {
    clearTimeout(menuCloseTimer)
    menuOpen = true
    menu.hidden = false
    menu.classList.remove('open')
    // 先让布局落一帧，过渡才会从 scale(0.96) 出发，而不是直接跳到位。
    void menu.offsetWidth
    requestAnimationFrame(() => {
      if (!menuOpen) return
      menu.classList.add('open')
      const first = menu.querySelector('button')
      if (first) {
        try { first.focus() } catch (err) {}
      }
    })
  }

  function closeMenu() {
    if (!menuOpen) return
    menuOpen = false
    menu.classList.remove('open')
    clearTimeout(menuCloseTimer)
    menuCloseTimer = setTimeout(() => {
      if (!menuOpen) menu.hidden = true
    }, 220)
  }

  function wireMenu() {
    menu.addEventListener('click', (ev) => {
      const btn = ev.target && ev.target.closest ? ev.target.closest('button[data-action]') : null
      if (btn) {
        ev.stopPropagation()
        try { api.menuAction(btn.dataset.action) } catch (err) {}
        closeMenu()
        return
      }
      try { api.menuClose() } catch (err) {}
      closeMenu()
    })
    api.onOverlayMenu((payload) => {
      if (payload && payload.open) openMenu()
      else closeMenu()
    })
  }

  function wire() {
    bubble.addEventListener('click', (ev) => {
      const btn = ev.target && ev.target.closest ? ev.target.closest('.bubble-act, .actions button') : null
      if (btn && btn.dataset && btn.dataset.action) {
        ev.stopPropagation()
        try { api.overlayAction(btn.dataset.action) } catch (err) {}
        return
      }
      try { api.overlayClick() } catch (err) {}
    })
    // 和以前点气泡一样：Esc 也收起。气泡窗口不抢焦点，但屏幕阅读器用户
    // 用"跳到窗口"导航过来时 Esc 应该有个结果。
    window.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Escape') return
      ev.preventDefault()
      if (menuOpen) {
        try { api.menuClose() } catch (err) {}
        closeMenu()
        return
      }
      try { api.overlayClick() } catch (err) {}
    })
    api.onOverlayRender(render)
    api.onOverlayClear(clear)
    api.onOverlaySide((side) => {
      document.body.dataset.bubbleSide = side === 'below' ? 'below' : 'above'
    })
    window.addEventListener('resize', () => {
      syncMetrics()
      const fit2 = fitText()
      growIfNeeded(fit2)
    })
    wireMenu()
    // 菜单文案由 data-i18n 填，填完尺寸才准，所以量一次报给主进程。
    if (window.deskPetI18n && api.i18n) {
      try { window.deskPetI18n.applyStatic(document, api.i18n) } catch (err) {}
    }
    requestAnimationFrame(reportMenuSize)
    syncMetrics()
  }

  wire()
})()