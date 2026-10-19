/**
 * Bubble data model shared by the pet window and the bubble editor.
 *
 * A bubble card is `rows`, each row is a list of `modules`. A module is
 * `{ id, type, text, style }`; its value is resolved from the live context
 * (weather, cups, name, clock…) at render time, so the same layout can show
 * different data on every click.
 *
 * Loads as a CommonJS module (for tests) or a browser global (`DeskPetBubble`).
 */
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory()
  else root.DeskPetBubble = factory()
})(typeof self !== 'undefined' ? self : this, function () {
  // ------------------------------------------------------------ module types
  const TYPES = [
    { key: 'text', label: '固定文字', field: 'text', sample: '文本' },
    { key: 'random', label: '随机语句', sample: '记得喝水呀～' },
    { key: 'name', label: '桌宠名字', sample: '小芳桌宠' },
    { key: 'weather.icon', label: '天气·图标', sample: '🌤️' },
    { key: 'weather.city', label: '天气·城市', sample: '北京' },
    { key: 'weather.temp', label: '天气·当前温度', sample: '13°' },
    { key: 'weather.text', label: '天气·描述', sample: '晴' },
    { key: 'weather.range', label: '天气·今日高低温', sample: '7~18°' },
    { key: 'weather.precip', label: '天气·降水概率', sample: '0%' },
    { key: 'weather.humidity', label: '天气·湿度', sample: '79%' },
    { key: 'weather.updated', label: '天气·更新时间', sample: '更新于 22:12' },
    { key: 'weather.hint', label: '天气·离线提示', sample: '离线缓存' },
    { key: 'water.cups', label: '喝水·今日杯数', sample: '3' },
    { key: 'water.next', label: '喝水·下次提醒', sample: '再过 42 分钟' },
    { key: 'time', label: '当前时间', sample: '22:12' },
    { key: 'date', label: '今天的日期', sample: '10月19日 周日' },
  ]

  const TYPE_MAP = Object.fromEntries(TYPES.map((t) => [t.key, t]))

  const STYLE_DEFAULT = {
    size: 13,
    bold: false,
    italic: false,
    color: '#1f2b4d',
    bg: '',
  }

  function uid(prefix) {
    return (prefix || 'm') + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3)
  }

  function newModule(type, text) {
    const meta = TYPE_MAP[type] || TYPE_MAP.text
    const module = { id: uid(), type: meta.key, text: meta.field ? (text != null ? text : meta.sample) : '', style: { ...STYLE_DEFAULT } }
    if (meta.key !== 'text') module.text = ''
    return module
  }

  function normalizeStyle(style) {
    const out = { ...STYLE_DEFAULT }
    if (style && typeof style === 'object') {
      if (Number.isFinite(Number(style.size))) out.size = Math.min(32, Math.max(9, Math.round(Number(style.size))))
      out.bold = !!style.bold
      out.italic = !!style.italic
      if (typeof style.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(style.color)) out.color = style.color
      if (typeof style.bg === 'string' && (/^#[0-9a-fA-F]{3,8}$/.test(style.bg) || style.bg === '')) out.bg = style.bg
    }
    return out
  }

  function normalizeModule(raw) {
    if (!raw || typeof raw !== 'object') return null
    const type = TYPE_MAP[raw.type] ? raw.type : 'text'
    return {
      id: typeof raw.id === 'string' && raw.id ? raw.id : uid(),
      type,
      text: typeof raw.text === 'string' ? raw.text.slice(0, 200) : '',
      style: normalizeStyle(raw.style),
    }
  }

  function normalizeRow(raw) {
    if (!Array.isArray(raw)) return []
    return raw.map(normalizeModule).filter(Boolean).slice(0, 8)
  }

  function normalizeCard(raw, fallback) {
    const card = fallback ? JSON.parse(JSON.stringify(fallback)) : { id: uid('card'), name: '新卡片', rows: [], action: false }
    if (!raw || typeof raw !== 'object') return card
    if (typeof raw.id === 'string' && raw.id) card.id = raw.id
    if (typeof raw.name === 'string' && raw.name) card.name = raw.name.slice(0, 20)
    if (Array.isArray(raw.rows)) card.rows = raw.rows.map(normalizeRow).filter((r) => r.length).slice(0, 6)
    if (typeof raw.action === 'boolean') card.action = raw.action
    return card
  }

  // --------------------------------------------------------------- defaults
  function textModule(text, style) {
    return { id: uid(), type: 'text', text, style: { ...STYLE_DEFAULT, ...(style || {}) } }
  }

  function module(type, style) {
    return { id: uid(), type, text: '', style: { ...STYLE_DEFAULT, ...(style || {}) } }
  }

  function defaultLayout() {
    const cards = [
      {
        id: 'weather',
        name: '天气',
        action: false,
        rows: [
          [textModule('🌤️ 天气', { bold: true })],
          [module('weather.icon'), module('weather.city'), module('weather.temp', { bold: true, size: 15 })],
          [module('weather.text')],
          [textModule('今日 '), module('weather.range'), textModule(' · 降水 '), module('weather.precip')],
          [module('weather.hint', { size: 11, color: '#8890a8' }), module('weather.updated', { size: 11, color: '#8890a8' })],
        ],
      },
      {
        id: 'water',
        name: '喝水',
        action: true,
        rows: [
          [textModule('💧 该喝水啦', { bold: true })],
          [textModule('今天第 '), module('water.cups'), textModule(' 杯，慢慢喝')],
        ],
      },
      {
        id: 'random',
        name: '温馨语句',
        action: false,
        rows: [
          [textModule('💬 '), module('name', { bold: true })],
          [module('random')],
        ],
      },
    ]
    return {
      version: 1,
      cards,
      queue: ['weather', 'water', 'random'],
      library: [
        { id: uid('lib'), label: '当前时间', module: module('time') },
        { id: uid('lib'), label: '天气一行', module: module('weather.icon') },
      ],
    }
  }

  function normalizeLayout(raw) {
    const fallback = defaultLayout()
    if (!raw || typeof raw !== 'object') return fallback
    const cards = []
    const byId = new Map(fallback.cards.map((c) => [c.id, c]))
    if (Array.isArray(raw.cards)) {
      for (const item of raw.cards.slice(0, 8)) {
        const id = item && typeof item.id === 'string' ? item.id : ''
        cards.push(normalizeCard(item, byId.get(id)))
        byId.delete(id)
      }
    }
    for (const leftover of byId.values()) cards.push(JSON.parse(JSON.stringify(leftover)))
    const ids = new Set(cards.map((c) => c.id))
    let queue = Array.isArray(raw.queue) ? raw.queue.filter((id) => ids.has(id)) : []
    if (!queue.length) queue = fallback.queue.filter((id) => ids.has(id))
    const library = Array.isArray(raw.library)
      ? raw.library
        .map((entry) => {
          const mod = normalizeModule(entry && entry.module)
          if (!mod) return null
          return { id: uid('lib'), label: String((entry && entry.label) || TYPE_MAP[mod.type].label).slice(0, 20), module: mod }
        })
        .filter(Boolean)
        .slice(0, 40)
      : fallback.library
    return { version: 1, cards, queue, library }
  }

  // -------------------------------------------------------------- resolved values
  function fmtTime(ts) {
    if (!ts) return ''
    const d = new Date(ts)
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
  }

  function pickRandom(list) {
    if (!Array.isArray(list) || !list.length) return '我在呢～'
    return list[Math.floor(Math.random() * list.length)]
  }

  function valueOf(type, ctx) {
    const w = (ctx && ctx.weather) || null
    const ok = w && w.ok
    switch (type) {
      case 'random': return pickRandom(ctx && ctx.phrases)
      case 'name': return (ctx && ctx.name) || '桌宠'
      case 'time': return fmtTime(Date.now())
      case 'date': {
        const d = new Date()
        const week = '日一二三四五六'[d.getDay()]
        return (d.getMonth() + 1) + '月' + d.getDate() + '日 周' + week
      }
      case 'weather.icon': return ok ? (w.icon || '🌤️') : '🌤️'
      case 'weather.city': return ok ? (w.city || '当前') : '天气'
      case 'weather.temp': return ok ? w.temp + '°' : '—'
      case 'weather.text': return ok ? w.text : '还没取到天气'
      case 'weather.range': return ok ? w.low + '~' + w.high + '°' : '—'
      case 'weather.precip': return ok ? w.precip + '%' : '—'
      case 'weather.humidity': return ok ? w.humidity + '%' : '—'
      case 'weather.updated': return ok ? '更新于 ' + fmtTime(w.updatedAt) : ''
      case 'weather.hint': return ok && w.stale ? '离线缓存' : ''
      case 'water.cups': return String((ctx && ctx.cups) || 0)
      case 'water.next': {
        const due = ctx && ctx.nextAt
        if (!due) return ''
        const mins = Math.max(0, Math.round((due - Date.now()) / 60000))
        return mins > 0 ? '再过 ' + mins + ' 分钟' : '该喝啦'
      }
      case 'text': return ''
      default: return ''
    }
  }

  function styleToString(style) {
    const s = normalizeStyle(style)
    const parts = []
    if (s.size && s.size !== STYLE_DEFAULT.size) parts.push('font-size:' + s.size + 'px')
    if (s.bold) parts.push('font-weight:600')
    if (s.italic) parts.push('font-style:italic')
    if (s.color && s.color !== STYLE_DEFAULT.color) parts.push('color:' + s.color)
    if (s.bg) parts.push('background:' + s.bg, 'border-radius:4px', 'padding:0 3px')
    return parts.join(';')
  }

  /** Resolve one module to `{ text, css }` without touching the DOM. */
  function resolveModule(mod, ctx) {
    const text = mod.type === 'text' ? (mod.text || '') : valueOf(mod.type, ctx)
    return { text: String(text == null ? '' : text), css: styleToString(mod.style) }
  }

  /** Card rows resolved with the live context (used by the editor preview too). */
  function resolveCard(card, ctx) {
    return (card.rows || []).map((row) => row.map((mod) => resolveModule(mod, ctx)).filter((item) => item.text !== ''))
  }

  /** Trim empty rows produced by modules that have no value right now. */
  function pruneRows(rows) {
    return rows.filter((row) => row.length > 0)
  }

  return {
    TYPES,
    TYPE_MAP,
    STYLE_DEFAULT,
    newModule,
    normalizeStyle,
    normalizeModule,
    normalizeRow,
    normalizeCard,
    normalizeLayout,
    defaultLayout,
    resolveModule,
    resolveCard,
    pruneRows,
    styleToString,
    valueOf,
    uid,
  }
})
