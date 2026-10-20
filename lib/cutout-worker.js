'use strict'

/**
 * Cutout worker (P1-5).
 *
 * Runs the pure `cutoutImageRGBA` core inside an Electron `utilityProcess` so
 * the main process never sits in the 320->610 compose/encode path (measured
 * ~60ms) or in ONNX inference (~600ms). The parent sends straight RGBA at the
 * working resolution and gets the final PNG / mask PNG buffers back.
 *
 * The same file also works under plain Node when a `parentPort` is available
 * (Electron utilityProcess); it exits quietly otherwise so a mistaken direct
 * run does not hang.
 */

const cutout = require('./cutout')

function post(message) {
  process.parentPort.postMessage(message)
}

function handle(message) {
  const msg = message && message.data ? message.data : message
  if (!msg || msg.type !== 'run') return
  Promise.resolve().then(async () => {
    try {
      const rgba = Buffer.from(msg.rgba)
      const result = await cutout.cutoutImageRGBA(rgba, msg.width, msg.height, {
        canvas: msg.canvas,
        preprocess: msg.preprocess,
        decontaminate: msg.decontaminate,
      })
      post({
        id: msg.id,
        ok: true,
        png: result.png,
        maskPng: result.maskPng,
        coverage: result.coverage,
        bands: result.bands,
        timings: result.timings,
        ms: result.ms,
        preprocess: result.preprocess,
        source: result.source,
        working: result.working,
        cutout: result.cutout,
      })
    } catch (err) {
      post({
        id: msg.id,
        ok: false,
        code: (err && err.code) || 'CUTOUT_FAILED',
        message: String((err && err.message) || err),
        coverage: typeof err.coverage === 'number' ? err.coverage : null,
      })
    }
  })
}

if (process.parentPort && typeof process.parentPort.on === 'function') {
  process.parentPort.on('message', handle)
}