'use strict'

const test = require('node:test')
const assert = require('node:assert')
const models = require('../../lib/cutout-model')

function fakeFs(entries) {
  return {
    exists: (p) => Object.prototype.hasOwnProperty.call(entries, p),
    size: (p) => entries[p] || 0,
  }
}

test('registry：默认模型是随包携带的 u2net-human，且体积 > 1MB', () => {
  const def = models.byId(models.DEFAULT_MODEL_ID)
  assert.ok(def)
  assert.strictEqual(def.file, 'u2net_human_seg.onnx')
  assert.ok(def.bytes > models.MIN_MODEL_BYTES)
  assert.notStrictEqual(def.optional, true)
})

test('registry：可选模型都标了 optional 与 license', () => {
  const optional = models.MODELS.filter((m) => m.optional)
  assert.ok(optional.length >= 3)
  for (const m of optional) {
    assert.ok(m.license && m.license.length > 0, m.id + ' 缺 license')
    assert.ok(m.input > 0)
  }
})

test('candidates：env 最优先，其次 resources/models，最后仓库 assets', () => {
  const list = models.candidates({ env: 'C:/x.onnx', resourcesPath: 'R:/resources', appDir: 'A:/app' })
  const sep = require('path').sep
  assert.deepStrictEqual(list, [
    'C:/x.onnx',
    ['R:','resources','models','u2net_human_seg.onnx'].join(sep),
    ['A:','app','assets','models','u2net_human_seg.onnx'].join(sep),
  ])
})

test('candidates：没有 env/resourcesPath 时只剩仓库路径', () => {
  const list = models.candidates({ appDir: 'A:/app' })
  assert.strictEqual(list.length, 1)
  assert.ok(list[0].endsWith('u2net_human_seg.onnx'))
})

test('resolve：取第一个存在且大于 1MB 的候选', () => {
  const repo = models.candidates({ appDir: 'A:/app' })[0]
  const fs = fakeFs({ [repo]: 5 * 1024 * 1024 })
  const hit = models.resolve({ appDir: 'A:/app', exists: fs.exists, size: fs.size })
  assert.ok(hit)
  assert.strictEqual(hit.path, repo)
  assert.strictEqual(hit.id, 'u2net-human')
  assert.strictEqual(hit.bundled, true)
})

test('resolve：文件太小（LFS 指针/下载中断）视为不存在', () => {
  const repo = models.candidates({ appDir: 'A:/app' })[0]
  const fs = fakeFs({ [repo]: 2048 })
  assert.strictEqual(models.resolve({ appDir: 'A:/app', exists: fs.exists, size: fs.size }), null)
})

test('resolve：env 路径可用时优先于随包模型', () => {
  const repo = models.candidates({ appDir: 'A:/app' })[0]
  const fs = fakeFs({ [repo]: 9 * 1024 * 1024, 'D:/custom.onnx': 2 * 1024 * 1024 })
  const hit = models.resolve({ env: 'D:/custom.onnx', appDir: 'A:/app', exists: fs.exists, size: fs.size })
  assert.strictEqual(hit.path, 'D:/custom.onnx')
})

test('resolve：指定未知 id 时按 <id>.onnx 找，找不到返回 null', () => {
  const fs = fakeFs({})
  assert.strictEqual(models.resolve({ id: 'nope', appDir: 'A:/app', exists: fs.exists, size: fs.size }), null)
})

test('missingOptional：已经把三个可选模型都报出来', () => {
  const fs = fakeFs({})
  const missing = models.missingOptional({ appDir: 'A:/app', exists: fs.exists })
  assert.deepStrictEqual(missing.map((m) => m.id).sort(), ['birefnet-lite', 'isnet-general', 'u2netp-human'])
})

test('missingOptional：文件已在盘上就不再报告', () => {
  const repo = models.candidates({ appDir: 'A:/app', id: 'u2netp-human' })[0]
  const fs = fakeFs({ [repo]: 5 * 1024 * 1024 })
  const missing = models.missingOptional({ appDir: 'A:/app', exists: fs.exists })
  assert.ok(!missing.some((m) => m.id === 'u2netp-human'))
})