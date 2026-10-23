'use strict'
// P2-1：数据目录顺序（安装版把状态放 %APPDATA%，便携版放 exe 旁，开发态维持旧顺序）。
const test = require('node:test')
const assert = require('node:assert')
const path = require('node:path')

const { dataDirCandidates } = require('../../app/main/boot')

const base = {
  envDir: '',
  portableDir: '',
  exeDir: 'C:\\Apps\\DeskPet',
  installed: false,
  roaming: 'C:\\Users\\me\\AppData\\Roaming',
  tmp: 'C:\\Temp',
}

test('DESKPET_DATA_DIR 永远排第一', () => {
  const list = dataDirCandidates({ ...base, envDir: 'D:\\dev-data' })
  assert.equal(list[0], path.resolve('D:\\dev-data'))
})

test('便携版：exe 旁的数据目录优先于用户目录', () => {
  const list = dataDirCandidates({ ...base, portableDir: 'E:\\Stick\\DeskPet' })
  assert.equal(list[0], path.join('E:\\Stick\\DeskPet', 'desk-pet-data'))
  assert.equal(list[1], path.join('C:\\Apps\\DeskPet', 'desk-pet-data'))
  assert.equal(list[2], path.join('C:\\Users\\me\\AppData\\Roaming', 'desk-pet'))
})

test('安装版：先 %APPDATA%（卸载不丢数据），exe 旁只作兜底', () => {
  const list = dataDirCandidates({ ...base, installed: true })
  assert.deepEqual(list, [
    path.join('C:\\Users\\me\\AppData\\Roaming', 'desk-pet'),
    path.join('C:\\Apps\\DeskPet', 'desk-pet-data'),
    path.join('C:\\Temp', 'desk-pet'),
  ])
})

test('开发态（未打包）：保持 exe\\.desk-pet-data 在最前，临时目录兜底', () => {
  const list = dataDirCandidates(base)
  assert.deepEqual(list, [
    path.join('C:\\Apps\\DeskPet', 'desk-pet-data'),
    path.join('C:\\Users\\me\\AppData\\Roaming', 'desk-pet'),
    path.join('C:\\Temp', 'desk-pet'),
  ])
})

test('缺少漫游目录信息时不生成空路径项', () => {
  const list = dataDirCandidates({ ...base, installed: true, roaming: '' })
  assert.deepEqual(list, [path.join('C:\\Apps\\DeskPet', 'desk-pet-data'), path.join('C:\\Temp', 'desk-pet')])
})