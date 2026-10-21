#!/usr/bin/env node
/**
 * Keyboard-only walk of the cutout window (WCAG 2.1.1).
 *
 * The photo is loaded through the same IPC the drag/drop path uses (the native
 * file dialog cannot be driven from CDP); everything after that is keyboard
 * only: Enter to cut out, Enter to switch views, Enter to enter/leave the
 * touch-up mode, Escape to leave it, Enter to save.
 *
 *   node tools/a11y-keyboard.js [--port 9229]
 *
 * It is a separate pass from `tools/a11y-audit.js` on purpose: the page audit
 * uses viewport/media emulation, which can leave the renderer slow for the
 * first call of a keyboard walk.
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function parseArgs(argv) {
  const out = { port: 9229, json: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port') out.port = Number(argv[++i]) || 9229
    else if (argv[i] === '--json') out.json = true
  }
  return out
}

async function targets(port) {
  return (await (await fetch('http://127.0.0.1:' + port + '/json/list')).json())
}

async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  let id = 0
  const pending = new Map()
  ws.onmessage = (ev) => {
    const m = JSON.parse(String(ev.data))
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  }
  const send = (method, params = {}) => new Promise((res, rej) => {
    const n = ++id
    const timer = setTimeout(() => { pending.delete(n); rej(new Error(method + ' timed out')) }, 25000)
    pending.set(n, (m) => { clearTimeout(timer); return m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result) })
    ws.send(JSON.stringify({ id: n, method, params }))
  })
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
    return r.result && r.result.value
  }
  return { send, evaluate, ws }
}

async function pressKey(conn, key, vk, text) {
  const code = key === 'Enter' ? 'Enter' : key
  await conn.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, text: text || '', unmodifiedText: text || '' })
  await conn.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk })
  await sleep(250)
}

async function waitFor(fn, test, timeout) {
  const start = Date.now()
  let last
  while (Date.now() - start < timeout) {
    try {
      last = await fn()
      if (test(last)) return last
    } catch (err) { /* keep waiting: the renderer may be busy */ }
    await sleep(250)
  }
  return last
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const report = []
  const steps = []
  const check = (name, pass, detail) => {
    steps.push([name, !!pass, detail || ''])
    console.log((pass ? '  PASS  ' : '  FAIL  ') + name + (detail ? '  (' + detail + ')' : ''))
  }

  const petTarget = (await targets(opts.port)).find((x) => x.url.includes('pet.html'))
  if (!petTarget) throw new Error('pet window not found on port ' + opts.port)
  const pet = await connect(petTarget)
  await pet.send('Runtime.enable')

  const existing = (await targets(opts.port)).some((x) => x.url.includes('cutout.html'))
  const cutTarget = existing
    ? (await targets(opts.port)).filter((x) => x.url.includes('cutout.html')).pop()
    : await (async () => {
      await pet.evaluate('window.deskPet.openCutout()')
      return waitFor(async () => (await targets(opts.port)).filter((x) => x.url.includes('cutout.html')).pop(), (v) => !!v, 10000)
    })()
  const cut = await connect(cutTarget)
  await cut.send('Runtime.enable')
  await sleep(900)

  const b64 = fs.readFileSync(path.join(__dirname, '..', 'tools', 'fixtures', 'synthetic-portrait.png')).toString('base64')
  await cut.evaluate(`(async () => {
    const b = atob(${JSON.stringify(b64)});
    const a = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
    const f = new File([a], 'synthetic-portrait.png', { type: 'image/png' });
    const dt = new DataTransfer(); dt.items.add(f);
    document.getElementById('stage').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    return 'ok';
  })()`)
  const ready = await waitFor(() => cut.evaluate('document.getElementById("runBtn").disabled'), (v) => v === false, 20000)
  check('照片载入后按钮可用', ready === false)

  const focused = await cut.evaluate('(() => { const b = document.getElementById("runBtn"); b.focus(); return document.activeElement === b })()')
  await pressKey(cut, 'Enter', 13, '\r')
  const mode = await waitFor(() => cut.evaluate('document.getElementById("modeLabel").textContent'), (v) => /抠好|已抠图/.test(String(v)), 30000)
  check('Enter 开始抠图', /抠好|已抠图/.test(String(mode)) && focused, String(mode))

  await cut.evaluate('document.querySelector(".seg[data-view=\\"mask\\"]").focus()')
  await pressKey(cut, 'Enter', 13, '\r')
  check('Enter 切到蒙版', await cut.evaluate('document.querySelector(".seg[data-view=\\"mask\\"]").getAttribute("aria-pressed") === "true"'))

  await cut.evaluate('document.querySelector(".seg[data-view=\\"result\\"]").focus()')
  await pressKey(cut, 'Enter', 13, '\r')
  await cut.evaluate('document.getElementById("eraseBtn").focus()')
  await pressKey(cut, 'Enter', 13, '\r')
  check('Enter 进入修补', await cut.evaluate('document.getElementById("stage").classList.contains("is-editing")'))

  await pressKey(cut, 'Escape', 27, '')
  check('Escape 退出并把焦点还回来', await cut.evaluate('!document.getElementById("stage").classList.contains("is-editing") && document.activeElement.id === "eraseBtn"'))

  await cut.evaluate('document.getElementById("saveBtn").focus()')
  await pressKey(cut, 'Enter', 13, '\r')
  const saved = await waitFor(() => cut.evaluate('document.getElementById("status").textContent'), (v) => /收好啦|换成/.test(String(v)), 20000)
  let gone = false
  try { gone = !(await targets(opts.port)).some((x) => x.url.includes('cutout.html')) } catch (err) {}
  check('Enter 保存', gone || /收好啦|换成/.test(String(saved)), gone ? '窗口已关闭（保存完成）' : String(saved).slice(0, 30))

  for (const [name, ok, detail] of steps) report.push({ check: name, ok, detail })
  const failed = steps.filter(([, ok]) => !ok).length
  console.log('\nkeyboard walk: ' + (steps.length - failed) + '/' + steps.length + ' passed')
  if (opts.json) console.log(JSON.stringify({ report }, null, 2))
  pet.ws.close(); cut.ws.close()
  process.exit(failed ? 1 : 0)
}

main().catch((err) => { console.error('FAIL', err && err.message || err); process.exit(2) })