'use strict'

// headless e2e 用例：多语言（P2-6）。
//
// 验收标准是「切换语言重启生效」，所以这条用例必须真的重启一次同一个数据目录，
// 不能在同一个进程里改内存里的 locale 糊过去。三步：
//   1) zh-CN 实例：preload 的同步 t() 拿得到字典、`{name}` 插值正确、缺键返回键名；
//   2) 设置窗口里把语言改成 English（走真实的 select + change 事件），settings.json 落盘；
//   3) 用同一个数据目录重启：locale 变成 en-US，`t('app.name')` 变成 DeskPet。
// 最后扫一遍可见文本，确认没有把语言包的键名（`tray.settings` 这种）直接显示出来。

const fs = require('node:fs')
const path = require('node:path')
const { launch, ROOT } = require('../launch')
const { connect, waitForTarget, openWindow, sleep } = require('../cdp')

const PROBE = `JSON.stringify({
  locale: deskPet.i18n.locale,
  available: deskPet.i18n.available,
  count: deskPet.i18n.keys().length,
  appName: deskPet.i18n.t('app.name'),
  tooltip: deskPet.i18n.t('app.tooltip', { name: '小小' }),
  missing: deskPet.i18n.t('nope.nope'),
  hasTraySettings: deskPet.i18n.has('tray.settings'),
  lang: document.documentElement.lang,
  text: document.body ? document.body.innerText : '',
})`

const LEARN = /^(app|tray|nudge|water|weather)\.[a-z]/i

// 起一个实例，等 pet.html 出来，读一遍语言相关的量。
// 失败时把日志尾巴带出来：这个用例要连起两次实例，起不来的原因（锁、崩、端口）
// 只跑一次是猜不出来的。
async function probe(port, options) {
  const app = await launch(Object.assign({ port }, options))
  try {
    const target = await waitForTarget(port, 'pet.html')
    const pet = await connect(target)
    await pet.send('Runtime.enable')
    const info = await pet.evaluateJson(PROBE)
    return { app, pet, info }
  } catch (err) {
    const tail = logTail(app.dataDir)
    await app.close().catch(() => {})
    throw new Error(err.message + (tail ? `；日志尾巴：\n${tail}` : ''))
  }
}

function logTail(dir) {
  for (const file of [path.join(dir, 'app.log'), path.join(ROOT, 'app.log')]) {
    try {
      const text = fs.readFileSync(file, 'utf8')
      return text.split('\n').slice(-12).join('\n')
    } catch (err) {
      /* 下一个 */
    }
  }
  return ''
}

function readSettings(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'))
}

// 设置页的监听是在脚本跑完之后才挂上的，刚 openWindow 就 dispatch 会打空
// （事件没人听，没有任何报错，只有"改了不生效"）。所以一边重试一边等页面
// 自己把状态行的「记下了」写出来——那行字就是「监听已挂上」的凭证。
async function pickLocale(win, value) {
  const literal = JSON.stringify(value)
  for (let i = 0; i < 15; i++) {
    const picked = await win.evaluate(`(() => {
      const sel = document.getElementById('localeSelect')
      if (!sel) return false
      sel.value = ${literal}
      sel.dispatchEvent(new Event('change', { bubbles: true }))
      const status = document.getElementById('status')
      return !!status && status.textContent.indexOf('记下了') === 0
    })()`)
    if (picked) return true
    await sleep(200)
  }
  return false
}

async function waitForLocale(dir, value, tries) {
  let settings = null
  for (let i = 0; i < (tries || 12); i++) {
    await sleep(150)
    try {
      settings = readSettings(dir)
    } catch (err) {
      continue
    }
    if (settings.locale === value) return settings
  }
  return settings
}

async function run(ctx) {
  const { check } = ctx
  const basePort = Number(ctx.port) + 40
  const dir = path.join(ROOT, '.e2e-data', `${process.pid}-i18n`)
  const notes = []
  const first = { app: null, pet: null }
  const second = { app: null, pet: null }

  try {
    // ── 1) 中文实例 ────────────────────────────────────────────────
    const zh = await probe(basePort, {
      dataDir: dir,
      settings: { locale: 'zh-CN' },
      keepData: true,
    })
    first.app = zh.app
    first.pet = zh.pet
    const a = zh.info

    check(a.locale === 'zh-CN', `zh 实例的 locale 应为 zh-CN，实际 ${a.locale}`)
    check(a.appName === '桌宠', `zh 的 t('app.name') 应为「桌宠」，实际 ${a.appName}`)
    check(
      a.tooltip === '小小 · 桌宠',
      `zh 的 {name} 插值不对：${JSON.stringify(a.tooltip)}`
    )
    check(a.missing === 'nope.nope', `缺键应返回键名本身，实际 ${JSON.stringify(a.missing)}`)
    check(a.hasTraySettings === true, 'preload 的 has() 应能看到 tray.settings')
    check(a.count >= 30, `合并字典应至少有 30 条，实际 ${a.count}`)
    check(
      Array.isArray(a.available) && a.available.includes('zh-CN') && a.available.includes('en-US'),
      `available 应同时列出两种语言，实际 ${JSON.stringify(a.available)}`
    )
    check(String(a.lang).toLowerCase().startsWith('zh'), `documentElement.lang 应为中文，实际 ${a.lang}`)
    const zhLeak = String(a.text || '').split('\n').filter((line) => LEARN.test(line.trim()))
    check(zhLeak.length === 0, `zh 桌宠窗口有裸键名：${JSON.stringify(zhLeak.slice(0, 3))}`)
    notes.push(`zh 字典 ${a.count} 条`)

    // ── 2) 在设置窗口里改语言（真实 select + change） ──────────────
    const settingsWin = await openWindow(basePort, 'settings.html', () =>
      zh.pet.evaluate('deskPet.openSettings()')
    )
    await settingsWin.send('Runtime.enable')
    const zhSettings = await settingsWin.evaluateJson(`JSON.stringify({
      locale: deskPet.i18n.locale,
      options: Array.from(document.getElementById('localeSelect').options).map(o => o.value),
      value: document.getElementById('localeSelect').value,
    })`)
    check(zhSettings.locale === 'zh-CN', `设置窗口的 locale 应为 zh-CN，实际 ${zhSettings.locale}`)
    check(
      zhSettings.options.includes('en-US') && zhSettings.options.includes('zh-CN'),
      `语言下拉应同时有 zh-CN 与 en-US，实际 ${JSON.stringify(zhSettings.options)}`
    )

    // 静态标记的实证：每个 data-i18n 元素都该被字典填上，且不能把键名当文案显示出来。
    const statics = await settingsWin.evaluateJson(`JSON.stringify((() => {
      const nodes = Array.from(document.querySelectorAll('[data-i18n],[data-i18n-html]'))
      const attrNames = [
        ['data-i18n-placeholder', 'placeholder'],
        ['data-i18n-title', 'title'],
        ['data-i18n-aria-label', 'aria-label'],
        ['data-i18n-alt', 'alt'],
      ]
      const empty = []
      const raw = []
      const KEYLIKE = /^[a-z][A-Za-z0-9]*(\\.[A-Za-z0-9]+){1,4}$/
      nodes.forEach((n) => {
        const text = String(n.textContent || '').trim()
        const key = n.dataset.i18n || n.dataset.i18nHtml || '?'
        if (!text) empty.push(key)
        else if (KEYLIKE.test(text)) raw.push(key + '=' + text)
      })
      attrNames.forEach(([attr, prop]) => {
        document.querySelectorAll('[' + attr + ']').forEach((n) => {
          const value = String(n.getAttribute(prop) || '').trim()
          if (!value || KEYLIKE.test(value)) raw.push(n.getAttribute(attr) + '=' + value)
        })
      })
      return { total: nodes.length, empty, raw }
    })())`)
    check(statics.total >= 60, `设置页应有大量 data-i18n 标记，实际 ${statics.total}`)
    check(
      statics.empty.length === 0,
      `设置页有 ${statics.empty.length} 个标记没填上文案：${JSON.stringify(statics.empty.slice(0, 5))}`
    )
    check(
      statics.raw.length === 0,
      `设置页把键名显示出来了：${JSON.stringify(statics.raw.slice(0, 5))}`
    )
    notes.push(`设置页静态标记 ${statics.total} 处`)

    const picked = await pickLocale(settingsWin, 'en-US')
    check(picked, '设置窗口的语言下拉应能响应 change（页面脚本可能还没绑定）')
    const saved = (await waitForLocale(dir, 'en-US')) || {}
    check(saved.locale === 'en-US', `改完应落盘 locale=en-US，实际 ${JSON.stringify(saved.locale)}`)
    const statusText = await settingsWin.evaluate(
      `(document.getElementById('localeNow') || {}).textContent || ''`
    )
    check(
      /zh-CN|en-US/.test(String(statusText)),
      `「现在的语言」应显示当前语言，实际 ${JSON.stringify(statusText)}`
    )
    settingsWin.close()
    notes.push('下拉切换已落盘')

    // ── 3) 同一个数据目录重启：换成 en-US ─────────────────────────
    await zh.app.close()
    first.app = null
    const en = await probe(basePort, { dataDir: dir, seed: false, keepData: true })
    second.app = en.app
    second.pet = en.pet
    const b = en.info

    check(b.locale === 'en-US', `重启后 locale 应为 en-US，实际 ${b.locale}`)
    check(b.appName === 'DeskPet', `重启后 t('app.name') 应为 DeskPet，实际 ${b.appName}`)
    check(
      b.tooltip === '小小 · desk pet',
      `重启后 {name} 插值不对：${JSON.stringify(b.tooltip)}`
    )
    const enLeak = String(b.text || '').split('\n').filter((line) => LEARN.test(line.trim()))
    check(enLeak.length === 0, `en 桌宠窗口有裸键名：${JSON.stringify(enLeak.slice(0, 3))}`)
    notes.push(`重启后 ${b.locale}`)

    return `字典 ${a.count} 条；${notes.join('；')}`
  } finally {
    if (first.pet) first.pet.close()
    if (second.pet) second.pet.close()
    if (first.app) await first.app.close().catch(() => {})
    if (second.app) await second.app.close().catch(() => {})
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch (err) {
      /* 目录被占用就留着，.e2e-data/ 已 gitignore */
    }
  }
}

module.exports = { name: 'i18n', run }