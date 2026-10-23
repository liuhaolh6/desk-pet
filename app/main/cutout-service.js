'use strict'
/**
 * P1-1 阶段 3：抠图服务（解码 / 输入令牌 / 子进程 / 进程内回退 / 轨迹）。
 *
 * Behaviour is a straight move out of main.js. The only shape change is that
 * the native image constructor, the store and the worker entry point arrive as
 * dependencies, so this file has no `require('electron')` at module scope and
 * can be loaded by the smoke test.
 */

const MAX_IMAGE_BYTES = 25 * 1024 * 1024
const CUTOUT_INPUT_LIMIT = 3

/** Codes that are a real segmentation answer and must not be retried in-process. */
const REAL_ANSWERS = ['NO_PERSON', 'OVER_SEGMENTED', 'MODEL_MISSING', 'MODEL_LOAD_FAILED', 'NO_OUTPUT', 'BAD_OUTPUT_SHAPE', 'BAD_IMAGE']

function decodeImageDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') {
    const err = new Error('没收到图片数据')
    err.code = 'NO_DATA'
    throw err
  }
  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=\s]+)$/i)
  if (!match) throw new Error('这个格式还看不了呢')
  const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64')
  if (!buffer.length) throw new Error('这张图是空的')
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error('图片超过 25MB 啦，先压缩一下好吗')
  return { buffer, mime: match[1].toLowerCase() }
}

function cutoutErrorMessage(code) {
  if (code === 'NO_PERSON') return '没找到清晰的人像'
  if (code === 'OVER_SEGMENTED') return '画面里人像占得太多了，可能把背景也当成你了'
  if (code === 'MODEL_MISSING' || code === 'MODEL_LOAD_FAILED') return '抠图模型还没准备好'
  if (code === 'BAD_OUTPUT_SHAPE' || code === 'NO_OUTPUT') return '模型这次没给出结果'
  return '这次没抠成'
}

/**
 * @param {object} deps
 * @param {object} deps.store
 * @param {object} deps.nativeImage Electron nativeImage
 * @param {object} deps.cutout      lib/cutout
 * @param {object} deps.app         Electron app (isPackaged)
 * @param {Function} deps.utilityProcess  Electron utilityProcess.fork
 * @param {object} deps.path
 * @param {object} deps.fs
 * @param {Function} [deps.log]
 * @param {string} [deps.rootDir]   __dirname of app/main.js (project root resolution)
 */
function createCutoutService(deps) {
  const { store, nativeImage, cutout, app, utilityProcess, path, fs, log = () => {}, rootDir } = deps
  const inputs = new Map()
  let worker = null
  let seq = 0
  const pending = new Map()

  /** One JSON line per cutout attempt; rotate at 256KB. Local diagnostics only. */
  function trace(entry) {
    try {
      const file = path.join(store.dir, 'cutout-trace.jsonl')
      try { if (fs.statSync(file).size > 256 * 1024) fs.renameSync(file, file + '.1') } catch (err) {}
      fs.appendFileSync(file, JSON.stringify(Object.assign({ at: new Date().toISOString() }, entry)) + '\n')
    } catch (err) {
      log('cutout trace failed', String(err))
    }
  }

  function workerPath() {
    const script = path.join(rootDir, '..', 'lib', 'cutout-worker.js')
    if (!app.isPackaged) return script
    // lib is asarUnpacked so the utility process gets a real file path and can
    // resolve onnxruntime-node/onnxruntime-common from the same unpacked tree.
    const unpacked = script.replace('app.asar', 'app.asar.unpacked')
    try { if (fs.existsSync(unpacked)) return unpacked } catch (err) {}
    return script
  }

  function ensureWorker() {
    if (worker) return worker
    const child = utilityProcess.fork(workerPath(), [], { serviceName: 'deskpet-cutout' })
    child.on('message', (message) => {
      const entry = pending.get(message && message.id)
      if (!entry) return
      pending.delete(message.id)
      clearTimeout(entry.timer)
      entry.resolve(message)
    })
    child.on('exit', (code) => {
      log('cutout worker exited code=' + code)
      worker = null
      for (const entry of pending.values()) {
        clearTimeout(entry.timer)
        entry.reject(Object.assign(new Error('WORKER_EXITED'), { code: 'WORKER_EXITED' }))
      }
      pending.clear()
    })
    worker = child
    return child
  }

  function stopWorker() {
    if (worker) {
      try { worker.kill() } catch (err) {}
      worker = null
    }
  }

  function runInWorker(rgba, width, height, options) {
    return new Promise((resolve, reject) => {
      let child
      try { child = ensureWorker() } catch (err) {
        reject(Object.assign(new Error('WORKER_SPAWN_FAILED: ' + err.message), { code: 'WORKER_SPAWN_FAILED' }))
        return
      }
      const id = ++seq
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(Object.assign(new Error('WORKER_TIMEOUT'), { code: 'WORKER_TIMEOUT' }))
      }, 60000)
      pending.set(id, { resolve, reject, timer })
      const payload = rgba.buffer.slice(rgba.byteOffset, rgba.byteOffset + rgba.byteLength)
      try {
        // Electron's postMessage transfer list only accepts MessagePorts; the
        // ArrayBuffer is structured-cloned (copied) instead.
        child.postMessage({
          type: 'run',
          id,
          rgba: payload,
          width,
          height,
          canvas: options.canvas,
          preprocess: options.preprocess,
          decontaminate: options.decontaminate,
        })
      } catch (err) {
        pending.delete(id)
        clearTimeout(timer)
        reject(Object.assign(new Error('WORKER_POST_FAILED: ' + err.message), { code: 'WORKER_POST_FAILED' }))
      }
    })
  }

  /**
   * Run the cutout, preferring the utility process. Returns the same shape as
   * `cutout.cutoutImageRGBA` (png/maskPng/coverage/...), with decode done here.
   */
  async function runDecoded(image, options) {
    const { rgba, width, height } = cutout.loadWorkingRGBA(nativeImage, image)
    const inline = process.env.DESKPET_CUTOUT_INLINE === '1'
    if (!inline) {
      try {
        const message = await runInWorker(rgba, width, height, options)
        if (message && message.ok) {
          return {
            png: Buffer.from(message.png),
            maskPng: Buffer.from(message.maskPng),
            coverage: message.coverage,
            bands: message.bands,
            timings: message.timings,
            ms: message.ms,
            preprocess: message.preprocess,
            source: message.source,
            working: message.working,
            cutout: message.cutout,
          }
        }
        throw Object.assign(new Error(message && message.message || 'worker failed'), {
          code: (message && message.code) || 'CUTOUT_FAILED',
          coverage: message && message.coverage,
        })
      } catch (err) {
        // A real segmentation answer (NO_PERSON / OVER_SEGMENTED) must be
        // reported as-is; only infrastructure failures fall back in-process.
        const code = (err && err.code) || 'CUTOUT_FAILED'
        if (REAL_ANSWERS.includes(code)) throw err
        log('cutout worker failed, running in-process', code, String(err && err.message || err))
        stopWorker()
        return cutout.cutoutImageRGBA(rgba, width, height, options)
      }
    }
    return cutout.cutoutImageRGBA(rgba, width, height, options)
  }

  function previewDataUrl(image, max = 1200) {
    const preview = cutout.scaleOnly(image, max)
    return 'data:image/png;base64,' + preview.toPNG().toString('base64')
  }

  function remember(image, name) {
    const token = 'c' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
    inputs.set(token, { image, name: String(name || '').slice(0, 30), at: Date.now() })
    while (inputs.size > CUTOUT_INPUT_LIMIT) {
      const oldest = inputs.keys().next().value
      inputs.delete(oldest)
    }
    return token
  }

  function inputPayload(image, name) {
    const size = image.getSize()
    return {
      token: remember(image, name),
      dataUrl: previewDataUrl(image),
      name: String(name || '').slice(0, 30),
      width: size.width,
      height: size.height,
    }
  }

  function takeInput(token) {
    const entry = token && inputs.get(token)
    return entry ? entry.image : null
  }

  function clearInputs() {
    inputs.clear()
  }

  return {
    MAX_IMAGE_BYTES,
    decodeImageDataUrl,
    errorMessage: cutoutErrorMessage,
    trace,
    runDecoded,
    inputPayload,
    takeInput,
    stopWorker,
    clearInputs,
    workerRunning: () => !!worker,
    pendingCount: () => pending.size,
    inputCount: () => inputs.size,
  }
}

module.exports = { createCutoutService, decodeImageDataUrl, cutoutErrorMessage, MAX_IMAGE_BYTES }