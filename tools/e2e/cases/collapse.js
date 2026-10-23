'use strict'

// headless e2e 用例 2：气泡的「显示」与「预留」是两件事（0.6.7 起桌宠窗口不再随气泡缩放）。
// P2-4 把气泡搬进 `app/overlay.html` 之后，这条用例守的仍然是同一个用户感受，只是分两个窗口看：
//   1) 气泡打开后必须完整落在它自己的窗口里（不能被裁掉一截）；
//   2) 收起后气泡不再显示，桌宠窗口恢复可点、尺寸不变。
//
// 来源：0.6.3 的 `.tmp-verify/cdp-collapse.js`（当时窗口会跟着气泡伸缩，语义已变）。

const { sleep, waitForTarget, connect } = require('../cdp')

const PET_HIT = `JSON.stringify({
  h: window.innerHeight,
  w: window.innerWidth,
  petHit: (() => {
    const el = document.elementFromPoint(Math.round(window.innerWidth / 2), Math.round(window.innerHeight - 40))
    return el ? (el.id || el.className || el.tagName) : ''
  })(),
})`

const BUBBLE_GEOMETRY = `JSON.stringify({
  open: document.getElementById('bubble').classList.contains('show'),
  w: window.innerWidth,
  h: window.innerHeight,
  rect: (() => {
    const b = document.getElementById('bubble').getBoundingClientRect()
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }
  })(),
})`

async function run(ctx) {
  const { pet, port, check } = ctx
  await pet.send('Runtime.enable')

  const idle = await pet.evaluateJson(PET_HIT)
  check(String(idle.petHit).includes('pet'), `收起时宠物区域应可点，实际命中 ${idle.petHit}`)

  await pet.evaluate('document.getElementById("pet").click()')
  const overlay = await connect(await waitForTarget(port, 'overlay.html', 8000))
  await overlay.send('Runtime.enable')
  await sleep(800)

  const shown = await overlay.evaluateJson(BUBBLE_GEOMETRY)
  check(shown.open, '点宠物后气泡应打开')
  check(
    shown.rect.x >= -1 &&
      shown.rect.y >= -1 &&
      shown.rect.x + shown.rect.w <= shown.w + 1 &&
      shown.rect.y + shown.rect.h <= shown.h + 1,
    `气泡应完整落在窗口内：气泡 ${JSON.stringify(shown.rect)} vs 窗口 ${shown.w}x${shown.h}`
  )

  await overlay.evaluate('document.getElementById("bubble").click()')
  await sleep(900)
  const closed = await overlay.evaluateJson(BUBBLE_GEOMETRY)
  check(!closed.open, '点气泡后应收起')

  const after = await pet.evaluateJson(PET_HIT)
  check(after.h === idle.h, `收起不应改变桌宠窗口高度：${idle.h} -> ${after.h}`)
  check(String(after.petHit).includes('pet'), `收起后宠物应重新可点，实际命中 ${after.petHit}`)

  overlay.close()
  return `气泡 ${shown.rect.w}×${shown.rect.h} 完整落在 ${shown.w}×${shown.h} 窗内；桌宠窗高恒为 ${idle.h}`
}

module.exports = { name: 'collapse', run }