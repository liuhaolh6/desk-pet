/**
 * Sound model shared by the pet window, the settings window and the tests.
 *
 * A "fragment" is either a built-in synthesised preset (`preset:*`) or a file
 * imported by the user (`file:<id>`, served by the `pet-sound://` protocol).
 * Each event can pick a fragment, override the volume, or fall back to the
 * master volume (`volume: null`).
 *
 * Loads as CommonJS (tests) or a browser global (`DeskPetSound`).
 */
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory()
  else root.DeskPetSound = factory()
})(typeof self !== 'undefined' ? self : this, function () {
  /**
   * Built-in presets are synthesised with WebAudio, so the app ships no audio
   * binaries and users can still pick something pleasant out of the box.
   * notes: [frequencyHz, durationSeconds, delaySeconds]
   */
  const PRESETS = [
    {
      id: 'preset:ding', labelKey: 'sound.preset.ding', type: 'sine', gain: 0.22,
      notes: [[1320, 0.09, 0], [1760, 0.06, 0.05]],
    },
    {
      id: 'preset:pop', labelKey: 'sound.preset.pop', type: 'sine', gain: 0.28,
      notes: [[520, 0.05, 0], [380, 0.07, 0.04]],
    },
    {
      id: 'preset:drop', labelKey: 'sound.preset.drop', type: 'sine', gain: 0.26,
      notes: [[880, 0.07, 0], [1180, 0.1, 0.09]],
    },
    {
      id: 'preset:chime', labelKey: 'sound.preset.chime', type: 'triangle', gain: 0.2,
      notes: [[660, 0.1, 0], [880, 0.1, 0.11], [1100, 0.14, 0.22]],
    },
    {
      id: 'preset:soft', labelKey: 'sound.preset.soft', type: 'sine', gain: 0.18,
      notes: [[440, 0.16, 0]],
    },
  ]

  const EVENT_META = [
    { key: 'click', labelKey: 'sound.event.click' },
    { key: 'bubble', labelKey: 'sound.event.bubble' },
    { key: 'water', labelKey: 'sound.event.water' },
  ]

  const DEFAULT_SOUND = {
    enabled: true,
    volume: 0.45,
    events: {
      click: { enabled: true, fragment: 'preset:ding', volume: null },
      bubble: { enabled: true, fragment: 'preset:pop', volume: null },
      water: { enabled: true, fragment: 'preset:drop', volume: null },
    },
  }

  const clamp01 = (n) => Math.min(1, Math.max(0, n))

  function normalizeEvent(raw, fallback) {
    const base = fallback || { enabled: true, fragment: 'preset:ding', volume: null }
    if (!raw || typeof raw !== 'object') return { ...base }
    const out = { ...base }
    if (typeof raw.enabled === 'boolean') out.enabled = raw.enabled
    if (typeof raw.fragment === 'string' && raw.fragment) out.fragment = raw.fragment
    if (raw.volume === null || raw.volume === undefined) out.volume = base.volume
    else if (Number.isFinite(Number(raw.volume))) out.volume = clamp01(Number(raw.volume))
    return out
  }

  function normalizeSound(raw) {
    const src = raw && typeof raw === 'object' ? raw : {}
    const out = {
      enabled: typeof src.enabled === 'boolean' ? src.enabled : DEFAULT_SOUND.enabled,
      volume: Number.isFinite(Number(src.volume)) ? clamp01(Number(src.volume)) : DEFAULT_SOUND.volume,
      events: {},
    }
    for (const meta of EVENT_META) {
      out.events[meta.key] = normalizeEvent(src.events && src.events[meta.key], DEFAULT_SOUND.events[meta.key])
    }
    return out
  }

  /** Effective volume for one event; null per-event volume follows the master. */
  function eventVolume(sound, eventKey) {
    const s = normalizeSound(sound)
    if (!s.enabled) return 0
    const event = s.events[eventKey]
    if (!event || !event.enabled) return 0
    const base = event.volume == null ? s.volume : event.volume
    return clamp01(base)
  }

  function presetById(id) {
    return PRESETS.find((p) => p.id === id) || null
  }

  function fragmentLabel(fragment, files, t) {
    const tr = (key, vars) => (typeof t === 'function' ? t(key, vars) : key)
    if (typeof fragment !== 'string') return tr('sound.pick.none')
    if (fragment.startsWith('preset:')) {
      const preset = presetById(fragment)
      return preset ? tr(preset.labelKey) : tr('sound.pick.unknown')
    }
    if (fragment.startsWith('file:')) {
      const id = fragment.slice(5)
      const file = (files || []).find((f) => f.id === id)
      return file ? file.name : tr('sound.pick.deleted')
    }
    return fragment
  }

  function isKnownFragment(fragment, files) {
    if (typeof fragment !== 'string') return false
    if (fragment.startsWith('preset:')) return !!presetById(fragment)
    if (fragment.startsWith('file:')) return (files || []).some((f) => f.id === fragment.slice(5))
    return false
  }

  // -------------------------------------------------------------- playback
  let audio = null
  const decoded = new Map()

  function context() {
    if (audio) return audio
    const Ctor = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext)
    if (!Ctor) return null
    audio = new Ctor()
    return audio
  }

  function playPreset(preset, volume) {
    const ctx = context()
    if (!ctx || !preset) return
    if (ctx.state === 'suspended') ctx.resume().catch(() => {})
    preset.notes.forEach(([freq, dur, delay]) => {
      const t0 = ctx.currentTime + delay
      const osc = ctx.createOscillator()
      const amp = ctx.createGain()
      osc.type = preset.type
      osc.frequency.setValueAtTime(freq, t0)
      amp.gain.setValueAtTime(0.0001, t0)
      amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume * preset.gain), t0 + 0.012)
      amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
      osc.connect(amp).connect(ctx.destination)
      osc.start(t0)
      osc.stop(t0 + dur + 0.02)
    })
  }

  function playBuffer(buffer, volume) {
    const ctx = context()
    if (!ctx || !buffer) return
    if (ctx.state === 'suspended') ctx.resume().catch(() => {})
    const src = ctx.createBufferSource()
    const amp = ctx.createGain()
    src.buffer = buffer
    amp.gain.value = volume
    src.connect(amp).connect(ctx.destination)
    src.start()
  }

  /**
   * Play a fragment. `files` is the imported-sound index (for `file:<id>`),
   * `volume` is already resolved through `eventVolume`.
   */
  async function playFragment(fragment, volume, files) {
    if (!fragment || !(volume > 0)) return
    if (fragment.startsWith('preset:')) {
      playPreset(presetById(fragment), volume)
      return
    }
    if (!fragment.startsWith('file:')) return
    const id = fragment.slice(5)
    try {
      const ctx = context()
      if (!ctx) return
      let buffer = decoded.get(id)
      if (!buffer) {
        const res = await fetch('pet-sound://sound/' + encodeURIComponent(id))
        if (!res.ok) return
        buffer = await ctx.decodeAudioData(await res.arrayBuffer())
        decoded.set(id, buffer)
      }
      playBuffer(buffer, volume)
    } catch (err) {
      // A broken import must never break the pet; stay silent.
    }
  }

  function forgetFile(id) {
    decoded.delete(id)
  }

  return {
    PRESETS,
    EVENT_META,
    DEFAULT_SOUND,
    normalizeSound,
    normalizeEvent,
    eventVolume,
    presetById,
    fragmentLabel,
    isKnownFragment,
    playFragment,
    forgetFile,
  }
})
