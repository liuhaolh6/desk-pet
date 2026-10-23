/**
 * 打包前清理 dist/ 与 Electron 发行目录里“上一次运行残留”的东西。
 *
 * 为什么需要：electron-builder 复用 `dist/win-unpacked`（只覆盖拷贝、不删多余文件），
 * 而“自定义 Electron 发行目录”用的是 `node_modules/electron/dist`。开发时我们用
 * `electron .` 跑过应用，启动日志 `desk-pet-boot.log` 就落在 `node_modules/electron/dist/`
 * 里；打包时它被当成 Electron 发行的一部分复制进 win-unpacked，最终**打进安装包**——
 * 用户装上后会在安装目录看到一个陌生的、内容是开发者机器路径的日志。
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const dirs = [
  path.join(root, 'dist', 'win-unpacked'),
  path.join(root, 'dist', 'win-unpacked.tmp'),
]
const files = [
  path.join(root, 'node_modules', 'electron', 'dist', 'desk-pet-boot.log'),
  path.join(root, 'desk-pet-boot.log'),
]

for (const dir of dirs) {
  try {
    fs.rmSync(dir, { recursive: true, force: true })
    console.log('cleaned', path.relative(root, dir))
  } catch (err) {
    console.log('skip', path.relative(root, dir), (err && err.message) || err)
  }
}

for (const file of files) {
  try {
    if (fs.existsSync(file)) {
      fs.rmSync(file, { force: true })
      console.log('cleaned', path.relative(root, file))
    }
  } catch (err) {
    console.log('skip', path.relative(root, file), (err && err.message) || err)
  }
}