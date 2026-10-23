'use strict';
/**
 * 更新检查的纯逻辑（零依赖、可在 node:test 里直接跑）。
 *
 * 只做三件事：比较版本号、决定“要不要提示”、把提示文案拼出来。
 * 真正的网络请求与“去下载”按钮在 app/main/updater.js 里，方便以后换成 electron-updater。
 */

/** 'a.b.c[-pre]' → 对象；非法输入返回 null。 */
function parseVersion(value) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+]([0-9A-Za-z.-]+))?$/.exec(String(value || '').trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] || '' };
}

/** 返回 -1 / 0 / 1；任一侧非法时返回 null（调用方当作“无法比较”处理）。 */
function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return null;
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] > right[key] ? 1 : -1;
  }
  // 正式版 > 预发布版（1.0.0 > 1.0.0-beta.1）
  if (left.pre === right.pre) return 0;
  if (!left.pre) return 1;
  if (!right.pre) return -1;
  return left.pre > right.pre ? 1 : -1;
}

/**
 * 决定这次检查的结果。
 * @param {object} opts
 * @param {string} opts.current         当前版本
 * @param {object} opts.feed            { version, url, notes? }
 * @param {boolean} [opts.allowInstall] 是否允许“下载并安装”（只有签名发布才打开）
 * @param {string} [opts.skippedVersion] 用户点过“跳过这个版本”的版本号
 * @returns {{kind:'none'|'available'|'install', version?:string, url?:string, notes?:string, reason?:string}}
 */
function decideUpdate(opts) {
  const o = opts || {};
  const current = String(o.current || '');
  const feed = o.feed || {};
  if (!parseVersion(current)) return { kind: 'none', reason: 'bad-current' };
  if (!feed.version) return { kind: 'none', reason: 'empty-feed' };
  if (!parseVersion(feed.version)) return { kind: 'none', reason: 'bad-feed' };
  if (compareVersions(feed.version, current) !== 1) return { kind: 'none', reason: 'up-to-date' };
  if (o.skippedVersion && compareVersions(feed.version, o.skippedVersion) === 0) {
    return { kind: 'none', reason: 'skipped' };
  }
  if (!feed.url) return { kind: 'none', reason: 'no-url' };
  const base = { version: String(feed.version), url: String(feed.url) };
  if (feed.notes) base.notes = String(feed.notes);
  if (o.allowInstall) return Object.assign({ kind: 'install' }, base);
  return Object.assign({ kind: 'available' }, base);
}

/** 「有新版」的一句话，给气泡/通知用；没有可说的就返回空串。 */
function formatUpdateMessage(decision, current, t) {
  if (!decision || decision.kind === 'none') return ''
  const tr = typeof t === 'function' ? t : (k) => k
  const tail = tr(decision.kind === 'install' ? 'update.willInstall' : 'update.goDownload')
  return tr('update.newVersion', { version: decision.version, current, tail })
}
module.exports = { parseVersion, compareVersions, decideUpdate, formatUpdateMessage };