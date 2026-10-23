'use strict'

// 极简 CDP 客户端：只做 e2e 需要的三件事——连到某个页面、求值、抓 console 错误。
// 用 Node 22 自带的全局 WebSocket，不引第三方依赖。

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function targets(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`)
  if (!res.ok) throw new Error(`CDP /json/list -> HTTP ${res.status}`)
  return res.json()
}

async function waitForTarget(port, urlPart, timeoutMs = 20000) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    const list = await targets(port).catch(() => [])
    const found = list.find((t) => t.type === 'page' && t.url.includes(urlPart))
    if (found) return found
    await sleep(150)
  }
  throw new Error(`页面 ${urlPart} 在 ${timeoutMs}ms 内没有出现`)
}

async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = () => reject(new Error('WebSocket 连接失败'))
  })

  let seq = 0
  const pending = new Map()
  const errors = []

  ws.onmessage = (ev) => {
    let msg = null
    try {
      msg = JSON.parse(String(ev.data))
    } catch (err) {
      return
    }
    if (msg.id && pending.has(msg.id)) {
      const entry = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) entry.reject(new Error(JSON.stringify(msg.error).slice(0, 300)))
      else entry.resolve(msg.result)
      return
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params && msg.params.exceptionDetails
      errors.push((d && (d.text || (d.exception && d.exception.description))) || 'exception')
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params && msg.params.type === 'error') {
      errors.push((msg.params.args || []).map((a) => a.value || a.description).join(' '))
    }
  }

  const send = (method, params = {}, timeoutMs = 20000) =>
    new Promise((resolve, reject) => {
      const id = ++seq
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`${method} 超时`))
      }, timeoutMs)
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: (err) => {
          clearTimeout(timer)
          reject(err)
        },
      })
      ws.send(JSON.stringify({ id, method, params }))
    })

  async function evaluate(expression) {
    const res = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails).slice(0, 300))
    return res.result ? res.result.value : undefined
  }

  async function evaluateJson(expression) {
    const raw = await evaluate(expression)
    if (raw === undefined || raw === null) return raw
    return typeof raw === 'string' ? JSON.parse(raw) : raw
  }

  function close() {
    try {
      ws.close()
    } catch (err) {
      /* 已经关了 */
    }
  }

  return { send, evaluate, evaluateJson, close, errors, target }
}

// 打开某个窗口页面并连上；用于「设置页」这类需要另外开窗的用例。
async function openWindow(port, urlPart, trigger, timeoutMs = 15000) {
  let target = (await targets(port).catch(() => [])).find(
    (t) => t.type === 'page' && t.url.includes(urlPart)
  )
  if (!target && trigger) {
    await trigger()
    target = await waitForTarget(port, urlPart, timeoutMs)
  }
  if (!target) throw new Error(`页面 ${urlPart} 没有打开`)
  return connect(target)
}

module.exports = { sleep, targets, waitForTarget, connect, openWindow }