'use strict'

/**
 * Cutout model registry (P2-5).
 *
 * The pipeline in `lib/cutout.js` used to hard-code one file name. That made
 * "try a better model" a code change; now it is a data change. The registry is
 * pure data + pure resolution logic so it can be unit tested without ONNX.
 *
 * Order of resolution, first hit wins:
 *   1. `DESKPET_CUTOUT_MODEL` (absolute path, lets a user A/B a downloaded file)
 *   2. the packaged `resources/models/<file>` of a bundled model
 *   3. the repo `assets/models/<file>`
 *
 * A candidate must exist and be larger than MIN_MODEL_BYTES: a truncated
 * download or a Git LFS pointer would otherwise blow up inside ONNX with an
 * unhelpful error.
 */

const fs = require('fs')
const path = require('path')

const MIN_MODEL_BYTES = 1024 * 1024

/**
 * Bundled / optional weights.
 *
 * `optional: true` means "we know this model, but we do not ship it": the file
 * has to be dropped into `assets/models/` (see `npm run cutout:model-hint`).
 * Sizes are the published file sizes, used only for a sanity warning.
 *
 * The four optional entries were evaluated on 2026-10-23 and deliberately not
 * bundled——reasons per entry in `M29-NOTES.md` §3: the network to the model
 * hubs is unavailable here, and ISNet / BiRefNet-lite blow the +30MB budget.
 */
const MODELS = [
  {
    id: 'u2net-human',
    file: 'u2net_human_seg.onnx',
    bytes: 44_320_000,
    input: 320,
    license: 'Apache-2.0 (U^2-Net, Xuebin Qin et al.)',
    note: 'bundled default：人像分割，CPU 约 600ms（1200px 输入）',
  },
  {
    id: 'u2netp-human',
    file: 'u2netp_human_seg.onnx',
    bytes: 4_700_000,
    input: 320,
    license: 'Apache-2.0',
    optional: true,
    note: 'u2netp 轻量版：体积 1/9，边缘更糊；适合“快而我不要发丝”的场景',
  },
  {
    id: 'isnet-general',
    file: 'isnet-general-use.onnx',
    bytes: 176_000_000,
    input: 1024,
    license: 'MIT (DIS, isnet-general-use)',
    optional: true,
    note: '通用前景，发丝更好，但 176MB 远超 +30MB 预算',
  },
  {
    id: 'birefnet-lite',
    file: 'birefnet-lite.onnx',
    bytes: 224_000_000,
    input: 1024,
    license: 'MIT (BiRefNet)',
    optional: true,
    note: '发丝最好，224MB + 每张 ~1.5s CPU，同样超预算',
  },
]

const DEFAULT_MODEL_ID = 'u2net-human'

function byId(id) {
  return MODELS.find((m) => m.id === id) || null
}

/**
 * Candidate paths for a model, most specific first.
 * @param {object} opts
 * @param {string} [opts.env]        absolute path override
 * @param {string} [opts.resourcesPath] Electron `process.resourcesPath`
 * @param {string} [opts.appDir]     repo/app root (defaults to `..` of lib)
 * @param {string} [opts.id]         model id, default u2net-human
 */
function candidates(opts = {}) {
  const model = byId(opts.id || DEFAULT_MODEL_ID)
  const file = model ? model.file : String(opts.id || DEFAULT_MODEL_ID) + '.onnx'
  const list = []
  if (opts.env) list.push(opts.env)
  if (opts.resourcesPath) list.push(path.join(opts.resourcesPath, 'models', file))
  const appDir = opts.appDir || path.join(__dirname, '..')
  list.push(path.join(appDir, 'assets', 'models', file))
  return list
}

/**
 * Resolve the first usable candidate.
 * @returns {{id: string, path: string, bytes: number, bundled: boolean}|null}
 */
function resolve(opts = {}) {
  const id = opts.id || DEFAULT_MODEL_ID
  const exists = typeof opts.exists === 'function' ? opts.exists : (p) => fs.existsSync(p)
  const sizeOf = typeof opts.size === 'function'
    ? opts.size
    : (p) => { try { return fs.statSync(p).size } catch (err) { return 0 } }
  const min = Number.isFinite(opts.minBytes) ? opts.minBytes : MIN_MODEL_BYTES
  for (const candidate of candidates({ env: opts.env, resourcesPath: opts.resourcesPath, appDir: opts.appDir, id })) {
    let bytes = 0
    try { bytes = sizeOf(candidate) } catch (err) { bytes = 0 }
    if (exists(candidate) && bytes >= min) {
      return { id, path: candidate, bytes, bundled: candidate === candidates({ appDir: opts.appDir, id }).slice(-1)[0] }
    }
  }
  return null
}

/** Optional models that are not on disk, for the CLI hint. */
function missingOptional(opts = {}) {
  const appDir = opts.appDir || path.join(__dirname, '..')
  const exists = typeof opts.exists === 'function' ? opts.exists : (p) => fs.existsSync(p)
  return MODELS.filter((m) => m.optional).filter((m) => !exists(path.join(appDir, 'assets', 'models', m.file)))
}

module.exports = { MODELS, DEFAULT_MODEL_ID, MIN_MODEL_BYTES, byId, candidates, resolve, missingOptional }