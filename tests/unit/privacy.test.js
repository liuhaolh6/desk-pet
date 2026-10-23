/**
 * P2-4 数据与隐私：清单数字来自真实文件，清理只动可重建的垃圾。
 *
 * 这些用例会真的建临时目录、真的删文件——因为它们要证明的正是
 * “删的是日志和缓存，不是用户的设置和照片”。
 */
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { createPrivacy, NETWORK_ENDPOINTS, CACHE_DIRS } = require('../../app/main/privacy.js')

function makeJunk() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deskpet-privacy-'))
  fs.writeFileSync(path.join(dir, 'settings.json'), '{"name":"小芳"}')
  fs.mkdirSync(path.join(dir, 'photos'))
  fs.writeFileSync(path.join(dir, 'photos', 'a.jpg'), Buffer.alloc(2048))
  fs.mkdirSync(path.join(dir, 'roles'))
  fs.writeFileSync(path.join(dir, 'roles', 'mine.png'), Buffer.alloc(512))
  fs.writeFileSync(path.join(dir, 'app.log'), Buffer.alloc(1024))
  fs.writeFileSync(path.join(dir, 'cutout-trace.jsonl'), Buffer.alloc(512))
  fs.mkdirSync(path.join(dir, 'Cache'))
  fs.writeFileSync(path.join(dir, 'Cache', 'blob'), Buffer.alloc(4096))
  fs.mkdirSync(path.join(dir, 'Code Cache'))
  fs.writeFileSync(path.join(dir, 'Code Cache', 'js'), Buffer.alloc(2048))
  return dir
}

test('summary：数字来自磁盘实测，不是常量', () => {
  const dir = makeJunk()
  try {
    const privacy = createPrivacy({ dir, fs, path, log: () => {} })
    const info = privacy.summary()
    assert.equal(info.dir, dir)
    assert.equal(info.files.settings.bytes, Buffer.byteLength('{"name":"小芳"}'))
    assert.deepEqual(info.files.photos, { count: 1, bytes: 2048 })
    assert.deepEqual(info.files.roles, { count: 1, bytes: 512 })
    assert.equal(info.files.log.bytes, 1024)
    assert.equal(info.files.trace.bytes, 512)
    assert.equal(info.files.caches.count, 2)
    assert.equal(info.files.caches.bytes, 4096 + 2048)
    assert.equal(info.junkBytes, 1024 + 512 + 4096 + 2048)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('summary：目录还不存在时给 0，而不是抛错', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deskpet-privacy-empty-'))
  try {
    const privacy = createPrivacy({ dir, fs, path, log: () => {} })
    const info = privacy.summary()
    assert.equal(info.files.settings.bytes, 0)
    assert.equal(info.files.photos.count, 0)
    assert.equal(info.junkBytes, 0)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('cleanup：删日志、轨迹、缓存，保住设置/照片/角色图', async () => {
  const dir = makeJunk()
  try {
    const privacy = createPrivacy({ dir, fs, path, log: () => {} })
    const before = privacy.summary()
    const result = await privacy.cleanup()

    assert.equal(fs.existsSync(path.join(dir, 'app.log')), false)
    assert.equal(fs.existsSync(path.join(dir, 'cutout-trace.jsonl')), false)
    assert.equal(fs.existsSync(path.join(dir, 'Cache', 'blob')), false)
    assert.equal(fs.existsSync(path.join(dir, 'Code Cache', 'js')), false)

    assert.equal(fs.existsSync(path.join(dir, 'settings.json')), true)
    assert.equal(fs.existsSync(path.join(dir, 'photos', 'a.jpg')), true)
    assert.equal(fs.existsSync(path.join(dir, 'roles', 'mine.png')), true)

    assert.ok(result.removed >= 4, '至少删掉 4 项')
    assert.ok(result.junkBytes < before.junkBytes)
    assert.equal(result.files.photos.count, 1, '清理后照片数量不变')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('cleanup：缓存目录本身保留，省得 Chromium 再建一遍', async () => {
  const dir = makeJunk()
  try {
    const privacy = createPrivacy({ dir, fs, path, log: () => {} })
    await privacy.cleanup()
    assert.equal(fs.existsSync(path.join(dir, 'Cache')), true)
    assert.deepEqual(fs.readdirSync(path.join(dir, 'Cache')), [])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('网络清单：只列真正会连的域名，并有开放式描述', () => {
  const hosts = NETWORK_ENDPOINTS.map((e) => e.host)
  assert.ok(hosts.includes('api.open-meteo.com'), '天气预报')
  assert.ok(hosts.includes('geocoding-api.open-meteo.com'), '城市搜索')
  assert.ok(hosts.includes('raw.githubusercontent.com'), '更新检查')
  assert.ok(!hosts.some((h) => /wttr\.in|google|baidu|sentry|analytics/i.test(h)), '不该出现外部统计或旧接口')
  for (const entry of NETWORK_ENDPOINTS) {
    assert.ok(entry.id, '每行有 id（用于查翻译）')
    assert.ok(/^privacy.net./.test('privacy.net.' + entry.id), 'id 可拼成 privacy.net.<id>')
  }
  assert.ok(CACHE_DIRS.includes('Cache') && CACHE_DIRS.includes('GPUCache'))
})