/**
 * 主动说话泵（ROADMAP P1-7）。
 *
 * 只负责「什么时候说」和「别在什么时候说」，说什么由 `lib/nudges.js` 的纯函数决定：
 * - 会话起点：第一次有互动时开始算（启动就挂着不算久坐）；
 * - 互动：宠物上的指针动作、菜单/气泡操作、主进程窗口聚焦都会 `touch()`；
 * - 每分钟醒一次，问到该说话时再确认「前台是不是全屏」，是就闭嘴；
 * - 说完记 `lastNudgeAt`，接下来 `gapMinutes` 内不再开口。
 */
'use strict'

const { decide } = require('../../lib/nudges.js')

function createNudgePump(options) {
  const o = options || {}
  const now = o.now || Date.now
  const log = o.log || (() => {})
  const sendToPet = o.sendToPet || (() => {})
  const isBusy = o.isBusy || (() => Promise.resolve(false))
  const store = o.store
  const tickMs = Number(o.tickMs) > 0 ? Number(o.tickMs) : 60 * 1000

  const state = { sessionStart: 0, lastInteraction: 0, lastNudgeAt: 0 }
  let timer = 0
  let busy = false

  function touch() {
    const t = now()
    if (!state.sessionStart) state.sessionStart = t
    state.lastInteraction = t
  }

  function settings() {
    const s = (store && store.readSettings && store.readSettings()) || {}
    return { cfg: (s.nudge || {}), mode: s.mode }
  }

  function snapshot() {
    return { sessionStart: state.sessionStart, lastInteraction: state.lastInteraction, lastNudgeAt: state.lastNudgeAt }
  }

  /** 纯计算：给定时刻应不应该说话（不发送、不改状态）。 */
  // 只读探针：`opts` 可以覆盖时间与状态，用来复现"用了 50 分钟""离开两小时"这类场景。
  function probe(at, opts = {}) {
    const t = Number(opts.now) || Number(at) || now()
    const s = settings()
    const pick = (name) => (Number(opts[name]) >= 0 ? Number(opts[name]) : state[name])
    return {
      state: snapshot(),
      decision: decide({
        now: t,
        cfg: { ...s.cfg, ...(opts.cfg || {}) },
        quiet: opts.quiet !== undefined ? !!opts.quiet : s.mode === 'quiet',
        sessionStart: pick('sessionStart'),
        lastInteraction: pick('lastInteraction'),
        lastNudgeAt: pick('lastNudgeAt'),
      }),
    }
  }

  async function tick() {
    if (busy) return null
    const t = now()
    const s = settings()
    if (s.mode === 'quiet') return null
    const d = decide({
      now: t,
      cfg: s.cfg,
      quiet: false,
      sessionStart: state.sessionStart,
      lastInteraction: state.lastInteraction,
      lastNudgeAt: state.lastNudgeAt,
    })
    if (!d) return null
    busy = true
    try {
      if (await isBusy()) {
        log('nudge skipped: foreground is fullscreen')
        return null
      }
      sendToPet('pet:nudge', { kind: d.kind, text: d.text })
      state.lastNudgeAt = t
      log('nudge', d.kind)
      return d
    } finally {
      busy = false
    }
  }

  function start() {
    if (timer) return
    timer = setInterval(() => { tick().catch((err) => log('nudge failed', err && err.message)) }, tickMs)
    if (timer && timer.unref) timer.unref()
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = 0 }
  }

  return { touch, probe, tick, start, stop, snapshot }
}

module.exports = { createNudgePump }