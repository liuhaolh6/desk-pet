'use strict'

// headless e2e 用例 1：点宠物 / 点气泡都不能让窗口尺寸跳变。
// 来源：0.6.4 的 `.tmp-verify/cdp-noresize.js`，改写成入库用例。

const { sleep } = require('../cdp')

const PET_STATE = `JSON.stringify({
  h: window.innerHeight,
  w: window.innerWidth,
  open: document.getElementById('bubble').classList.contains('show'),
  room: document.body.style.getPropertyValue('--bubble-room'),
})`

async function readState(pet) {
  return pet.evaluateJson(PET_STATE)
}

async function run(ctx) {
  const { pet, check } = ctx
  await pet.send('Runtime.enable')

  const boot = await readState(pet)
  const heights = [boot.h]
  const rooms = [boot.room]

  for (let i = 0; i < 5; i += 1) {
    await pet.evaluate('document.getElementById("pet").click()')
    await sleep(700)
    const s = await readState(pet)
    heights.push(s.h)
    rooms.push(s.room)
  }

  let open = await readState(pet)
  if (!open.open) {
    await pet.evaluate('document.getElementById("pet").click()')
    await sleep(700)
    open = await readState(pet)
  }
  check(open.open, '点 5 次之后气泡应当是打开的')

  await pet.evaluate('document.getElementById("bubble").click()')
  await sleep(800)
  const after = await readState(pet)

  const uniqueHeights = [...new Set(heights)]
  check(uniqueHeights.length === 1, `点击过程中窗口高度应恒定，实测 ${JSON.stringify(heights)}`)
  check(after.h === open.h, `收起气泡不应改变窗口高度：${open.h} -> ${after.h}`)

  const uniqueRooms = [...new Set(rooms.map((r) => r || ''))]
  check(uniqueRooms.length <= 1, `--bubble-room 不应在点击过程中来回变：${JSON.stringify(rooms)}`)

  const consoleErrors = pet.errors.filter((line) => !/ERR_|net::|Failed to load resource/i.test(line))
  check(consoleErrors.length === 0, `点击过程中不应有 console 错误：${consoleErrors.slice(0, 3)}`)

  return `窗口高度恒为 ${boot.h}，5 次点击 + 1 次收起`
}

module.exports = { name: 'noresize', run }