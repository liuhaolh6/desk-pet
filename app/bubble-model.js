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
    { key: 'text', labelKey: 'bubble.type.text', field: 'text', sampleKey: 'bubble.sample.text' },
    { key: 'random', labelKey: 'bubble.type.random', sampleKey: 'bubble.sample.random'  },
    { key: 'name', labelKey: 'bubble.type.name', sampleKey: 'bubble.sample.name'  },
    { key: 'weather.icon', labelKey: 'bubble.type.weather_icon', sampleKey: 'bubble.sample.weather_icon'  },
    { key: 'weather.city', labelKey: 'bubble.type.weather_city', sampleKey: 'bubble.sample.weather_city'  },
    { key: 'weather.temp', labelKey: 'bubble.type.weather_temp', sampleKey: 'bubble.sample.weather_temp'  },
    { key: 'weather.text', labelKey: 'bubble.type.weather_text', sampleKey: 'bubble.sample.weather_text'  },
    { key: 'weather.feels', labelKey: 'bubble.type.weather_feels', sampleKey: 'bubble.sample.weather_feels'  },
    { key: 'weather.range', labelKey: 'bubble.type.weather_range', sampleKey: 'bubble.sample.weather_range'  },
    { key: 'weather.precip', labelKey: 'bubble.type.weather_precip', sampleKey: 'bubble.sample.weather_precip'  },
    { key: 'weather.humidity', labelKey: 'bubble.type.weather_humidity', sampleKey: 'bubble.sample.weather_humidity'  },
    { key: 'weather.wind', labelKey: 'bubble.type.weather_wind', sampleKey: 'bubble.sample.weather_wind'  },
    { key: 'weather.sun', labelKey: 'bubble.type.weather_sun', sampleKey: 'bubble.sample.weather_sun'  },
    { key: 'weather.uv', labelKey: 'bubble.type.weather_uv', sampleKey: 'bubble.sample.weather_uv'  },
    { key: 'weather.tomorrow', labelKey: 'bubble.type.weather_tomorrow', sampleKey: 'bubble.sample.weather_tomorrow'  },
    { key: 'weather.hourly', labelKey: 'bubble.type.weather_hourly', sampleKey: 'bubble.sample.weather_hourly'  },
    { key: 'weather.days', labelKey: 'bubble.type.weather_days', sampleKey: 'bubble.sample.weather_days'  },
    { key: 'air.quality', labelKey: 'bubble.type.air_quality', sampleKey: 'bubble.sample.air_quality'  },
    { key: 'air.pm', labelKey: 'bubble.type.air_pm', sampleKey: 'bubble.sample.air_pm'  },
    { key: 'weather.tip', labelKey: 'bubble.type.weather_tip', sampleKey: 'bubble.sample.weather_tip'  },
    { key: 'weather.updated', labelKey: 'bubble.type.weather_updated', sampleKey: 'bubble.sample.weather_updated'  },
    { key: 'weather.hint', labelKey: 'bubble.type.weather_hint', sampleKey: 'bubble.sample.weather_hint'  },
    { key: 'water.cups', labelKey: 'bubble.type.water_cups', sampleKey: 'bubble.sample.water_cups'  },
    { key: 'water.next', labelKey: 'bubble.type.water_next', sampleKey: 'bubble.sample.water_next'  },
    { key: 'water.progress', labelKey: 'bubble.type.water_progress', sampleKey: 'bubble.sample.water_progress'  },
    { key: 'water.interval', labelKey: 'bubble.type.water_interval', sampleKey: 'bubble.sample.water_interval'  },
    { key: 'water.quiet', labelKey: 'bubble.type.water_quiet', sampleKey: 'bubble.sample.water_quiet'  },
    { key: 'water.last', labelKey: 'bubble.type.water_last', sampleKey: 'bubble.sample.water_last'  },
    { key: 'water.tip', labelKey: 'bubble.type.water_tip', sampleKey: 'bubble.sample.water_tip'  },
    { key: 'time', labelKey: 'bubble.type.time', sampleKey: 'bubble.sample.time'  },
    { key: 'date', labelKey: 'bubble.type.date', sampleKey: 'bubble.sample.date'  },
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
    const card = fallback ? JSON.parse(JSON.stringify(fallback)) : { id: uid('card'), name: 'bubble.card.new', rows: [], action: false }
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

  function defaultLayout(translate) {
    const tr = typeof translate === 'function' ? translate : (key) => key
    const cards = [
      {
        id: 'weather',
        name: tr('bubble.card.weather'),
        action: false,
        rows: [
          [textModule(tr('bubble.text.weatherTitle'), { bold: true })],
          [module('weather.icon'), module('weather.city'), module('weather.temp', { bold: true, size: 15 })],
          [module('weather.text'), module('weather.feels')],
          [module('weather.tip')],
          [textModule(tr('bubble.text.todayPrefix')), module('weather.range'), textModule(tr('bubble.text.precip')), module('weather.precip')],
          [module('air.quality', { size: 11, color: '#5d6a86' }), module('weather.days', { size: 11, color: '#5d6a86' })],
          // #5d6a86 keeps the 11px hint line at ~4.8:1 on white (WCAG AA);
          // #8890a8 only reached 3.18:1.
          [module('weather.hint', { size: 11, color: '#5d6a86' }), module('weather.updated', { size: 11, color: '#5d6a86' })],
        ],
      },
      {
        id: 'water',
        name: tr('bubble.card.water'),
        action: true,
        rows: [
          [textModule(tr('bubble.text.waterTitle'), { bold: true })],
          [module('water.progress'), textModule(tr('bubble.text.cupsPrefix')), module('water.cups'), textModule(tr('bubble.text.cupsSuffix'))],
          [module('water.next')],
          [module('water.interval'), textModule(' · '), module('water.quiet')],
          [module('water.tip')],
        ],
      },
      {
        id: 'random',
        name: tr('bubble.card.random'),
        action: false,
        rows: [
          [textModule(tr('bubble.text.chatPrefix')), module('name', { bold: true })],
          [module('random')],
        ],
      },
    ]
    return {
      version: 1,
      cards,
      queue: ['weather', 'water', 'random'],
      library: [
        { id: uid('lib'), label: tr('bubble.library.time'), module: module('time') },
        { id: uid('lib'), label: tr('bubble.library.weather'), module: module('weather.icon') },
        { id: uid('lib'), label: tr('bubble.library.advice'), module: module('weather.tip') },
        { id: uid('lib'), label: tr('bubble.library.hourly'), module: module('weather.hourly') },
        { id: uid('lib'), label: tr('bubble.library.days'), module: module('weather.days') },
        { id: uid('lib'), label: tr('bubble.library.air'), module: module('air.quality') },
      ],
    }
  }

  function normalizeLayout(raw, translate) {
    const fallback = defaultLayout(translate)
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

  function pickRandom(list, t) {
    if (!Array.isArray(list) || !list.length) return t('bubble.random.empty')
    return list[Math.floor(Math.random() * list.length)]
  }

  function valueOf(type, ctx) {
    const t = (ctx && typeof ctx.t === 'function') ? ctx.t : (key) => key
    const w = (ctx && ctx.weather) || null
    const ok = w && w.ok
    // Weather numbers can be missing (partial API response) — never print "null".
    const num = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : '—')
    const deg = (v) => num(v) + '°'
    const pct = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) + '%' : '—')
    switch (type) {
      case 'random': return pickRandom(ctx && ctx.phrases, t)
      case 'name': return (ctx && ctx.name) || t('bubble.name.fallback')
      case 'time': return fmtTime(Date.now())
      case 'date': {
        const d = new Date()
        const week = t('bubble.weekday.' + ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][d.getDay()])
        return t('bubble.date', { month: d.getMonth() + 1, day: d.getDate(), week })
      }
      case 'weather.icon': return ok ? (w.icon || '🌤️') : ''
      // While the first fetch is in flight the card collapses to one friendly
      // line instead of a wall of em-dashes.
      case 'weather.city': return ok ? (w.city || t('bubble.weather.current')) : ((w && w.message) || t('bubble.weather.loading'))
      case 'weather.temp': return ok ? deg(w.temp) : ''
      case 'weather.text': return ok ? w.text : ''
      case 'weather.feels': return ok && Number.isFinite(Number(w.feels)) ? t('bubble.weather.feels', { temp: deg(w.feels) }) : ''
      case 'weather.range': return ok ? num(w.low) + '~' + num(w.high) + '°' : ''
      case 'weather.precip': return ok ? pct(w.precip) : ''
      case 'weather.humidity': return ok ? pct(w.humidity) : ''
      case 'weather.wind': return ok && Number.isFinite(Number(w.wind)) ? t('bubble.weather.wind', { speed: Math.round(w.wind) }) : ''
      case 'weather.sun': {
        if (!ok || !w.sunrise || !w.sunset) return ''
        return t('bubble.weather.sun', { rise: w.sunrise, set: w.sunset })
      }
      case 'weather.uv': return ok && Number.isFinite(Number(w.uv)) ? t('bubble.weather.uv', { n: Math.round(w.uv) }) : ''
      case 'weather.tomorrow': {
        if (!ok || !w.tomorrow || !Number.isFinite(Number(w.tomorrow.high))) return ''
        return t('bubble.weather.tomorrow', {
          range: deg(w.tomorrow.low) + '~' + deg(w.tomorrow.high),
          text: w.tomorrow.text ? ' ' + w.tomorrow.text : '',
        })
      }
      case 'weather.hourly': {
        if (!ok || !Array.isArray(w.hourly) || !w.hourly.length) return ''
        return w.hourly.slice(0, 3)
          .map((h) => t('bubble.weather.hour', { hour: h.hour, temp: deg(h.temp) }) + (h.icon ? ' ' + h.icon : ''))
          .join(' → ')
      }
      case 'weather.days': {
        if (!ok || !Array.isArray(w.days) || w.days.length < 2) return ''
        return w.days.slice(1, 3)
          .filter((d) => Number.isFinite(Number(d.high)))
          .map((d) => d.label + ' ' + num(d.low) + '~' + deg(d.high) + (d.icon ? ' ' + d.icon : ''))
          .join(' · ')
      }
      case 'air.quality': {
        if (!ok || !w.air) return ''
        return t('bubble.air.quality', { text: w.air.text, aqi: num(w.air.aqi) })
      }
      case 'air.pm': {
        if (!ok || !w.air || !Number.isFinite(Number(w.air.pm25))) return ''
        return 'PM2.5 ' + num(w.air.pm25)
      }
      case 'weather.tip': return ok ? (w.advice || '') : ''
      case 'weather.updated': return ok ? t('bubble.weather.updated', { time: fmtTime(w.updatedAt) }) : ''
      case 'weather.hint': return ok && w.stale ? t('bubble.weather.stale') : ''
      case 'water.cups': return String((ctx && ctx.cups) || 0)
      case 'water.progress': {
        const n = Math.max(0, Math.min(8, Math.round(Number(ctx && ctx.cups) || 0)))
        return '●'.repeat(n) + '○'.repeat(8 - n)
      }
      case 'water.interval': {
        const mins = Math.round(Number(ctx && ctx.interval) || 0)
        return mins > 0 ? t('bubble.water.interval', { n: mins }) : t('bubble.water.noInterval')
      }
      case 'water.quiet': {
        const q = (ctx && ctx.quiet) || null
        if (!q) return t('bubble.water.noQuiet')
        return t('bubble.water.quiet', { from: q.from, to: q.to })
      }
      case 'water.last': {
        const at = Number(ctx && ctx.lastDrinkAt) || 0
        if (!at) return t('bubble.water.none')
        const d = new Date(at)
        return t('bubble.water.last', { time: String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') })
      }
      case 'water.tip':
        return (ctx && ctx.waterTip) || t('bubble.water.tip')
      case 'water.next': {
        const due = ctx && ctx.nextAt
        if (!due) return ''
        const mins = Math.max(0, Math.round((due - Date.now()) / 60000))
        return mins > 0 ? t('bubble.water.next', { n: mins }) : t('bubble.water.due')
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
  // A row that only holds glue ("·", " / ") is not worth a line, and a row whose
  // dynamic modules are all empty (weather still loading, no advice today) is
  // dropped as a whole instead of showing its labels with nothing after them.
  const GLUE = /^[\s·|/，,、~\-—]*$/
  function resolveCard(card, ctx) {
    return (card.rows || [])
      .map((row) => {
        const dynamic = row.filter((mod) => mod.type !== 'text').map((mod) => resolveModule(mod, ctx).text)
        const items = row.map((mod) => resolveModule(mod, ctx)).filter((item) => item.text !== '')
        return { hasDynamic: row.some((mod) => mod.type !== 'text'), dynamic, items }
      })
      .filter((row) => row.items.length > 0)
      .filter((row) => !(row.hasDynamic && row.dynamic.every((text) => text === '')))
      .filter((row) => row.items.some((item) => !GLUE.test(item.text)))
      .map((row) => row.items)
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
