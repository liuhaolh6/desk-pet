'use strict'

// headless e2e 用例 1：点宠物 / 点气泡都不能让窗口尺寸跳变。
// P2-4 之后气泡住进 `app/overlay.html` 自己的窗口里，所以这条不变量要两边一起看：
//   1) 桌宠窗口的高度和气泡预留带在点击过程中恒定；
//   2) 气泡窗口在自己的开/收里不许伸缩（它按气泡尺寸精确开在桌宠上方）。
// 来源：0.6.4 的 `.tmp-verify/cdp-noresize.js`，P2-4 阶段一改成两窗口后重写。

const { sleep, waitForTarget, connect } = require('../cdp')

const PET_STATE = `JSON.stringify({
  h: window.innerHeight,
  w: window.innerWidth,
  room: document.body.style.getPropertyValue('--bubble-room'),
})`

const OVERLAY_STATE = `JSON.stringify({
  h: window.innerHeight,
  w: window.innerWidth,
  open: document.getElementById('bubble').classList.contains('show'),
})`

async function run(ctx) {
  const { pet, port, check } = ctx
  await pet.send('Runtime.enable')

  const boot = await pet.evaluateJson(PET_STATE)

  // 气泡窗口是懒创建的：先点开一次，才有 overlay.html 这个调试目标可连。
  await pet.evaluate('document.getElementById("pet").click()')
  const overlay = await connect(await waitForTarget(port, 'overlay.html', 8000))
  await overlay.send('Runtime.enable')
  await sleep(700)

  const first = await overlay.evaluateJson(OVERLAY_STATE)
  check(first.open, '点宠物后气泡应打开')

  const heights = [boot.h]
  const rooms = [boot.room]
  const sizes = [`${first.w}x${first.h}`]
  for (let i = 0; i < 5; i += 1) {
    await pet.evaluate('document.getElementById("pet").click()')
    await sleep(700)
    const s = await pet.evaluateJson(PET_STATE)
    const o = await overlay.evaluateJson(OVERLAY_STATE)
    heights.push(s.h)
    rooms.push(s.room)
    sizes.push(`${o.w}x${o.h}`)
  }

  const uniqueHeights = [...new Set(heights)]
  check(uniqueHeights.length === 1, `桌宠窗口高度应恒定，实测 ${JSON.stringify(heights)}`)
  const uniqueRooms = [...new Set(rooms.map((r) => r || ''))]
  check(uniqueRooms.length === 1, `--bubble-room 不应在点击过程中来回变：${JSON.stringify(rooms)}`)
  const uniqueSizes = [...new Set(sizes)]
  check(uniqueSizes.length === 1, `气泡窗口尺寸应恒定，实测 ${JSON.stringify(sizes)}`)

  const consoleErrors = pet.errors.filter((line) => !/ERR_|net::|Failed to load resource/i.test(line))
  check(consoleErrors.length === 0, `点击过程中不应有 console 错误：${consoleErrors.slice(0, 3)}`)

  overlay.close()
  return `桌宠窗高恒为 ${boot.h}px、预留 ${boot.room}；气泡窗口恒为 ${sizes[0]}，6 次点击`
}

module.exports = { name: 'noresize', run }