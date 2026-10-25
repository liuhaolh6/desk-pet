'use strict'

// CI 里把 e2e 的失败信息变成 GitHub 注解。
//
// 为什么需要它：Actions 的 job 日志要鉴权才能下载（未登录访问 403），
// 而「check-run 注解」对公开仓库是免登录可读的。于是失败时把关键几行
// 用 `::error::` 打进注解，本地用 GitHub API 就能看到，不必再登网页。
//
//   node tools/e2e/annotate.js e2e.log        # UI 里跑（读 $GITHUB_STEP_SUMMARY 也行）
//   node tools/e2e/annotate.js --query <sha>  # 本地用：拉注解打印（需要仓库名）
//
// 只发前 10 条（GitHub 每步最多 10 条 error 注解）。

const fs = require('node:fs')
const path = require('node:path')

const LOG = process.argv[2] || 'e2e.log'
const MAX = 8

function esc(text) {
  return String(text).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
}

function read(file) {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch (err) {
    return ''
  }
}

function interesting(text) {
  const out = []
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (/^(FAIL |e2e (启动失败|异常)|[0-9]+\/[0-9]+ 个用例失败)/.test(line)) {
      out.push(line.trim())
    } else if (/^\s+- /.test(line) && out.length) {
      // 紧跟在 FAIL 下面的断言信息，合并进上一条
      out[out.length - 1] += ` → ${line.trim().replace(/^-\s*/, '')}`
    }
  }
  return out
}

function appLogTail() {
  const root = path.join(__dirname, '..', '..', '.e2e-data')
  let dirs = []
  try {
    dirs = fs.readdirSync(root)
  } catch (err) {
    return []
  }
  const tails = []
  for (const dir of dirs) {
    const file = path.join(root, dir, 'app.log')
    const text = read(file)
    if (text) {
      tails.push(`${dir}/app.log:\n${text.split(/\r?\n/).slice(-6).join('\n')}`)
    }
  }
  return tails
}

const text = read(LOG)
const failures = interesting(text)
const logs = appLogTail()

if (!text) {
  console.log('::error::e2e 没有产出日志（npm run test:e2e 可能根本没跑起来）')
} else {
  const picked = failures.concat(logs).slice(0, MAX)
  for (const line of picked) {
    console.log(`::error::${esc(line).slice(0, 900)}`)
  }
  if (!failures.length) {
    console.log('::error::e2e 失败，但日志里没有 FAIL 行，看下一步注释里的最后几行')
  }
  // 最后 20 行始终打到 stdout：Actions 的日志保留，便于人工复制
  console.log('--- e2e.log tail ---')
  console.log(text.split(/\r?\n/).slice(-20).join('\n'))
}