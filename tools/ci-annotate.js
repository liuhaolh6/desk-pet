'use strict'

// CI 用：把一段构建日志里"像错误"的行写成 check-run 注解。
//
// 公开仓库的 job 日志要鉴权才能下载（未登录 403），check-run 注解却是公开可读的，
// 所以构建脚本失败时把它当"信鸽"：
//
//   node tools/ci-annotate.js <log 文件> [最多几条]
//
// 除了注解，还会把日志最后 40 行打到 stdout（Actions 页面能直接看，本地跑也能看）。

const fs = require('node:fs')

const file = process.argv[2] || 'build.log'
const max = Number(process.argv[3] || 10)

function esc(text) {
  return String(text).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
}

let text = ''
try {
  text = fs.readFileSync(file, 'utf8')
} catch (err) {
  console.log(`::error::${file} 不存在，构建可能根本没开始`)
  process.exit(0)
}

const lines = text.split(/\r?\n/)
const interesting = lines.filter((line) =>
  /(error|Error|ERROR|failed|Failed|FAILED|cannot|Cannot|ERR_|ENOSPC|EPERM|exit code)/.test(line)
)

const picked = (interesting.length ? interesting : lines.filter((l) => l.trim()).slice(-max)).slice(-max)
for (const line of picked) {
  console.log(`::error::${esc(line.trim()).slice(0, 900)}`)
}

console.log(`--- ${file} tail ---`)
console.log(lines.slice(-40).join('\n'))