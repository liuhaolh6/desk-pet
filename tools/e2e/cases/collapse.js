'use strict'

// headless e2e 用例 2：气泡的「显示」与「预留」是两件事（0.6.7 起窗口不再随气泡缩放）。
// 这条用例守两类回归：
//   1) 气泡打开后必须完整落在窗口里（不能被裁掉一截）；
//   2) 收起后气泡不再挡住宠物的点击区域。
//
// 来源：0.6.3 的 `.tmp-verify/cdp-collapse.js`（当时窗口会跟着气泡伸缩，语义已变）。

const { sleep } = require('../cdp')

const PET_STATE = `JSON.stringify({
  h: window.innerHeight,
  w: window.innerWidth,
  open: document.getElementById('bubble').classList.contains('show'),
  room: document.body.style.getPropertyValue('--bubble-room'),
  rect: (() => {
    const b = document.getElementById('bubble').getBoundingClientRect()
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }
  })(),
  petHit: (() => {
    const el = document.elementFromPoint(Math.round(window.innerWidth / 2), Math.round(window.innerHeight - 40))
    return el ? (el.id || el.className || el.tagName) : ''
  })(),
})`

const readState = (pet) => pet.evaluateJson(PET_STATE)

async function run(ctx) {
  const { pet, check } = ctx
  await pet.send('Runtime.enable')

  const idle = await readState(pet)
  check(!idle.open, '启动时气泡应是收起的')
  check(String(idle.petHit).includes('pet'), `收起时宠物区域应可点，实际命中 ${idle.petHit}`)

  const reserve = Math.round(parseFloat(idle.room) || 0)
  check(reserve > 0, `启动后应已预留气泡空间，实际 --bubble-room=${JSON.stringify(idle.room)}`)

  await pet.evaluate('document.getElementById("pet").click()')
  await sleep(1000)
  const shown = await readState(pet)
  check(shown.open, '点宠物后气泡应打开')
  check(shown.h === idle.h, `气泡打开不应改变窗口高度：${idle.h} -> ${shown.h}`)
  check(
    shown.rect.y >= -1 && shown.rect.y + shown.rect.h <= shown.h + 1 && shown.rect.x >= -1,
    `气泡应完整落在窗口内：气泡 ${JSON.stringify(shown.rect)} vs 窗口 ${shown.w}x${shown.h}`
  )

  await pet.evaluate('document.getElementById("bubble").click()')
  await sleep(1000)
  const after = await readState(pet)
  check(!after.open, '点气泡后应收起')
  check(after.h === shown.h, `收起不应改变窗口高度：${shown.h} -> ${after.h}`)
  check(String(after.petHit).includes('pet'), `收起后宠物应重新可点，实际命中 ${after.petHit}`)

  return `预留 ${reserve}px；打开/收起窗口恒为 ${idle.h}，气泡 ${shown.rect.w}×${shown.rect.h} 未被裁切`
}

module.exports = { name: 'collapse', run }