# 交接文档（HANDOFF）

> 给下一个对话的我自己 / 协作者：读完这份就能接着干，不用重新摸索。

## 1. 项目是什么

Windows **桌面宠物**应用（Electron），悬浮在桌面上。不是 DSH 插件。

- 仓库：<https://github.com/liuhaolh6/desk-pet>（public，main 分支）
- 本地目录：`D:\project\deskpet`
- 版本：`0.2.0`，已推送 7 个提交
- 早期那套「DSH 挂件版」实现已移出仓库，归档在 `D:\project\deskpet-dsh-plugin`（需要参考角色/气泡系统时可以翻）

## 2. 现在能用的功能（都真机验证过）

| 能力 | 状态 |
|---|---|
| 透明无边框窗口、始终置顶（可关）、跳过任务栏 | ✅ |
| 单击出卡：天气 → 喝水 → 温馨语句，再点收起 | ✅ |
| 气泡出现时窗口向上加高，收起缩回（不挡桌面点击） | ✅ |
| 双击开设置窗口；右键弹菜单；托盘菜单 | ✅ |
| 角色导入 / 切换 / 删除（自定义 `pet-role://` 协议） | ✅ |
| 天气：Open-Meteo、城市搜索、磁盘缓存、断网降级 | ✅ |
| 喝水：间隔提醒、今日杯数、免打扰、隐藏时系统通知 | ✅ |
| 设置：名字、大小、置顶、自启、模式、城市、刷新、间隔、气泡、音效 | ✅ |
| 气泡模块化编辑器 / 音效库（M7/M8） | ✅ |
| M6 打包：portable exe（图标 / 版本信息 / 便携数据目录） | ✅ 产物 `dist/DeskPet-0.2.0-portable.exe`；启动已验证，托盘对象已创建（图标未显示，见 §5.12） |
| `npm test`（19 项，存储 / 角色 / 天气码 / 气泡布局 / 音效） | ✅ |

## 3. 关键决策（别推翻，除非有理由）

1. **Electron 而不是 tkinter**：需要透明悬浮 + 好看的卡片 UI；本机 npm 可用，Electron 走 npmmirror 能下。
2. **窗口只包住宠物**：气泡靠临时加高窗口实现，避免全屏透明层吞掉桌面点击。
3. **渲染进程不碰文件**：角色图走自定义协议，落盘全在主进程。
4. **仓库不放个人照片**：默认角色是 `tools/make-default.py` 生成的占位图。
5. **数据目录可覆盖**：`DESKPET_DATA_DIR`，因为受限环境写不了 `%APPDATA%`。
6. **打包用 portable，不做安装器**：`electron-builder` 的 `portable` target，双击即用；数据优先写在 exe 同级 `desk-pet-data/`，整个文件夹可搬走。
7. **0.2.0 = M6 发布版本**：图标在 `build/icon.ico`，exe 版本信息由 `package.json` 的 `version` / `author` / `description` 生成。

## 4. 待办（按建议顺序）

| 里程碑 | 内容 | 备注 |
|---|---|---|
| **M6 打包** | electron-builder 出 portable exe，图标、版本信息、可选开机自启 | ✅ 已完成，产物 `dist/DeskPet-0.2.0-portable.exe`；记录见 `M6-PACKAGING.md` |
| **M7 气泡编辑器** | 多行排版、逐模块样式、拖拽排序、模块库 | ✅ 已完成，见第 8 节 |
| **M8 音效库** | 自定义片段、音量、试听 | ✅ 已完成，见第 9 节 |
| **M9 多显示器** | 记住每块屏的位置、贴边吸附 | ✅ 已完成，见第 10 节 |
| 小改进 | 天气卡文案换行（现在「80% 湿度」可能断行）、托盘的「暂停提醒」开关 | 低优先 |

## 5. 已知坑（踩过的，别再踩）

1. **`%APPDATA%` 写入 EPERM**：在本机 DSH 会话里启动的子进程写不了 `%APPDATA%`，会导致单实例锁失败并退出。
   → 测试时加 `DESKPET_DATA_DIR=D:\project\deskpet\.userdata`；代码已做回退，正常桌面启动不受影响。
2. **不要调用 `app.getPath('userData')` 做探测**：在受限环境下会**原生崩溃**（不是抛异常）。当前代码用 `process.env.APPDATA` 拼路径。
3. **需要 `--no-sandbox`**：本机从 DSH 启动 Electron 时必须加，否则崩在启动；正常桌面双击不需要。
4. **Electron 二进制没自动下载**：`npm install` 只装壳，需在 `node_modules/electron` 里手动 `node install.js`，并设 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`。
5. **前端脚本顶部不能再加 `'use strict'`**：文件开头 `'use strict'` 紧跟 `(function(){...})()` 会被解析成调用字符串，整个渲染进程报 `"use strict" is not a function`。
6. **截图抓不到右下角的宠物窗口**：本机屏幕捕获对那个区域的分层窗口不生效（原因未查明，疑似覆盖层）。要验证渲染请用 `webContents.capturePage()`，或把宠物拖到屏幕左上再截。
7. **打包版不带 `--no-sandbox` 会静默退出**（exit=-2147483645/0x80000003，连 app.log 都不写）：本机安全策略下 Chromium 沙箱起不来。
   双击/快捷方式必须带该参数（`tools/make-shortcut.ps1` 已默认带上）；开机自启也已在代码里带上。
8. **双击会被拆成两次单击**：已加 240ms 去抖，别再改回去。
8. **32 位 NSIS 编译大包会崩**：数据块超过约 16 MB 时 `makensis` 报
   `Internal compiler error #12345: error creating mmap the size of ...`。
   3.0.4.1 / 1.2.1（3.12）的 32 位编译器都会中招。本机改用 64 位 NSIS 编译器包装：
   `.tools/nsis-custom/makensis.cmd` + `ELECTRON_BUILDER_NSIS_DIR`，详见 `M6-PACKAGING.md` §3.1。
9. **未签名 exe 会被 SmartScreen / 安全软件拦**：双击出现「Windows 已保护你的电脑」；
   本机 Lenovo Anti-Virus（火绒引擎）还会把未签名进程写 `%LOCALAPPDATA%\Temp` 拦成 `ACCESS_DENIED`，
   NSIS portable 报 `Error writing temporary file. Make sure your temp folder is valid.`
   → 签名/加白名单；测试时把 `TEMP`/`TMP` 指到可写目录（如 `D:\project\deskpet\.tmp-runtime`），
   并用普通用户令牌启动（计划任务/Explorer）。
10. **`ELECTRON_RUN_AS_NODE=1`**：DSH 会话环境自带；直接启动打包/开发 Electron 会变成 Node 模式
    （`bad option: --no-sandbox`）。测试前 `Remove-Item Env:ELECTRON_RUN_AS_NODE` 或设空。
11. **从 DSH 前台启动 GUI 会挂住工具调用**：工具会等整棵进程树。用计划任务/WMI/Explorer 分离启动，
    不要在前台直接跑桌宠。
12. **托盘图标在本机不显示**：`Tray` 对象和菜单创建成功（日志 `tray created empty=false menu=...`），
    但 Windows 11 通知区和溢出区都看不到图标，`tray.getBounds()` 为 `0,0,0,0`。
    宠物窗口、右键菜单、设置窗口正常。疑似 Win11 26200 + 安全软件；待签名或干净机器复验，
    M6 的「托盘可用」只验证到对象/菜单创建。

## 6. 快速开始

```powershell
cd D:\project\deskpet
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
npm install
# 若 electron.exe 不存在（postinstall 被跳过）：
cd node_modules\electron; node install.js; cd ..\..

# 本机受限环境：
$env:DESKPET_DATA_DIR='D:\project\deskpet\.userdata'
.\node_modules\electron\dist\electron.exe . --no-sandbox

# 正常桌面：npm start
npm test

# 打包 portable（普通桌面环境）
npm run dist
# 本机（32 位 NSIS 限制）：见 M6-PACKAGING.md §3，用 64 位 NSIS 包装
```

- 打包：`npm run dist` → `dist/DeskPet-<version>-portable.exe`；本机绕坑见 `M6-PACKAGING.md`。

- 数据：`settings.json`、`roles.json`、`roles/*.png`、`weather-cache.json`
- 环境变量：`DESKPET_DATA_DIR`（数据目录）、`DESKPET_OPAQUE=1`（关透明，排查渲染）、`DESKPET_OPEN_SETTINGS=1`（启动即开设置）

## 7. 文件地图

| 路径 | 作用 |
|---|---|
| `app/main.js` | 窗口、托盘、IPC、天气调度、提醒定时器、启动日志（`app.log`） |
| `app/preload.js` | contextBridge 白名单 API（`window.deskPet`） |
| `app/pet.html/css/js` | 宠物窗口：精灵、气泡卡片、点击队列、拖拽 |
| `app/settings.html/css/js` | 设置窗口 |
| `lib/store.js` | 配置/角色/缓存的原子读写（可脱离 Electron 测试） |
| `lib/weather.js` | Open-Meteo 天气与城市搜索 |
| `tools/smoke.js` | `npm test` |
| `tools/make-assets.py` | 生成 icon/tray/ico/default |
| `build/icon.ico` | Windows 多尺寸图标（make-assets.py 生成） |
| `M6-PACKAGING.md` | M6 portable 打包记录 / 验证 / 本机限制 |

## 8. 最近变更（M7 气泡模块化编辑器）

- 新增 `app/bubble-model.js`：卡片 → 行 → 模块的数据模型，纯函数、可被 Node 测试（`tools/smoke.js` 已覆盖 6 项）。
  模块类型：固定文字、随机语句、名字、天气（图标/城市/温度/描述/高低温/降水/湿度/更新时间/离线提示）、今日杯数、下次提醒、时间、日期。
- 新增 `app/editor.html/css/js`：气泡编辑器窗口——卡片页签、行/模块编辑、拖拽排序、字号/加粗/斜体/文字色/底色、模块库、实时预览、卡片顺序（即点击顺序）。
- `app/pet.js` 改为按 `settings.bubble.layout` 渲染；`app/pet.html` 引入模型脚本。
- 入口：托盘菜单 / 角色右键菜单「编辑气泡…」，或设置窗口里的「编辑气泡…」按钮。
- 窗口横向加宽 `WIN_PAD=54`，角色水平居中，气泡可见宽度变大（以前被 220px 窗口掐得很碎）。
- 新增 `DESKPET_OPEN_EDITOR=1` 便于调试时直接打开编辑器。

注意：气泡布局存在 `settings.bubble.layout`；不存则用默认布局；`normalizeLayout` 对损坏数据 fail-soft 回默认，不会让挂件白屏。

## 9. 最近变更（M8 音效库）

- 新增 `app/sound-model.js`：事件（click/bubble/water）× 片段（`preset:*` 内置合成 / `file:<id>` 导入）模型；
  `eventVolume()` 实现「单事件音量 null = 跟随总音量」，总开关或事件关闭则返回 0。
- 新增 `pet-sound://sound/<id>` 自定义协议与 `sounds:list/import/delete` IPC；片段落盘在 `<data>/sounds/<id>.<ext>`，索引 `sounds.json`。
- 设置窗口新增音效区：总开关/总音量 + 每事件一行（开关、片段下拉、音量、跟随、试听）+ 片段库导入/删除。
  删除被引用的片段时，主进程自动把引用回退到 `preset:ding`。
- 宠物侧：点击角色 / 气泡出现 / 喝水提醒三个时机分别发声，旧的固定 beep 已删除。
- `tools/smoke.js` 扩到 **19 项**（新增音效默认值、归一化边界、音量回退、片段标签、片段增删、深合并）。

注意：内置音色是 WebAudio 合成的，仓库不带音频二进制；真实发声无法在无音频设备的会话里自动验证，目前只验证了代码路径与控制台无报错。

## 10. 最近变更（M9 多显示器与吸附）

- 新增 `lib/placement.js`（纯函数，可测）：显示器归一化、归属判定（交集优先、中心距离兜底）、
  `clampPet`（夹到工作区）、`snapPet`（四边磁吸 + 阈值）、`resolveSaved`（启动还原）。
- 位置改为 `{ x, y, displayId }`；启动时优先按 displayId 还原，显示器不存在则按坐标重新归属，
  都找不到则夹回最近屏幕；日志会打 `position clamped to display=`。
- 拖动时实时吸附（`settings.snap.enabled/gap`，默认 18px，0 = 关闭），拖动结束后记录所属显示器。
- 监听 `display-added / display-removed / display-metrics-changed`，自动把宠物夹回可见区域。
- 设置窗口「外观」新增：贴边吸附开关 + 吸附距离。
- `tools/smoke.js` 扩到 **26 项**（新增 7 项：无位置默认、记住显示器、拔掉后重归属、离屏夹回、小于屏幕、四边吸附阈值、归属判定）。

验证：手动把 `position` 写成 `{x:5000,y:4000,displayId:"999"}` 启动，日志出现 `position clamped to display=...`，
窗口落在主屏右下角。

## 11. 桌面快捷方式（v0.3.0）

- 版本号升到 `0.3.0`（含 M7 气泡编辑器 / M8 音效库 / M9 多显示器），因为之前的 portable exe 停在 0.2.0。
- 新增 `npm run dist:dir`（electron-builder `dir` 目标）与 `npm run shortcut`（`tools/make-shortcut.ps1`）。
- 快捷方式指向 **解包版** `dist\win-unpacked\DeskPet.exe`，而不是 portable：
  portable 会解压到 `%TEMP%`，本机火绒会拦未签名进程写 TEMP（见第 5 节第 2 条）；
  解包版直接运行，避开这一步。
- 实际建成的快捷方式：`C:\Users\刘浩\Desktop\小芳桌宠.lnk`（图标取 exe 自身）。
- 打包版已验证启动：4 个进程、窗口可见置顶、托盘创建成功、菜单含「编辑气泡…」。

注意：未签名 exe 首次双击仍会碰到 SmartScreen（需“更多信息 → 仍要运行”）；可以从 `dist\win-unpacked` 直接重建快捷方式，不必重新打包。

## 12. 新对话开场白（直接粘贴）

> 继续 `D:\project\deskpet` 的桌面宠物项目，先读 `HANDOFF.md`、`PLAN.md` 和 `M6-PACKAGING.md`。
> M6 portable 打包、M7 气泡编辑器、M8 音效库都已完成；下一步做 M9（多显示器记忆与贴边吸附）。
> 已知坑见 HANDOFF 第 5 节。
