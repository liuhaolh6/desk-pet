/**
 * 主动说话（ROADMAP P1-7）——纯决策：什么时候该主动冒一句。
 *
 * 三个触发器各自可关，优先级 深夜 > 久坐 > 久未互动；两次主动说话之间至少隔 `gapMinutes`，
 * 免得连着弹。所有时间都是毫秒时间戳，由调用方传入，方便单测。
 *
 * @typedef {{enabled?:boolean,longUse?:boolean,lateNight?:boolean,away?:boolean,
 *            longUseMinutes?:number,awayMinutes?:number,gapMinutes?:number,
 *            nightStart?:number,nightEnd?:number}} NudgeSettings
 */

const DEFAULTS = {
  enabled: true,
  longUse: true,
  lateNight: true,
  away: true,
  longUseMinutes: 50,
  awayMinutes: 120,
  gapMinutes: 45,
  nightStart: 23,
  nightEnd: 5,
}

// 文案由调用方给（`options.texts`），这里只留空表作形状说明：
// 阶段三-O 把三条中文挪进语言包的 `nudge.*`，主进程在 nudge-pump 里翻译。
const TEXTS = {}

function norm(cfg) {
  const c = cfg || {}
  const n = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : d)
  return {
    enabled: c.enabled !== false,
    longUse: c.longUse !== false,
    lateNight: c.lateNight !== false,
    away: c.away !== false,
    longUseMinutes: n(c.longUseMinutes, DEFAULTS.longUseMinutes),
    awayMinutes: n(c.awayMinutes, DEFAULTS.awayMinutes),
    gapMinutes: n(c.gapMinutes, DEFAULTS.gapMinutes),
    nightStart: Number.isFinite(Number(c.nightStart)) ? Number(c.nightStart) : DEFAULTS.nightStart,
    nightEnd: Number.isFinite(Number(c.nightEnd)) ? Number(c.nightEnd) : DEFAULTS.nightEnd,
  }
}

/** 深夜区间可以跨零点（23 → 5）。 */
function isNightHour(hour, start, end) {
  if (start === end) return false
  if (start < end) return hour >= start && hour < end
  return hour >= start || hour < end
}

/**
 * @param {{now:number, cfg?:NudgeSettings, sessionStart?:number|null,
 *          lastInteraction?:number|null, lastNudgeAt?:number|null,
 *          quiet?:boolean, activeMinutes?:number}} input
 * @returns {{kind:string, text:string, at:number}|null}
 */
function decide(input) {
  const it = input || {}
  const texts = Object.assign({}, TEXTS, it.texts || {})
  const cfg = norm(it.cfg)
  const now = Number(it.now) || Date.now()
  if (!cfg.enabled || it.quiet) return null
  if (Number(it.lastNudgeAt) > 0 && now - Number(it.lastNudgeAt) < cfg.gapMinutes * 60000) return null

  const sinceUse = Number(it.sessionStart) > 0 ? now - Number(it.sessionStart) : 0
  const sinceTouch = Number(it.lastInteraction) > 0 ? now - Number(it.lastInteraction) : 0
  const hour = new Date(now).getHours()

  // 深夜只在人还在键盘前时开口（不然就是对着空房间说话）。
  if (cfg.lateNight && isNightHour(hour, cfg.nightStart, cfg.nightEnd) &&
      sinceTouch > 0 && sinceTouch <= 10 * 60000) {
    return { kind: 'late-night', text: texts['late-night'], at: now }
  }
  if (cfg.longUse && sinceUse >= cfg.longUseMinutes * 60000) {
    // 「连续使用」要求这段时间里有互动，纯挂着不算。
    if (sinceTouch === 0 || sinceTouch <= cfg.longUseMinutes * 60000) {
      return { kind: 'long-use', text: texts['long-use'], at: now }
    }
  }
  if (cfg.away && sinceTouch >= cfg.awayMinutes * 60000) {
    return { kind: 'away', text: texts.away, at: now }
  }
  return null
}

module.exports = { decide, norm, isNightHour, DEFAULTS, TEXTS }