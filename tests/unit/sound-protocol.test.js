'use strict'
/**
 * 0.6.13 回归：导入的音效要能被渲染层 fetch 到。
 *
 * `app/sound-model.js` 用 `fetch('pet-sound://sound/<id>')` + `decodeAudioData`
 * 播放用户导入的文件；渲染层跑在 `file://` 页面里，自定义协议没开 CORS 时
 * 浏览器层直接把请求挡掉（"Failed to fetch"），表现就是用户导入的音效全部
 * 没声音，而内置 preset 走 WebAudio 合成、照常出声。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { createCatalog } = require('../../app/main/catalog.js')

const WAV = Buffer.from('RIFF\x24\x00\x00\x00WAVEfmt \x10\x00\x00\x00', 'binary')
const MP3 = Buffer.from('ID3\x04\x00\x00\x00\x00\x00\x00', 'binary')

function makeCatalog(paths) {
  const fs = {
    readFileSync(file) {
      if (!(file in paths)) throw new Error('ENOENT: ' + file)
      return paths[file]
    },
  }
  const store = {
    soundPath: (id) => (id in paths ? id : null),
    readSounds: () => ({ files: [] }),
    readRoles: () => ({ roles: [] }),
  }
  return createCatalog({ fs, store, assets: 'assets', BrowserWindow: {}, trayHost: null })
}

test('pet-sound 响应带 CORS 头，file:// 页面才 fetch 得到字节', async () => {
  const cat = makeCatalog({ 'test.wav': WAV })
  const res = cat.handleSoundProtocol({ url: 'pet-sound://sound/test.wav' })
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('access-control-allow-origin'), '*')
  assert.equal(res.headers.get('access-control-allow-headers'), '*')
  assert.equal(res.headers.get('content-type'), 'audio/wav')
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), WAV)
})

test('按扩展名给对的 audio/* 类型', () => {
  const cat = makeCatalog({ 'a.mp3': MP3 })
  const res = cat.handleSoundProtocol({ url: 'pet-sound://sound/a.mp3' })
  assert.equal(res.headers.get('content-type'), 'audio/mpeg')
  assert.equal(res.headers.get('access-control-allow-origin'), '*')
})

test('未知 id / 错误 host 仍是 404，不抛', () => {
  const cat = makeCatalog({})
  assert.equal(cat.handleSoundProtocol({ url: 'pet-sound://sound/nope.wav' }).status, 404)
  assert.equal(cat.handleSoundProtocol({ url: 'pet-sound://other/nope.wav' }).status, 404)
})