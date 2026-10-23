'use strict'

const test = require('node:test')
const assert = require('node:assert')
const i18n = require('../../lib/i18n')

test('flatten：嵌套字典压成点号键，非字符串值被忽略', () => {
  const flat = i18n.flatten({ tray: { show: 'show', nested: { deep: 'd' } }, count: 3, ok: true })
  assert.deepStrictEqual(flat, { 'tray.show': 'show', 'tray.nested.deep': 'd' })
})

test('flatten：已经是扁平字典时原样返回', () => {
  assert.deepStrictEqual(i18n.flatten({ 'a.b': 'x' }), { 'a.b': 'x' })
})

test('interpolate：替换已知占位符，未知的保持原样', () => {
  assert.strictEqual(i18n.interpolate('{name} · 桌宠', { name: '小芳' }), '小芳 · 桌宠')
  assert.strictEqual(i18n.interpolate('{a}-{b}', { a: 1 }), '1-{b}')
  assert.strictEqual(i18n.interpolate('没有占位符', { a: 1 }), '没有占位符')
})

test('createI18n：词典命中优先于回退语言', () => {
  const t = i18n.createI18n({ locale: 'en-US', dict: { k: 'Hello' }, fallbackDict: { k: '你好', only: '只有中文' } })
  assert.strictEqual(t.t('k'), 'Hello')
  assert.strictEqual(t.t('only'), '只有中文')
})

test('createI18n：两边都没有时返回键名并记进 missing', () => {
  const t = i18n.createI18n({ locale: 'en-US', dict: {}, fallbackDict: {} })
  assert.strictEqual(t.t('nope.key'), 'nope.key')
  assert.deepStrictEqual(t.missing(), ['nope.key'])
})

test('createI18n：带变量的句子', () => {
  const t = i18n.createI18n({ dict: { tip: '{name} · 桌宠' } })
  assert.strictEqual(t.t('tip', { name: '小芳' }), '小芳 · 桌宠')
})

test('createI18n：has 同时看两边，dict 合并后回退值在前', () => {
  const t = i18n.createI18n({ dict: { a: 'A' }, fallbackDict: { b: 'B', a: '甲' } })
  assert.strictEqual(t.has('a'), true)
  assert.strictEqual(t.has('b'), true)
  assert.strictEqual(t.has('c'), false)
  assert.deepStrictEqual(t.dict(), { a: 'A', b: 'B' })
})

test('createI18n：stats 报两份词典的键数', () => {
  const t = i18n.createI18n({ locale: 'en-US', dict: { a: '1', b: '2' }, fallbackDict: { a: '1' } })
  assert.deepStrictEqual(t.stats(), { locale: 'en-US', keys: 2, fallbackKeys: 1 })
})

test('keyDiff：找出只在一边的键', () => {
  const diff = i18n.keyDiff({ a: '1', b: '2' }, { b: '2', c: '3' })
  assert.deepStrictEqual(diff.onlyA, ['a'])
  assert.deepStrictEqual(diff.onlyB, ['c'])
  assert.deepStrictEqual(diff.common, ['b'])
})

test('matchLocale：完全一致优先，其次同语言，最后回退 zh-CN', () => {
  const available = ['zh-CN', 'en-US']
  assert.strictEqual(i18n.matchLocale('en-US', available), 'en-US')
  assert.strictEqual(i18n.matchLocale('en-GB', available), 'en-US')
  assert.strictEqual(i18n.matchLocale('zh-Hans-CN', available), 'zh-CN')
  assert.strictEqual(i18n.matchLocale('fr-FR', available), 'zh-CN')
  assert.strictEqual(i18n.matchLocale('', available), 'zh-CN')
})

test('matchLocale：下划线写法也能认', () => {
  assert.strictEqual(i18n.matchLocale('en_US', ['zh-CN', 'en-US']), 'en-US')
})

test('真实语言包：zh-CN 与 en-US 键名一致且没有空串', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const root = path.join(__dirname, '..', '..', 'locales')
  const zh = JSON.parse(fs.readFileSync(path.join(root, 'zh-CN.json'), 'utf8'))
  const en = JSON.parse(fs.readFileSync(path.join(root, 'en-US.json'), 'utf8'))
  const diff = i18n.keyDiff(zh, en)
  assert.deepStrictEqual(diff.onlyA, [])
  assert.deepStrictEqual(diff.onlyB, [])
  assert.ok(diff.common.length >= 15, '两个语言包至少要有 15 条公共键，现在 ' + diff.common.length)
  for (const [k, v] of Object.entries(i18n.flatten(zh))) assert.ok(v.trim().length > 0, 'zh-CN 空串 ' + k)
  for (const [k, v] of Object.entries(i18n.flatten(en))) assert.ok(v.trim().length > 0, 'en-US 空串 ' + k)
})

test('app/i18n.js 能被 require（UMD 别踩 ASI：字符串后紧跟括号会被当成调用）', () => {
  const renderer = require('../../app/i18n')
  assert.strictEqual(typeof renderer.create, 'function')
  const t = renderer.create({ k: 'Hello {name}' }, 'en-US')
  assert.strictEqual(t.t('k', { name: 'Ann' }), 'Hello Ann')
  assert.strictEqual(t.locale, 'en-US')
})

test('真实语言包：托盘菜单文案已经不写死在 tray.js 里', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const { countFile } = require('../../tools/check-i18n')
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'main', 'tray.js'), 'utf8')
  assert.strictEqual(countFile('app/main/tray.js', source), 0)
})

test('计数器：注释里的中文不算文案（照样板文件 tray.js 的注释）', () => {
  const { stripJsComments, countFile } = require('../../tools/check-i18n')
  const src = [
    '// 这一行是注释，不算',
    '/* 块注释「也不算」',
    '   还是一行 */',
    "const a = '真的文案'",
    "const b = \"https://example.com/x\" // 行尾注释里也有中文",
    'const c = `模板 ${a} 里也有`',
  ].join('\n')
  const stripped = stripJsComments(src)
  assert.ok(!stripped.includes('这一行是注释'))
  assert.ok(!stripped.includes('也不算'))
  assert.ok(!stripped.includes('行尾注释里也有中文'))
  // 三条：普通串、URL 串（无中文不计）、模板串
  assert.strictEqual(countFile('x.js', src), 2)
})

test('计数器：HTML 的文本节点和属性值都算文案', () => {
  const { countFile } = require('../../tools/check-i18n')
  const html = [
    '<!-- <p>注释里的中文</p> -->',
    '<h2>外观</h2>',
    '<button title="打开菜单" aria-label="菜单">设置</button>',
    '<p data-i18n="settings.foo"></p>',
  ].join('\n')
  // 外观 + title + 菜单 + 设置
  assert.strictEqual(countFile('x.html', html), 4)
})

test('checkKeysExist：代码里 t() 用到的键必须在 zh-CN 里', () => {
  const { collectKeys } = require('../../tools/check-i18n')
  const keys = collectKeys('x.js', "t('tray.toggle'); tr('nudge.away'); t('nodot'); i18n.t('app.name')")
  assert.deepStrictEqual(keys, ['tray.toggle', 'nudge.away', 'app.name'])
  assert.deepStrictEqual(collectKeys('x.html', '<b data-i18n="a.b" data-i18n-title="c.d">x</b>'), ['a.b', 'c.d'])
})

test('applyStatic：把 data-i18n* 写进文本节点与属性，并改 html[lang]', () => {
  const renderer = require('../../app/i18n')
  const node = (attrs) => ({
    attrs,
    textContent: '',
    innerHTML: '',
    getAttribute: (name) => attrs[name] || null,
    setAttribute: (name, value) => { attrs[name] = value },
  })
  const title = node({ 'data-i18n': 'pet.title' })
  const button = node({ 'data-i18n': 'menu.settings', 'data-i18n-title': 'menu.settings.hint' })
  const rich = node({ 'data-i18n-html': 'about.body' })
  const html = { lang: 'zh-CN' }
  const doc = {
    documentElement: html,
    querySelectorAll: (sel) => {
      if (sel === '[data-i18n]') return [title, button]
      if (sel === '[data-i18n-html]') return [rich]
      const m = /^\[(data-i18n-[a-z-]+)\]$/.exec(sel)
      if (m) return [button].filter((n) => n.attrs[m[1]])
      return []
    },
  }
  const t = renderer.create({ 'pet.title': 'Desk pet', 'menu.settings': 'Settings', 'menu.settings.hint': 'Open settings', 'about.body': '<b>Hi</b>' }, 'en-US')
  const touched = renderer.applyStatic(doc, { t: t.t, locale: 'en-US' })
  assert.ok(touched >= 3)
  assert.strictEqual(title.textContent, 'Desk pet')
  assert.strictEqual(button.textContent, 'Settings')
  assert.strictEqual(button.attrs.title, 'Open settings')
  assert.strictEqual(rich.innerHTML, '<b>Hi</b>')
  assert.strictEqual(html.lang, 'en-US')
})