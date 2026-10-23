'use strict'
/**
 * P1-1 阶段 4：选数据目录 + 单实例锁。
 *
 * 这一段必须在 Electron 建窗口之前跑完，而且**不能碰 `app.getPath('userData')`**：
 * 在受限环境里它会在原生层直接崩，连 catch 的机会都没有（见 HANDOFF §6.1）。
 * 所以它单独成文件，`main.js` 里只剩三行调用。
 */

const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')

/**
 * @param {object} deps
 * @param {object} deps.app
 * @param {object} deps.logger  createLogger() 的返回值（需要 setFile）
 * @param {function} deps.log
 * @param {function} deps.breadcrumb
 * @param {string} deps.devLogFile 开发态 app.log 的位置（仓库根）
 * @param {string} [deps.portableDir]
 * @returns {{ dir: string, hasLock: boolean }}
 */
function bootDataDir(deps) {
  const { app, logger, log, breadcrumb, devLogFile } = deps
  const portableDir = deps.portableDir || ''
  log('pickDataDir start')

  function candidateDirs() {
    const candidates = []
    if (process.env.DESKPET_DATA_DIR) candidates.push(path.resolve(process.env.DESKPET_DATA_DIR))
    // Portable build: keep settings next to the exe so the folder can be moved or
    // copied (including to a USB stick) without losing state.
    if (portableDir) candidates.push(path.join(portableDir, 'desk-pet-data'))
    // Unpacked build: also allow the data folder next to the exe. This keeps the
    // app usable when antivirus blocks writes to the user profile.
    try { candidates.push(path.join(path.dirname(process.execPath), 'desk-pet-data')) } catch (err) {}
    // Do NOT use app.getPath('userData') here: in restricted environments it can
    // crash the process natively before we get a chance to fall back.
    if (process.platform === 'win32') {
      const roaming = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
      candidates.push(path.join(roaming, 'desk-pet'))
    } else {
      candidates.push(path.join(os.homedir(), '.desk-pet'))
    }
    candidates.push(path.join(os.tmpdir(), 'desk-pet'))
    return candidates
  }

  const candidates = candidateDirs()
  breadcrumb('candidates=' + candidates.join(' | '))
  let dir = null
  for (const candidate of candidates) {
    log('trying data dir ' + candidate)
    try {
      fs.mkdirSync(candidate, { recursive: true })
      fs.accessSync(candidate, fs.constants.W_OK)
      log('using data dir ' + candidate)
      breadcrumb('data=' + candidate)
      dir = candidate
      break
    } catch (err) { log('data dir unusable', candidate, String(err && err.code)) }
  }
  if (!dir) dir = candidates[candidates.length - 1]

  logger.setFile(app.isPackaged ? path.join(dir, 'app.log') : devLogFile)
  try { app.setPath('userData', dir) } catch (err) { log('setPath failed', String(err)) }
  log('userData=' + app.getPath('userData'))

  let hasLock = false
  try { hasLock = app.requestSingleInstanceLock() } catch (err) { log('lock threw', (err && err.stack) || String(err)) }
  log('lock=' + hasLock)
  if (!hasLock) {
    // Another instance usually owns the lock; keep running anyway. A silently
    // missing pet is worse than a duplicate, which the user can close from its menu.
    log('single instance lock denied, continuing anyway')
    breadcrumb('lock denied, continuing')
  }
  return { dir, hasLock }
}

module.exports = { bootDataDir }