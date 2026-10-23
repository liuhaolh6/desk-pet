#!/usr/bin/env node
// 真机视觉/布局留证：四个窗口各拍一张，顺便测"有没有横向溢出"。
//
// 用法：
//   node tools/a11y-real.js [port] [outDir] [tag]
//
// - 默认拍 docs/a11y-shots/<窗口><tag>-normal.png；
// - 如果进程带 `--force-high-contrast` 启动，同时拍 -forced-colors.png，
//   并打印云朵框的计算色（验证 app/pet.css 里的 forced-colors 分支真的生效）；
// - 缩放测试用 `--force-device-scale-factor=2` 启动后再跑一遍，tag 写 `-scale2`。
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')

const PORT = Number(process.argv[2] || 9229)
const OUT = path.resolve(process.argv[3] || path.join(__dirname, '..', 'docs', 'a11y-shots'))
const TAG = process.argv[4] || ''
const WINDOWS = /pet\.html|settings\.html|editor\.html|cutout\.html/

fs.mkdirSync(OUT, { recursive: true })

function list() {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path: '/json/list' }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (d) => { body += d })
      res.on('end', () => { try { resolve(JSON.parse(body)) } catch (err) { reject(err) } })
    }).on('error', reject)
  })
}

function open(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    const pending = new Map()
    let seq = 0
    ws.addEventListener('open', () => resolve({
      send(method, params, timeout = 20000) {
        return new Promise((res, rej) => {
          const id = ++seq
          pending.set(id, { res, rej })
          setTimeout(() => { if (pending.delete(id)) rej(new Error('timeout ' + method)) }, timeout)
          ws.send(JSON.stringify({ id, method, params: params || {} }))
        })
      },
      close() { try { ws.close() } catch (_) {} },
    }))
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data))
      if (!msg.id || !pending.has(msg.id)) return
      const { res, rej } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) rej(new Error(msg.error.message || JSON.stringify(msg.error)))
      else res(msg.result)
    })
    ws.addEventListener('error', () => reject(new Error('ws error')))
  })
}

function evaluate(cdp, expression) {
  return cdp.send('Runtime.evaluate', {
    expression: '(async () => {' + expression + '})()',
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  }).then((r) => {
    if (r.exceptionDetails) {
      throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text)
    }
    return r.result && r.result.value
  })
}

async function shot(cdp, file) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, 30000)
  fs.writeFileSync(file, Buffer.from(data, 'base64'))
  return fs.statSync(file).size
}

const OVERFLOW = `
  const vw = window.innerWidth
  const over = []
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    if (r.right > vw + 1 || r.left < -1) over.push((el.id ? '#' + el.id : el.className ? '.' + String(el.className).split(' ')[0] : el.tagName))
  }
  return { vw, vh: window.innerHeight, scrollW: document.documentElement.scrollWidth, over: over.slice(0, 8), count: over.length }`

;(async () => {
  const targets = (await list()).filter((t) => WINDOWS.test(t.url))
  if (!targets.length) {
    console.error('没有找到窗口：先把应用起来（带 --remote-debugging-port=' + PORT + '）')
    process.exit(1)
  }
  let problems = 0
  for (const t of targets) {
    const name = (t.url.match(/(\w+)\.html/) || [, 'window'])[1]
    const cdp = await open(t.webSocketDebuggerUrl)
    await cdp.send('Runtime.enable')
    await cdp.send('Page.enable').catch(() => {})
    const layout = await evaluate(cdp, OVERFLOW)
    const file = path.join(OUT, `${name}${TAG}-normal.png`)
    const bytes = await shot(cdp, file)
    console.log(`-- ${name}: 视口 ${layout.vw}×${layout.vh}，横向溢出 ${layout.count} 处 → ${path.relative(process.cwd(), file)} (${Math.round(bytes / 1024)} KB)`)
    if (layout.count) {
      problems += layout.count
      console.log('   ' + layout.over.join(' · '))
    }

    const hc = await evaluate(cdp, "return window.matchMedia('(forced-colors: active)').matches")
    if (hc) {
      const petRule = name === 'pet'
        ? await evaluate(cdp, `
            const el = document.querySelector('.bubble-bshape')
            const s = el ? getComputedStyle(el) : null
            return s ? { adjust: s.forcedColorAdjust, fill: s.fill, stroke: s.stroke } : null`)
        : await evaluate(cdp, `
            const el = document.querySelector('.card')
            const s = el ? getComputedStyle(el) : null
            return s ? { adjust: s.forcedColorAdjust, border: s.borderTopWidth + ' ' + s.borderTopColor, bg: s.backgroundColor } : null`)
      const file2 = path.join(OUT, `${name}${TAG}-forced-colors.png`)
      const bytes2 = await shot(cdp, file2)
      console.log(`   高对比度：${path.basename(file2)} (${Math.round(bytes2 / 1024)} KB) · ${JSON.stringify(petRule)}`)
    }
    cdp.close()
  }
  console.log('')
  console.log(problems === 0 ? '布局检查通过（四个窗口都没有横向溢出）' : problems + ' 处横向溢出')
  process.exit(problems === 0 ? 0 : 1)
})().catch((err) => { console.error(err); process.exit(1) })