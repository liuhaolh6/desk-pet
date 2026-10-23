/**
 * 「不打扰全屏应用」（ROADMAP P1-7 的验收项之一）。
 *
 * Electron 没有「前台窗口是否全屏」的 API，而桌宠恰恰要为这件事闭嘴：
 * 有人全屏看片/打游戏/开会时，气泡弹出来是最讨嫌的。
 * 做法：前台窗口矩形覆盖它所在显示器时算全屏；每分钟最多问一次，结果缓存，
 * 只在真要说话前才问。任何失败都当成「不是全屏」——宁可多冒一句，也不能因为探测失败而永远不说话。
 */
'use strict'

const { execFile } = require('node:child_process')

const PS = [
  'Add-Type -TypeDefinition @"',
  'using System;using System.Runtime.InteropServices;',
  'public class FgProbe {',
  '  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
  '  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);',
  '  [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr h, uint f);',
  '  [DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr m, ref MI i);',
  '  public struct RECT { public int L, T, R, B; }',
  '  public struct MI { public int cbSize; public RECT mon; public RECT work; public uint flags; }',
  '}',
  '"@',
  '$h=[FgProbe]::GetForegroundWindow(); if($h -eq [IntPtr]::Zero){Write-Output 0; exit}',
  '$r=New-Object FgProbe+RECT; [void][FgProbe]::GetWindowRect($h,[ref]$r)',
  '$m=[FgProbe]::MonitorFromWindow($h,2); $mi=New-Object FgProbe+MI; $mi.cbSize=40',
  '[void][FgProbe]::GetMonitorInfo($m,[ref]$mi)',
  '$w=$r.R-$r.L; $h2=$r.B-$r.T; $mw=$mi.mon.R-$mi.mon.L; $mh=$mi.mon.B-$mi.mon.T',
  'if($w -ge $mw-2 -and $h2 -ge $mh-2 -and $mw -gt 0){Write-Output 1}else{Write-Output 0}',
].join('\n')

const TTL_MS = 60 * 1000

/** @returns {Promise<boolean>} */
function isForegroundFullscreen(options) {
  const opts = options || {}
  const now = Number(opts.now) || Date.now()
  const cache = opts.cache
  if (cache && now - (cache.at || 0) < TTL_MS) return Promise.resolve(cache.value === true)
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', PS],
      { timeout: 4000, windowsHide: true },
      (err, stdout) => {
        const value = !err && String(stdout).trim().endsWith('1')
        if (cache) { cache.at = now; cache.value = value }
        resolve(value)
      }
    )
  })
}

module.exports = { isForegroundFullscreen, TTL_MS, PS }