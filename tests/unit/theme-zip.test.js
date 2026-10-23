'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { readZip, writeZip, crc32, idFromFileName } = require('../../lib/theme-zip')

test('crc32 matches the classic check value', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926)
})

test('roundtrips multiple entries in order', () => {
  const zip = writeZip([
    { name: 'theme.json', data: '{"id":"pixel"}' },
    { name: 'notes.txt', data: 'hello' },
  ])
  const back = readZip(zip)
  assert.deepEqual(back.map((e) => e.name), ['theme.json', 'notes.txt'])
  assert.equal(back[0].data.toString('utf8'), '{"id":"pixel"}')
})

test('roundtrips utf-8 names and a non-ascii payload', () => {
  const zip = writeZip([{ name: '主题/说明.txt', data: '配色：像素' }])
  const back = readZip(zip)
  assert.equal(back[0].name, '主题/说明.txt')
  assert.equal(back[0].data.toString('utf8'), '配色：像素')
})

test('reads a deflated entry written by another tool', () => {
  const zlib = require('zlib')
  const data = Buffer.from('x'.repeat(2000))
  const deflated = zlib.deflateRawSync(data)
  // Hand-build a single-entry deflate zip (method 8).
  const name = Buffer.from('a.txt')
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt16LE(0, 6)
  local.writeUInt16LE(8, 8)
  local.writeUInt32LE(0, 10)
  local.writeUInt32LE(0, 14)
  local.writeUInt32LE(deflated.length, 18)
  local.writeUInt32LE(data.length, 22)
  local.writeUInt16LE(name.length, 26)
  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt16LE(8, 10)
  central.writeUInt32LE(deflated.length, 20)
  central.writeUInt32LE(data.length, 24)
  central.writeUInt16LE(name.length, 28)
  central.writeUInt32LE(0, 42)
  const cen = Buffer.concat([central, name])
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(1, 8)
  eocd.writeUInt16LE(1, 10)
  eocd.writeUInt32LE(cen.length, 12)
  eocd.writeUInt32LE(30 + name.length + deflated.length, 16)
  const zip = Buffer.concat([local, name, deflated, cen, eocd])
  const back = readZip(zip)
  assert.equal(back[0].data.toString('utf8'), data.toString('utf8'))
})

test('rejects a buffer that is not a zip', () => {
  assert.throws(() => readZip(Buffer.from('not a zip at all, really not')), /not-a-zip/)
})

test('accepts an empty archive', () => {
  assert.deepEqual(readZip(writeZip([])), [])
})

test('idFromFileName sanitises to ascii kebab-case', () => {
  assert.equal(idFromFileName('Pixel Night.zip'), 'pixel-night')
  assert.equal(idFromFileName('主题包.zip'), '')
  assert.equal(idFromFileName('a/b/Deep--Night.ZIP'), 'deep--night')
  assert.equal(idFromFileName(''), '')
})