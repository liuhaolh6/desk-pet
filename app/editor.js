/**
 * Bubble editor window.
 *
 * Edits `settings.bubble.layout` (see bubble-model.js): cards → rows → modules,
 * with per-module type/text/style, drag sorting, a reusable module library and
 * a live preview using sample data.
 */
(function () {
  const api = window.deskPet
  const model = window.DeskPetBubble
  const $ = (id) => document.getElementById(id)

  const state = {
    settings: null,
    layout: null,
    cardId: 'weather',
    sel: null,      // { ri, ci }
    drag: null,     // { kind, ri, ci }
    dirty: false,
  }

  // ------------------------------------------------------------- sample data
  function sampleContext(card) {
    return {
      weather: {
        ok: true, city: '北京', temp: 13, text: '晴', low: 7, high: 18,
        precip: 0, humidity: 79, icon: '☀️', updatedAt: Date.now() - 8 * 60000,
      },
      phrases: (state.settings && state.settings.bubble && state.settings.bubble.phrases) || ['记得喝口水呀～'],
      name: (state.settings && state.settings.name) || '小芳桌宠',
      cups: card && card.id === 'water' ? 3 : 2,
      nextAt: Date.now() + 42 * 60000,
      interval: 60,
      quiet: { from: 23, to: 8 },
      lastDrinkAt: Date.now() - 18 * 60000,
      waterTip: '慢慢喝，别急呀',
    }
  }

  function cardById(id) {
    return state.layout.cards.find((c) => c.id === id) || null
  }

  function currentCard() {
    return cardById(state.cardId) || state.layout.cards[0] || null
  }

  function status(text) {
    const node = $('status')
    node.textContent = text || ''
    clearTimeout(status.timer)
    if (text) status.timer = setTimeout(() => { node.textContent = '' }, 2400)
  }

  function markDirty() {
    state.dirty = true
    $('saveBtn').disabled = false
  }

  // ------------------------------------------------------------------- tabs
  function renderTabs() {
    const tabs = $('tabs')
    tabs.innerHTML = ''
    state.layout.cards.forEach((card) => {
      const btn = document.createElement('button')
      btn.className = 'tab' + (card.id === state.cardId ? ' active' : '')
      btn.textContent = card.name + ' · ' + card.id
      btn.onclick = () => { state.cardId = card.id; state.sel = null; renderAll() }
      tabs.appendChild(btn)
    })
    const up = document.createElement('button')
    up.className = 'tab'
    up.textContent = '↑'
    up.title = '往前挪一张（点击顺序也会跟着换）'
    up.onclick = () => moveCard(-1)
    const down = document.createElement('button')
    down.className = 'tab'
    down.textContent = '↓'
    down.title = '往后挪一张（点击顺序也会跟着换）'
    down.onclick = () => moveCard(1)
    tabs.appendChild(up)
    tabs.appendChild(down)
    $('saveBtn').disabled = !state.dirty
  }

  function moveCard(delta) {
    const cards = state.layout.cards
    const i = cards.findIndex((c) => c.id === state.cardId)
    const j = i + delta
    if (i < 0 || j < 0 || j >= cards.length) return
    const [card] = cards.splice(i, 1)
    cards.splice(j, 0, card)
    state.layout.queue = cards.map((c) => c.id)
    markDirty()
    renderTabs()
    status('顺序换好啦，之后点我就按这个顺序出卡')
  }

  // ------------------------------------------------------------------- rows
  function moduleLabel(mod) {
    if (mod.type === 'text') return '写好的文字'
    return model.TYPE_MAP[mod.type] ? model.TYPE_MAP[mod.type].label : mod.type
  }

  function chipText(mod) {
    const sample = model.resolveModule(mod, sampleContext(currentCard()))
    if (sample.text) return sample.text
    return '（' + moduleLabel(mod) + '）'
  }

  function renderRows() {
    const box = $('rows')
    box.innerHTML = ''
    const card = currentCard()
    if (!card) return

    card.rows.forEach((row, ri) => {
      const rowEl = document.createElement('div')
      rowEl.className = 'row'
      rowEl.dataset.ri = String(ri)

      const chips = document.createElement('div')
      chips.className = 'chips'

      row.forEach((mod, ci) => chips.appendChild(makeChip(card, mod, ri, ci)))
      if (!row.length) {
        const empty = document.createElement('span')
        empty.className = 'lib-empty'
        empty.textContent = '这一行空着，点右边的 ＋ 加点内容'
        chips.appendChild(empty)
      }
      rowEl.appendChild(chips)

      const actions = document.createElement('div')
      actions.className = 'row-actions'
      const mk = (label, title, fn) => {
        const b = document.createElement('button')
        b.textContent = label
        b.title = title
        b.setAttribute('aria-label', title)
        b.onclick = fn
        return b
      }
      actions.appendChild(mk('↑', '整行往上', () => moveRow(ri, ri - 1)))
      actions.appendChild(mk('↓', '整行往下', () => moveRow(ri, ri + 1)))
      actions.appendChild(mk('＋', '在这一行后面加点内容', () => {
        card.rows[ri].push(model.newModule('text', '写点什么'))
        state.sel = { ri, ci: card.rows[ri].length - 1 }
        markDirty()
        renderAll()
      }))
      actions.appendChild(mk('×', '删掉这一行', () => {
        card.rows.splice(ri, 1)
        state.sel = null
        markDirty()
        renderAll()
      }))
      rowEl.appendChild(actions)
      box.appendChild(rowEl)
    })
  }

  function makeChip(card, mod, ri, ci) {
    const chip = document.createElement('div')
    chip.className = 'chip' + (state.sel && state.sel.ri === ri && state.sel.ci === ci ? ' selected' : '')
    chip.setAttribute('role', 'button')
    chip.tabIndex = 0

    const label = document.createElement('span')
    label.className = 'label'
    label.textContent = chipText(mod)
    const css = model.resolveModule(mod, sampleContext(card)).css
    if (css) label.setAttribute('style', css)
    chip.appendChild(label)

    const kind = document.createElement('span')
    kind.className = 'kind'
    kind.textContent = moduleLabel(mod)
    chip.appendChild(kind)

    const pick = () => { state.sel = { ri, ci }; renderAll() }
    chip.onclick = pick
    chip.onkeydown = (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pick() }
    }
    return chip
  }

  function moveRow(from, to) {
    const card = currentCard()
    if (!card || to < 0 || to >= card.rows.length || from === to) return
    const [row] = card.rows.splice(from, 1)
    card.rows.splice(to, 0, row)
    if (state.sel && state.sel.ri === from) state.sel.ri = to
    markDirty()
    renderAll()
  }

  function moveModule(fromRi, fromCi, toRi, toCi) {
    const card = currentCard()
    if (!card) return
    const fromRow = card.rows[fromRi]
    if (!fromRow || !fromRow[fromCi]) return
    const [mod] = fromRow.splice(fromCi, 1)
    const target = card.rows[toRi]
    if (!target) { fromRow.splice(fromCi, 0, mod); return }
    target.splice(Math.max(0, Math.min(toCi, target.length)), 0, mod)
    state.sel = { ri: toRi, ci: Math.max(0, Math.min(toCi, target.length - 1)) }
    markDirty()
    renderAll()
  }

  // -------------------------------------------------------------- inspector
  function renderInspector() {
    const box = $('inspector')
    box.innerHTML = ''
    const card = currentCard()
    const sel = state.sel
    const mod = card && sel ? (card.rows[sel.ri] || [])[sel.ci] : null

    const h = document.createElement('h3')
    h.textContent = '这一块'
    box.appendChild(h)

    if (!mod) {
      const empty = document.createElement('div')
      empty.className = 'lib-empty'
      empty.textContent = '先点一块内容，右边就能改它写什么、长什么样'
      box.appendChild(empty)
      return
    }

    const typeField = field('这一块是什么', (() => {
      // Group the flat type list so 23 modules do not read as one wall of text.
      const GROUPS = [
        ['写点什么', ['text', 'random', 'name']],
        ['天气', ['weather']],
        ['喝水', ['water']],
        ['时间', ['time', 'date']],
      ]
      const select = document.createElement('select')
      const byKey = new Map(model.TYPES.map((t) => [t.key, t]))
      const used = new Set()
      for (const [label, prefixes] of GROUPS) {
        const group = document.createElement('optgroup')
        group.label = label
        model.TYPES.forEach((t) => {
          if (used.has(t.key)) return
          if (!prefixes.some((p) => t.key === p || t.key.startsWith(p + '.'))) return
          used.add(t.key)
          const opt = document.createElement('option')
          opt.value = t.key
          opt.textContent = t.label
          group.appendChild(opt)
        })
        if (group.children.length) select.appendChild(group)
      }
      const rest = document.createElement('optgroup')
      rest.label = '其他'
      model.TYPES.forEach((t) => {
        if (used.has(t.key)) return
        const opt = document.createElement('option')
        opt.value = t.key
        opt.textContent = t.label
        rest.appendChild(opt)
      })
      if (rest.children.length) select.appendChild(rest)
      void byKey
      select.value = mod.type
      select.onchange = () => {
        mod.type = select.value
        if (mod.type === 'text' && !mod.text) mod.text = '文字'
        markDirty()
        renderAll()
      }
      return select
    })())
    box.appendChild(typeField)

    if (mod.type === 'text') {
      const input = document.createElement('input')
      input.type = 'text'
      input.value = mod.text
      input.maxLength = 200
      input.oninput = () => { mod.text = input.value; markDirty(); renderRows(); renderPreview() }
      box.appendChild(field('写什么', input))
    }

    // Everything visual hides behind one disclosure: the common case is just
    // picking what the module says.
    const advanced = document.createElement('details')
    advanced.className = 'advanced'
    const summary = document.createElement('summary')
    summary.textContent = '再调调样式'
    advanced.appendChild(summary)

    const size = document.createElement('input')
    size.type = 'number'
    size.min = '9'
    size.max = '32'
    size.value = String(mod.style.size)
    size.onchange = () => {
      mod.style = model.normalizeStyle({ ...mod.style, size: Number(size.value) })
      markDirty()
      renderAll()
    }
    advanced.appendChild(field('多大', size))

    advanced.appendChild(field('怎么显示', (() => {
      const wrap = document.createElement('div')
      wrap.className = 'chips'
      const bold = document.createElement('label')
      bold.className = 'field'
      const b = document.createElement('input')
      b.type = 'checkbox'
      b.checked = !!mod.style.bold
      b.onchange = () => { mod.style.bold = b.checked; markDirty(); renderAll() }
      bold.appendChild(b)
      bold.appendChild(document.createTextNode('加粗'))
      const italic = document.createElement('label')
      italic.className = 'field'
      const it = document.createElement('input')
      it.type = 'checkbox'
      it.checked = !!mod.style.italic
      it.onchange = () => { mod.style.italic = it.checked; markDirty(); renderAll() }
      italic.appendChild(it)
      italic.appendChild(document.createTextNode('斜体'))
      wrap.appendChild(bold)
      wrap.appendChild(italic)
      return wrap
    })()))

    advanced.appendChild(field('字颜色', colorInput(mod.style.color, (value) => {
      mod.style.color = value
      markDirty()
      renderAll()
    })))

    advanced.appendChild(field('垫个底色', (() => {
      const wrap = document.createElement('div')
      wrap.className = 'chips'
      wrap.appendChild(colorInput(mod.style.bg || '#ffffff', (value) => {
        mod.style.bg = value
        markDirty()
        renderAll()
      }))
      const clear = document.createElement('button')
      clear.className = 'clear'
      clear.textContent = '不要了'
      clear.onclick = () => { mod.style.bg = ''; markDirty(); renderAll() }
      wrap.appendChild(clear)
      return wrap
    })()))
    box.appendChild(advanced)

    const ops = document.createElement('div')
    ops.className = 'chips'
    const op = (label, fn) => {
      const b = document.createElement('button')
      b.textContent = label
      b.onclick = fn
      ops.appendChild(b)
    }
    op('往前', () => moveModule(sel.ri, sel.ci, sel.ri, sel.ci - 1))
    op('往后', () => moveModule(sel.ri, sel.ci, sel.ri, sel.ci + 1))
    op('删除', () => {
      card.rows[sel.ri].splice(sel.ci, 1)
      state.sel = null
      markDirty()
      renderAll()
    })
    box.appendChild(ops)
  }

  function field(labelText, node) {
    const row = document.createElement('div')
    row.className = 'field'
    const span = document.createElement('span')
    span.textContent = labelText
    row.appendChild(span)
    row.appendChild(node)
    return row
  }

  function colorInput(value, onChange) {
    const input = document.createElement('input')
    input.type = 'color'
    input.value = /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#1f2b4d'
    input.oninput = () => onChange(input.value)
    return input
  }

  function renderPreview() {
    const box = $('preview')
    box.innerHTML = ''
    const card = currentCard()
    if (!card) return
    const ctx = sampleContext(card)
    const rows = model.pruneRows(model.resolveCard(card, ctx))
    if (!rows.length) {
      const hint = document.createElement('div')
      hint.className = 'lib-empty'
      hint.textContent = '这张卡还空着'
      box.appendChild(hint)
      return
    }
    rows.forEach((row) => {
      const line = document.createElement('div')
      line.className = 'bubble-row'
      row.forEach((item) => {
        const span = document.createElement('span')
        span.className = 'bubble-mod'
        span.textContent = item.text
        if (item.css) span.setAttribute('style', item.css)
        line.appendChild(span)
      })
      box.appendChild(line)
    })
    if (card.action) {
      const actions = document.createElement('div')
      actions.className = 'actions'
      const a = document.createElement('button')
      a.textContent = '喝过了'
      const b = document.createElement('button')
      b.textContent = '待会儿'
      actions.appendChild(a)
      actions.appendChild(b)
      box.appendChild(actions)
    }
  }

  // ---------------------------------------------------------------- actions
  function renderAll() {
    renderTabs()
    renderRows()
    renderInspector()
    renderPreview()
  }

  function addRow() {
    const card = currentCard()
    if (!card) return
    if (card.rows.length >= 6) { status('最多 6 行啦'); return }
    card.rows.push([])
    state.sel = { ri: card.rows.length - 1, ci: -1 }
    markDirty()
    renderAll()
  }

  async function save() {
    state.layout.queue = state.layout.cards.map((c) => c.id)
    const bubble = Object.assign({}, state.settings.bubble, { layout: state.layout })
    const next = await api.setSettings({ bubble })
    state.settings = next
    state.dirty = false
    $('saveBtn').disabled = true
    status('记住啦，点一下桌宠就能看到效果')
  }

  function reset() {
    if (!confirm('要变回默认的气泡吗？还没保存的改动会丢掉哦。')) return
    state.layout = model.defaultLayout()
    state.cardId = state.layout.cards[0].id
    state.sel = null
    markDirty()
    renderAll()
    status('变回默认啦（别忘了点保存）')
  }

  // ---------------------------------------------------------------- presets
  // One click replaces the current card with a ready-made layout: most people
  // just want the bubble to say less, not to assemble modules by hand.
  function presetRows(cardId, kind) {
    const base = model.defaultLayout().cards.find((c) => c.id === cardId)
    const rows = base ? JSON.parse(JSON.stringify(base.rows)) : []
    const text = (v) => model.newModule('text', v)
    const mk = (type) => model.newModule(type, '')
    if (kind === 'simple') {
      const simple = {
        weather: [[mk('weather.icon'), mk('weather.temp'), mk('weather.text')], [mk('weather.tip')]],
        water: [[text('今天第 '), mk('water.cups'), text(' 杯啦')]],
        random: [[mk('random')]],
      }
      return simple[cardId] || rows.slice(0, 1)
    }
    if (kind === 'rich') {
      const extra = {
        weather: [[mk('weather.feels'), mk('weather.uv')], [mk('weather.sun')], [mk('weather.hourly')], [mk('weather.tomorrow')]],
        water: [[text('下次大概 '), mk('water.next')]],
        random: [[mk('name'), text(' · '), mk('time')]],
      }
      return rows.concat(extra[cardId] || [])
    }
    return rows // standard: exactly what ships by default
  }

  function applyPreset(kind) {
    const card = currentCard()
    if (!card) return
    card.rows = presetRows(card.id, kind)
    state.sel = null
    markDirty()
    renderAll()
    const label = { simple: '简洁', standard: '标准', rich: '详细' }[kind] || kind
    status('换成「' + label + '」啦，看看下面的预览')
  }

  // ------------------------------------------------------------------- boot
  async function boot() {
    try {
      const initial = await api.getState()
      state.settings = initial.settings
      state.layout = model.normalizeLayout(initial.settings.bubble && initial.settings.bubble.layout)
      state.cardId = state.layout.cards[0] ? state.layout.cards[0].id : 'weather'
    } catch (err) {
      status('没读到设置，稍后再试')
    }
    $('addRowBtn').onclick = addRow
    document.querySelectorAll('[data-preset]').forEach((btn) => {
      btn.onclick = () => applyPreset(btn.dataset.preset)
    })
    $('saveBtn').onclick = () => save().catch(() => status('没保存成功，再试一次？'))
    $('resetBtn').onclick = reset
    $('closeBtn').onclick = () => {
      if (state.dirty && !confirm('还有改动没保存，真的要关掉吗？')) return
      window.close()
    }
    window.addEventListener('beforeunload', (ev) => {
      if (!state.dirty) return
      ev.preventDefault()
      ev.returnValue = ''
    })
    renderAll()
  }

  boot()
})()
