'use strict'

// headless e2e 用例 3：天气面板的「找城市 → 点结果 → 存盘 → 进最近城市」整条链路。
//
// 外网不可靠，所以 `run.js` 会先起一个本地地理编码桩服务，并通过
// `DESKPET_GEOCODE_BASE` 指给主进程——真实 UI、真实 IPC、真实解析，只有网络被换成本地。

const { sleep, openWindow } = require('../cdp')

const CITY = '衡阳市'

async function run(ctx) {
  const { pet, port, check } = ctx
  await pet.send('Runtime.enable')

  const settings = await openWindow(port, 'settings.html', async () => {
    await pet.evaluate('window.deskPet.openSettings()')
  })
  await settings.send('Runtime.enable')
  await sleep(800)

  const wentToWeather = await settings.evaluate(
    `(() => {
      const item = Array.from(document.querySelectorAll('.nav-item')).find((x) => /天气/.test(x.textContent || ''))
      if (!item) return false
      item.click()
      return true
    })()`
  )
  check(wentToWeather, '设置页应当有「天气」分类')
  await sleep(300)

  const typed = await settings.evaluate(
    `(() => {
      const input = document.getElementById('city')
      if (!input) return null
      input.value = ${JSON.stringify(CITY)}
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return input.value
    })()`
  )
  check(typed === CITY, '城市输入框应接受输入')

  await settings.evaluate('document.getElementById("searchBtn").click()')
  await sleep(1200)

  const rows = await settings.evaluate('document.querySelectorAll("#results > *").length')
  check(rows > 0, '桩服务应返回至少一条结果（说明 geocode → IPC → 渲染整条链路通）')

  const rowText = await settings.evaluate(
    '(document.querySelector("#results > *").textContent || "").trim()'
  )
  check(rowText.includes(CITY), `结果行应包含城市名，实际 "${rowText}"`)

  await settings.evaluate('document.querySelector("#results > *").click()')
  await sleep(900)

  const state = await pet.evaluateJson(
    'window.deskPet.getState().then((s) => JSON.stringify(s.settings || s))'
  )
  const weather = state.weather || {}
  check(weather.city === CITY, `城市应已存进 settings：期望 ${CITY}，实际 ${weather.city || '(空)'}`)
  check(Math.abs(Number(weather.lat) - 26.89) < 0.01, `纬度应来自桩数据，实际 ${weather.lat}`)

  const recent = await settings.evaluate(
    `(() => {
      const box = document.getElementById('recentCities')
      if (!box || box.hidden) return ''
      return (box.innerText || '').replace(/\\s+/g, ' ').trim()
    })()`
  )
  check(recent.includes(CITY), `「最近城市」里应出现 ${CITY}，实际 "${recent}"`)

  const cityNow = await settings.evaluate('(document.getElementById("cityNow").textContent || "").trim()')
  check(cityNow.includes(CITY), `「现在用的是」应显示 ${CITY}，实际 "${cityNow}"`)

  const consoleErrors = settings.errors.filter(
    (line) => !/net::|Failed to load resource|ERR_|timeout|offline/i.test(line)
  )
  check(consoleErrors.length === 0, `设置页不应有 console 错误：${consoleErrors.slice(0, 3)}`)

  settings.close()
  return `${CITY} 搜索结果 ${rows} 条 → 已存盘并进入最近城市`
}

module.exports = { name: 'city', run }