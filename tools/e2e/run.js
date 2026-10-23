'use strict'

// headless e2e 入口：起一个干净的 DeskPet 实例，依次跑 cases/ 下的用例。
//
//   node tools/e2e/run.js              # 全部
//   node tools/e2e/run.js noresize     # 只跑一个
//   node tools/e2e/run.js --list       # 看看有哪些
//   node tools/e2e/run.js --port 9444  # 换端口
//
// 失败退出码 1，CI 直接变红。

const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { launch } = require('./launch')
const { connect, waitForTarget, sleep } = require('./cdp')

const CASES_DIR = path.join(__dirname, 'cases')

// 本地地理编码桩：CI/离线环境也能把「找城市」整条链路跑通。
function startGeocodeStub() {
  const server = http.createServer((req, res) => {
    const body = JSON.stringify({
      results: [
        {
          name: '衡阳市',
          admin1: '湖南省',
          country: '中国',
          latitude: 26.89,
          longitude: 112.57,
        },
      ],
    })
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    res.end(body)
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      resolve({
        base: `http://127.0.0.1:${port}/search?`,
        close: () => new Promise((done) => server.close(done)),
      })
    })
  })
}

function listCases() {
  return fs
    .readdirSync(CASES_DIR)
    .filter((name) => name.endsWith('.js'))
    .sort()
    .map((name) => require(path.join(CASES_DIR, name)))
}

async function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--list')) {
    for (const c of listCases()) console.log(c.name)
    return 0
  }
  const portFlag = argv.indexOf('--port')
  const port = portFlag >= 0 ? Number(argv[portFlag + 1]) : Number(process.env.DESKPET_E2E_PORT || 9333)
  const wanted = argv.filter((a) => !a.startsWith('--') && a !== String(port))

  const all = listCases()
  const cases = wanted.length ? all.filter((c) => wanted.includes(c.name)) : all
  if (!cases.length) {
    console.error(`没有匹配的用例：${wanted.join(', ') || '(空)'}`)
    return 1
  }

  let app = null
  let stub = null
  const failures = []
  console.log(`e2e: ${cases.length} 个用例，端口 ${port}`)

  try {
    const stub = await startGeocodeStub()
    app = await launch({ port, env: { DESKPET_GEOCODE_BASE: stub.base } })
    const target = await waitForTarget(port, 'pet.html')
    const pet = await connect(target)

    for (const item of cases) {
      const started = Date.now()
      const problems = []
      const check = (cond, message) => {
        if (!cond) problems.push(message)
      }
      try {
        const detail = await item.run({ app, port, pet, check })
        const elapsed = Date.now() - started
        if (problems.length) {
          failures.push({ name: item.name, problems })
          console.log(`FAIL ${item.name} (${elapsed}ms)`)
          for (const p of problems) console.log(`     - ${p}`)
        } else {
          console.log(`PASS ${item.name} (${elapsed}ms) ${detail || ''}`.trim())
        }
      } catch (err) {
        failures.push({ name: item.name, problems: [err.message] })
        console.log(`FAIL ${item.name} (${Date.now() - started}ms)`)
        console.log(`     - ${err.message}`)
      }
      // 每个用例之间回到初始态
      await pet.evaluate('document.getElementById("bubble").classList.remove("show")').catch(() => {})
      await sleep(400)
    }

    pet.close()
    if (stub) await stub.close()
  } catch (err) {
    console.error(`e2e 启动失败：${err.message}`)
    if (app) await app.close()
    if (stub) await stub.close()
    return 1
  }

  await app.close()

  if (failures.length) {
    console.log(`\n${failures.length}/${cases.length} 个用例失败`)
    return 1
  }
  console.log(`\n${cases.length} 个用例全部通过`)
  return 0
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('e2e 异常：', err && err.stack ? err.stack : err)
    process.exit(1)
  })