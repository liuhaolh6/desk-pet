'use strict'
// 临时：吊着一个调试实例（9229），给 a11y-audit / a11y-tree / a11y-real 用。
const { launch } = require('./tools/e2e/launch')

;(async () => {
  const app = await launch({
    port: 9229,
    dataDir: require('path').join(__dirname, '.dev-p26s3'),
    settings: { locale: 'zh-CN' },
    keepData: true,
  })
  console.log('READY', app.port, app.dataDir)
  const bye = async () => {
    await app.close()
    process.exit(0)
  }
  process.on('SIGINT', bye)
  process.on('SIGTERM', bye)
  setInterval(() => {}, 1000)
})().catch((err) => {
  console.error('HOST ERR', err.message)
  process.exit(1)
})