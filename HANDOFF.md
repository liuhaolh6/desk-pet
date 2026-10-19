# 交接文档（HANDOFF）

> 给下一个对话的我自己 / 协作者：读完这份就能接着干，不用重新摸索。

## 1. 项目是什么

Windows **桌面宠物**应用（Electron），悬浮在桌面上。不是 DSH 插件。

- 仓库：<https://github.com/liuhaolh6/desk-pet>（public，main 分支）
- 本地目录：`D:\project\deskpet`
- 版本：`0.1.0`，已推送 2 个提交
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
| `npm test`（7 项，存储 / 角色 / 天气码） | ✅ |

## 3. 关键决策（别推翻，除非有理由）

1. **Electron 而不是 tkinter**：需要透明悬浮 + 好看的卡片 UI；本机 npm 可用，Electron 走 npmmirror 能下。
2. **窗口只包住宠物**：气泡靠临时加高窗口实现，避免全屏透明层吞掉桌面点击。
3. **渲染进程不碰文件**：角色图走自定义协议，落盘全在主进程。
4. **仓库不放个人照片**：默认角色是 `tools/make-default.py` 生成的占位图。
5. **数据目录可覆盖**：`DESKPET_DATA_DIR`，因为受限环境写不了 `%APPDATA%`。

## 4. 待办（按建议顺序）

| 里程碑 | 内容 | 备注 |
|---|---|---|
| **M6 打包** | electron-builder 出 portable exe，图标、版本信息、可选开机自启 | 需要下载 electron-builder 及 winCodeSign 等依赖，走 npmmirror |
| **M7 气泡编辑器** | 多行排版、逐模块样式、拖拽排序、模块库 | ✅ 已完成，见第 8 节 |
| **M8 音效库** | 自定义片段、音量、试听 | 当前只有内置「叮」 |
| **M9 多显示器** | 记住每块屏的位置、贴边吸附 | 现在位置是绝对坐标，换屏会被夹住 |
| 小改进 | 天气卡文案换行（现在「80% 湿度」可能断行）、托盘的「暂停提醒」开关 | 低优先 |

## 5. 已知坑（踩过的，别再踩）

1. **`%APPDATA%` 写入 EPERM**：在本机 DSH 会话里启动的子进程写不了 `%APPDATA%`，会导致单实例锁失败并退出。
   → 测试时加 `DESKPET_DATA_DIR=D:\project\deskpet\.userdata`；代码已做回退，正常桌面启动不受影响。
2. **不要调用 `app.getPath('userData')` 做探测**：在受限环境下会**原生崩溃**（不是抛异常）。当前代码用 `process.env.APPDATA` 拼路径。
3. **需要 `--no-sandbox`**：本机从 DSH 启动 Electron 时必须加，否则崩在启动；正常桌面双击不需要。
4. **Electron 二进制没自动下载**：`npm install` 只装壳，需在 `node_modules/electron` 里手动 `node install.js`，并设 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`。
5. **前端脚本顶部不能再加 `'use strict'`**：文件开头 `'use strict'` 紧跟 `(function(){...})()` 会被解析成调用字符串，整个渲染进程报 `"use strict" is not a function`。
6. **截图抓不到右下角的宠物窗口**：本机屏幕捕获对那个区域的分层窗口不生效（原因未查明，疑似覆盖层）。要验证渲染请用 `webContents.capturePage()`，或把宠物拖到屏幕左上再截。
7. **双击会被拆成两次单击**：已加 240ms 去抖，别再改回去。

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
```

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
| `tools/make-assets.py` | 生成 icon/tray/default |

## 8. 最近变更（M7 气泡模块化编辑器）

- 新增 `app/bubble-model.js`：卡片 → 行 → 模块的数据模型，纯函数、可被 Node 测试（`tools/smoke.js` 已覆盖 6 项）。
  模块类型：固定文字、随机语句、名字、天气（图标/城市/温度/描述/高低温/降水/湿度/更新时间/离线提示）、今日杯数、下次提醒、时间、日期。
- 新增 `app/editor.html/css/js`：气泡编辑器窗口——卡片页签、行/模块编辑、拖拽排序、字号/加粗/斜体/文字色/底色、模块库、实时预览、卡片顺序（即点击顺序）。
- `app/pet.js` 改为按 `settings.bubble.layout` 渲染；`app/pet.html` 引入模型脚本。
- 入口：托盘菜单 / 角色右键菜单「编辑气泡…」，或设置窗口里的「编辑气泡…」按钮。
- 窗口横向加宽 `WIN_PAD=54`，角色水平居中，气泡可见宽度变大（以前被 220px 窗口掐得很碎）。
- 新增 `DESKPET_OPEN_EDITOR=1` 便于调试时直接打开编辑器。

注意：气泡布局存在 `settings.bubble.layout`；不存则用默认布局；`normalizeLayout` 对损坏数据 fail-soft 回默认，不会让挂件白屏。

## 9. 新对话开场白（直接粘贴）

> 继续 `D:\project\deskpet` 的桌面宠物项目，先读 `HANDOFF.md` 和 `PLAN.md`，
> 然后做 M6：用 electron-builder 打出 portable exe（带图标、版本信息），
> 并验证双击能启动、托盘可用。已知坑见 HANDOFF 第 5 节。
