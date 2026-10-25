'use strict'

// 启动一个「干净的」DeskPet 实例供 e2e 用：
//   - 临时数据目录（每次全新，不污染用户配置，也不弹首次引导）
//   - 固定调试端口，等 pet.html 目标出现再交回控制权
//   - 结束时杀掉进程树，删掉临时目录

const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { waitForTarget, sleep } = require('./cdp')

const ROOT = path.resolve(__dirname, '..', '..')

function electronBinary() {
  // require('electron') 在普通 Node 里返回可执行文件路径
  const bin = require('electron')
  if (typeof bin !== 'string') throw new Error('拿不到 Electron 可执行文件路径')
  return bin
}

function seedSettings(dir, patch = {}) {
  const file = path.join(dir, 'settings.json')
  const base = {
    onboarded: true,
    // 不写 city：天气用例自己填。避开启动时的网络请求。
    weather: { city: '', cityNow: '' },
    mode: 'quiet',
    // 固定中文界面：CI 的 windows-latest 是 en-US 系统，不写这一行，
    // 设置页分类会显示成 Weather/Bubble，按文字找分类的用例就会挂。
    locale: 'zh-CN',
  }
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  const settings = Object.assign(base, patch)
  fs.writeFileSync(file, JSON.stringify(settings, null, 2))
}

async function launch(options = {}) {
  const port = options.port || Number(process.env.DESKPET_E2E_PORT || 9333)
  // 数据目录默认放在仓库里的 .e2e-data/：某些受限环境（以及开着杀软的机器）
  // 不允许子进程写 %TEMP%，放仓库里最稳；跑完就删。
  const dataDir = options.dataDir || path.join(ROOT, '.e2e-data', String(process.pid))
  // seed=false：保留上一次进程写下的 settings.json（i18n 用例要验「改完重开生效」，
  // 必须真的重启一次同一个数据目录）。keepData=true：close() 不删目录。
  if (options.seed !== false) seedSettings(dataDir, options.settings)
  // CI 失败时要把 app.log 留下来（check-run 注解只能读得到磁盘上的东西）。
  const keepData = options.keepData === true || process.env.DESKPET_E2E_KEEP === '1'

  const args = [
    '.',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-software-rasterizer',
    `--remote-debugging-port=${port}`,
  ]
  if (options.args) args.push(...options.args)

  const env = Object.assign({}, process.env, options.env || {}, {
    DESKPET_DATA_DIR: dataDir,
    // 允许在没有任何屏幕的 CI 会话里跑
    ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
  })
  delete env.ELECTRON_RUN_AS_NODE

  const child = spawn(electronBinary(), args, {
    cwd: ROOT,
    env,
    stdio: options.verbose ? 'inherit' : 'ignore',
    windowsHide: true,
  })

  let exited = false
  const exitInfo = { code: null, signal: null }
  child.on('exit', (code, signal) => {
    exited = true
    exitInfo.code = code
    exitInfo.signal = signal
  })

  try {
    await waitForTarget(port, 'pet.html', options.timeoutMs || 30000)
  } catch (err) {
    child.kill()
    throw new Error(
      `DeskPet 没有在超时内起来（${err.message}）；日志：${path.join(dataDir, 'app.log')}`
    )
  }
  // 等首帧布局稳定，免得用例读到 0 尺寸
  await sleep(options.settleMs || 1200)

  return {
    port,
    dataDir,
    child,
    exited: () => exited,
    exitInfo,
    async close() {
      if (!exited) {
        child.kill()
        for (let i = 0; i < 20 && !exited; i += 1) await sleep(100)
        if (!exited) {
          try {
            spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'], { windowsHide: true })
          } catch (err) {
            /* 尽力而为 */
          }
        }
      }
      try {
        if (!keepData) fs.rmSync(dataDir, { recursive: true, force: true })
      } catch (err) {
        /* Windows 上偶发占用，留个目录没关系 */
      }
    },
  }
}

module.exports = { launch, ROOT }