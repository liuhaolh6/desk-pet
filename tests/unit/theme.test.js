'use strict'
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const theme = require('../../lib/theme')

test('validateTheme：合法主题通过并丢掉白名单外的 token', () => {
  const res = theme.validateTheme({
    id: 'pixel',
    nameKey: 'theme.pixel',
    tokens: { '--ink': '#fff', '--radius-sm': '0px', '--evil': 'x' },
  })
  assert.equal(res.ok, false, '--evil 应该被记为错误')
  assert.deepEqual(Object.keys(res.theme.tokens).sort(), ['--ink', '--radius-sm'])
  assert.ok(res.errors.includes('unknown-token:--evil'))
})

test('validateTheme：能突破声明的取值被拒', () => {
  for (const bad of ['red;}</style><script>', 'url(javascript:1)', 'expression(alert(1))', '#fff}body{display:none']) {
    const res = theme.validateTheme({ id: 'x', tokens: { '--ink': bad } })
    assert.equal(res.ok, false, bad)
    assert.ok(res.errors.some((e) => e === 'unsafe-token-value:--ink'), bad)
  }
})

test('validateTheme：非白名单 token 全被拒（不能改布局）', () => {
  const res = theme.validateTheme({ id: 'x', tokens: { '--position': 'fixed', '--z-index': '9999' } })
  assert.equal(res.ok, false)
  assert.deepEqual(res.errors.sort(), ['unknown-token:--position', 'unknown-token:--z-index'])
})

test('validateTheme：id 规则与必填字段', () => {
  assert.equal(theme.validateTheme({ tokens: { '--ink': '#000' } }).errors.includes('bad-id'), true)
  assert.equal(theme.validateTheme({ id: 'X Y', tokens: { '--ink': '#000' } }).ok, false)
  assert.equal(theme.validateTheme({ id: '-lead', tokens: { '--ink': '#000' } }).ok, false)
  assert.equal(theme.validateTheme({ id: 'pixel-2', tokens: { '--ink': '#000' } }).ok, true)
  assert.equal(theme.validateTheme({ id: 'x' }).errors.includes('missing-tokens'), true)
  assert.equal(theme.validateTheme(null).ok, false)
})

test('validateTheme：空的 tokens 也合法（默认包就是“不覆盖”）', () => {
  const res = theme.validateTheme({ id: 'default', nameKey: 'theme.default', tokens: {} })
  assert.equal(res.ok, true)
  assert.equal(theme.tokensToCss(res.theme.tokens), '')
})

test('validateTheme：nameKey 缺省时按 id 生成', () => {
  const res = theme.validateTheme({ id: 'sea', tokens: { '--ink': '#000' } })
  assert.equal(res.theme.nameKey, 'theme.sea')
})

test('tokensToCss：按名字排序，白名单外忽略，空集合给空串', () => {
  assert.equal(theme.tokensToCss({ '--ink': '#000', '--accent': '#f00' }), ':root{--accent:#f00;--ink:#000;}')
  assert.equal(theme.tokensToCss({ '--position': 'fixed' }), '')
  assert.equal(theme.tokensToCss({}), '')
})

test('mergeTheme：覆盖层只盖自己的键', () => {
  assert.deepEqual(
    theme.mergeTheme({ tokens: { '--ink': '#000', '--bg': '#fff' } }, { tokens: { '--ink': '#111' } }),
    { '--ink': '#111', '--bg': '#fff' }
  )
})

test('内置主题都在白名单内、id 与目录一致、不碰尺寸变量', () => {
  const root = path.join(__dirname, '..', '..')
  const dir = path.join(root, 'themes')
  const ids = fs.readdirSync(dir).filter((id) => fs.existsSync(path.join(dir, id, 'theme.json')))
  assert.ok(ids.length >= 2, '至少两个内置主题')
  for (const id of ids) {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, id, 'theme.json'), 'utf8'))
    const res = theme.validateTheme(raw)
    assert.equal(res.ok, true, id + ': ' + res.errors.join(','))
    assert.equal(res.theme.id, id)
    for (const key of Object.keys(raw.tokens || {})) {
      assert.ok(theme.ALLOWED.includes(key), id + ' 用了白名单外 token: ' + key)
      assert.ok(!/^(--u$|--pet-size|--bubble-v|--bubble-h|--window)/.test(key), id + ' 不能改尺寸: ' + key)
    }
  }
})