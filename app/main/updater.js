'use strict';
/**
 * 更新检查的主进程侧：取 feed、按节流决定要不要提示、把结果交给界面。
 *
 * 刻意没有引入 electron-updater：静默下载安装必须基于**已签名**的产物，
 * 而现在（0.6.8）还没签名。所以这里只做到“知道有新版本 + 点我去下载”，
 * `install` 分支留给签名到位后接 electron-updater（接口已按 kind 预留）。
 */

const { decideUpdate, formatUpdateMessage } = require('../../lib/update-check');

const DEFAULT_FEED = 'https://raw.githubusercontent.com/liuhaolh6/desk-pet/main/update.json';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * @param {object} deps
 * @param {string} deps.version            当前版本（app.getVersion()）
 * @param {() => object} deps.getSettings  读 settings
 * @param {(patch: object) => void} deps.patchSettings 写 settings（update.*）
 * @param {() => boolean} [deps.isPackaged]
 * @param {(url: string) => void} [deps.openExternal]
 * @param {(msg: string) => void} [deps.notify]        有新版时的用户可见提示
 * @param {(msg: string) => void} [deps.log]
 * @param {typeof fetch} [deps.fetchImpl]
 * @param {number} [deps.now]
 */
function createUpdater(deps) {
  const d = deps || {};
  const log = d.log || (() => {});
  const getSettings = d.getSettings || (() => ({}));
  const patchSettings = d.patchSettings || (() => {});
  const fetchImpl = d.fetchImpl || (typeof fetch === 'function' ? fetch : null);
  const now = d.now || (() => Date.now());

  const state = { checking: false, lastError: '', lastResult: null };

  function updateCfg() {
    const s = getSettings() || {};
    return Object.assign({ feedUrl: DEFAULT_FEED, checkOnBoot: true, installUpdates: false }, s.update || {});
  }

  function feedUrl() {
    const fromEnv = process.env.DESKPET_UPDATE_URL;
    const cfg = updateCfg();
    return String(fromEnv || cfg.feedUrl || '').trim();
  }

  async function fetchFeed(url) {
    if (!fetchImpl) throw new Error('当前环境没有 fetch');
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 8000) : null;
    try {
      const res = await fetchImpl(url, controller ? { signal: controller.signal } : undefined);
      if (!res || !res.ok) throw new Error(`HTTP ${res ? res.status : '??'}`);
      return await res.json();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * @param {{force?: boolean}} [opts]
   * @returns {Promise<{kind:string, version?:string, url?:string, notes?:string, reason?:string}>}
   */
  async function check(opts) {
    const force = !!(opts && opts.force);
    if (state.checking) return { kind: 'none', reason: 'checking' };
    const cfg = updateCfg();
    const url = feedUrl();
    if (!url) return { kind: 'none', reason: 'no-feed' };
    const last = Number(cfg.lastCheckAt) || 0;
    if (!force && last && now() - last < CHECK_INTERVAL_MS) {
      return { kind: 'none', reason: 'throttled' };
    }

    state.checking = true;
    try {
      const feed = await fetchFeed(url);
      const decision = decideUpdate({
        current: d.version,
        feed,
        allowInstall: !!cfg.installUpdates && !!d.isPackaged && d.isPackaged(),
        skippedVersion: cfg.skippedVersion || ''
      });
      patchSettings({ update: { lastCheckAt: now(), lastVersion: decision.version || cfg.lastVersion || '' } });
      state.lastError = '';
      state.lastResult = decision;
      log(`update check: ${decision.kind}${decision.reason ? ' ' + decision.reason : ''} (feed ${url})`);
      return decision;
    } catch (err) {
      state.lastError = String((err && err.message) || err);
      patchSettings({ update: { lastCheckAt: now() } });
      log(`update check failed: ${state.lastError}`);
      return { kind: 'none', reason: 'error', error: state.lastError };
    } finally {
      state.checking = false;
    }
  }

  /** 启动后延迟检查一次（不阻塞启动）。 */
  function checkOnBoot(delayMs) {
    const cfg = updateCfg();
    if (!cfg.checkOnBoot) return Promise.resolve({ kind: 'none', reason: 'disabled' });
    const delay = Number.isFinite(delayMs) ? delayMs : 8000;
    return new Promise((resolve) => {
      setTimeout(() => {
        check().then((decision) => {
          if (decision.kind !== 'none' && typeof d.notify === 'function') {
            d.notify(formatUpdateMessage(decision, d.version));
          }
          resolve(decision);
        }, (err) => resolve({ kind: 'none', reason: 'error', error: String(err && err.message) }));
      }, delay).unref?.();
    });
  }

  /** 打开下载页（“去下载”按钮）。 */
  function openDownload(url) {
    const target = String(url || '');
    if (!/^https:\/\//.test(target)) return false;
    if (typeof d.openExternal !== 'function') return false;
    d.openExternal(target);
    return true;
  }

  function status() {
    const cfg = updateCfg();
    return {
      version: d.version,
      feedUrl: feedUrl(),
      checkOnBoot: !!cfg.checkOnBoot,
      installUpdates: !!cfg.installUpdates,
      lastCheckAt: Number(cfg.lastCheckAt) || 0,
      lastVersion: String(cfg.lastVersion || ''),
      lastError: state.lastError,
      lastResult: state.lastResult
    };
  }

  return { check, checkOnBoot, openDownload, status };
}

module.exports = { createUpdater, DEFAULT_FEED, CHECK_INTERVAL_MS };