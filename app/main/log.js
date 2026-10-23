/**
 * Log + breadcrumb plumbing for the main process (P1-1 split).
 *
 * Two files matter when a launch fails: a best-effort breadcrumb next to the
 * executable, written before any data directory exists, and the real log, which
 * moves into the data directory once that has been chosen. Lines written before
 * the move are buffered and flushed, so boot logs stay in one file.
 */
'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

function createLogger() {
  let file = null
  const pending = []

  function breadcrumb(text) {
    try {
      // 开发时写在仓库根（exe 旁边）好找；打包后 exe 在安装目录里，写进去会让用户的
      // Programs 目录多出一个陌生日志，所以退回系统临时目录（诊断时让用户发 %TEMP%\desk-pet-boot.log）。
      const dir = process.defaultApp ? path.dirname(process.execPath) : os.tmpdir()
      const target = path.join(dir, 'desk-pet-boot.log')
      let size = 0
      try { size = fs.statSync(target).size } catch (err) {}
      if (size > 32 * 1024) fs.writeFileSync(target, '')
      fs.appendFileSync(target, new Date().toISOString() + ' ' + text + '\n')
    } catch (err) {}
  }

  function writeLine(line) {
    if (!file) { pending.push(line); return }
    try { fs.appendFileSync(file, line) } catch (err) {}
  }

  function log() {
    writeLine(new Date().toISOString() + ' ' + Array.prototype.join.call(arguments, ' ') + '\n')
  }

  function setFile(next) {
    file = next
    for (const line of pending.splice(0)) writeLine(line)
  }

  function filePath() { return file }

  /** Last `maxLines` lines of `target`, never more than `maxBytes` from the end. */
  function tail(target, maxLines, maxBytes) {
    if (!target) return '（还没有日志文件）'
    try {
      const buf = fs.readFileSync(target)
      const slice = buf.length > maxBytes ? buf.subarray(buf.length - maxBytes) : buf
      const lines = slice.toString('utf8').split(/\r?\n/)
      if (buf.length > maxBytes && lines.length > 1) lines[0] = '…（更早的内容已省略）'
      return lines.slice(-maxLines).join('\n')
    } catch (err) {
      return '（读不到：' + ((err && err.message) || String(err)) + '）'
    }
  }

  return { breadcrumb, log, setFile, filePath, tail }
}

module.exports = { createLogger }