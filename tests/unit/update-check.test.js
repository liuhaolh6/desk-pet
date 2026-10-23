'use strict';
// P2-3：更新检查的纯逻辑。这里不联网，只测“比较版本 + 要不要提示”。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseVersion, compareVersions, decideUpdate, formatUpdateMessage } = require('../../lib/update-check');

test('parseVersion：接受 v 前缀与预发布，拒收垃圾', () => {
  assert.deepEqual(parseVersion('1.2.3'), { major: 1, minor: 2, patch: 3, pre: '' });
  assert.equal(parseVersion('v0.6.8').patch, 8);
  assert.equal(parseVersion('1.0.0-beta.1').pre, 'beta.1');
  assert.equal(parseVersion('1.2'), null);
  assert.equal(parseVersion('abc'), null);
  assert.equal(parseVersion(''), null);
});

test('compareVersions：主次补位比较', () => {
  assert.equal(compareVersions('0.6.8', '0.6.7'), 1);
  assert.equal(compareVersions('0.6.7', '0.6.8'), -1);
  assert.equal(compareVersions('0.6.8', '0.6.8'), 0);
  assert.equal(compareVersions('0.10.0', '0.9.9'), 1, '两位数不能按字符串比');
  assert.equal(compareVersions('v1.0.0', '1.0.0'), 0, 'v 前缀不影响');
  assert.equal(compareVersions('bad', '0.6.8'), null);
});

test('compareVersions：正式版高于同号预发布', () => {
  assert.equal(compareVersions('1.0.0', '1.0.0-beta.1'), 1);
  assert.equal(compareVersions('1.0.0-beta.1', '1.0.0'), -1);
  assert.equal(compareVersions('1.0.0-beta.2', '1.0.0-beta.1'), 1);
});

test('decideUpdate：有新版本 → available（默认不静默装）', () => {
  const d = decideUpdate({ current: '0.6.8', feed: { version: '0.6.9', url: 'https://example.com/a.exe', notes: '修了 bug' } });
  assert.equal(d.kind, 'available');
  assert.equal(d.version, '0.6.9');
  assert.equal(d.url, 'https://example.com/a.exe');
  assert.equal(d.notes, '修了 bug');
});

test('decideUpdate：allowInstall 时才给 install', () => {
  const feed = { version: '0.7.0', url: 'https://example.com/a.exe' };
  assert.equal(decideUpdate({ current: '0.6.8', feed, allowInstall: false }).kind, 'available');
  assert.equal(decideUpdate({ current: '0.6.8', feed, allowInstall: true }).kind, 'install');
});

test('decideUpdate：同版本/旧版本不打扰', () => {
  assert.equal(decideUpdate({ current: '0.6.8', feed: { version: '0.6.8', url: 'u' } }).reason, 'up-to-date');
  assert.equal(decideUpdate({ current: '0.6.8', feed: { version: '0.6.7', url: 'u' } }).reason, 'up-to-date');
});

test('decideUpdate：跳过过的版本不再提示', () => {
  const d = decideUpdate({ current: '0.6.8', feed: { version: '0.6.9', url: 'u' }, skippedVersion: '0.6.9' });
  assert.equal(d.kind, 'none');
  assert.equal(d.reason, 'skipped');
  // 但更新的版本要照常提示
  const e = decideUpdate({ current: '0.6.8', feed: { version: '0.7.0', url: 'u' }, skippedVersion: '0.6.9' });
  assert.equal(e.kind, 'available');
});

test('decideUpdate：feed 缺字段或格式不对都不抛', () => {
  assert.equal(decideUpdate({ current: '0.6.8', feed: {} }).reason, 'empty-feed');
  assert.equal(decideUpdate({ current: '0.6.8', feed: { version: 'x.y.z', url: 'u' } }).reason, 'bad-feed');
  assert.equal(decideUpdate({ current: 'nope', feed: { version: '0.6.9', url: 'u' } }).reason, 'bad-current');
  assert.equal(decideUpdate({ current: '0.6.8', feed: { version: '0.6.9' } }).reason, 'no-url');
  assert.equal(decideUpdate({}).reason, 'bad-current');
  assert.equal(decideUpdate().reason, 'bad-current');
});

test('formatUpdateMessage：只在新版时说话，措辞随是否可安装变化', () => {
  assert.equal(formatUpdateMessage({ kind: 'none' }, '0.6.8'), '');
  assert.equal(formatUpdateMessage(null, '0.6.8'), '');
  const avail = formatUpdateMessage({ kind: 'available', version: '0.6.9' }, '0.6.8');
  assert.match(avail, /0\.6\.9/);
  assert.match(avail, /下载/);
  const install = formatUpdateMessage({ kind: 'install', version: '0.6.9' }, '0.6.8');
  assert.match(install, /装/);
});

test('createUpdater：无 feed 时安静返回，不联网', async () => {
  const { createUpdater } = require('../../app/main/updater');
  const up = createUpdater({
    version: '0.6.8',
    getSettings: () => ({ update: { feedUrl: '' } }),
    patchSettings: () => {},
    fetchImpl: () => { throw new Error('不该联网'); }
  });
  const d = await up.check({ force: true });
  assert.equal(d.kind, 'none');
  assert.equal(d.reason, 'no-feed');
});

test('createUpdater：24h 内第二次检查被节流', async () => {
  const { createUpdater } = require('../../app/main/updater');
  let calls = 0;
  const cfg = { update: { feedUrl: 'https://example.com/update.json', lastCheckAt: 0, checkOnBoot: true } };
  const up = createUpdater({
    version: '0.6.8',
    getSettings: () => cfg,
    patchSettings: (patch) => { Object.assign(cfg.update, (patch || {}).update || {}); },
    fetchImpl: async () => {
      calls++;
      return { ok: true, status: 200, json: async () => ({ version: '0.6.9', url: 'https://example.com/a.exe' }) };
    },
    now: () => 1_000_000
  });
  const first = await up.check({ force: true });
  assert.equal(first.kind, 'available');
  const second = await up.check();
  assert.equal(second.reason, 'throttled');
  assert.equal(calls, 1, '节流生效后不再请求');
});

test('createUpdater：网络/HTTP 失败降级成 reason=error，不抛', async () => {
  const { createUpdater } = require('../../app/main/updater');
  const up = createUpdater({
    version: '0.6.8',
    getSettings: () => ({ update: { feedUrl: 'https://example.com/update.json' } }),
    patchSettings: () => {},
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) })
  });
  const d = await up.check({ force: true });
  assert.equal(d.kind, 'none');
  assert.equal(d.reason, 'error');
  assert.match(d.error, /503/);
});

test('createUpdater：openDownload 只放行 https', () => {
  const { createUpdater } = require('../../app/main/updater');
  const opened = [];
  const up = createUpdater({ version: '0.6.8', getSettings: () => ({}), patchSettings: () => {}, openExternal: (u) => opened.push(u) });
  assert.equal(up.openDownload('http://evil.com/a.exe'), false);
  assert.equal(up.openDownload('file:///C:/a.exe'), false);
  assert.equal(up.openDownload('https://github.com/x/y/releases'), true);
  assert.deepEqual(opened, ['https://github.com/x/y/releases']);
});