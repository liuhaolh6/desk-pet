# 交接文档（HANDOFF）

> 版本 `0.6.12` · 最后更新 2026-10-24 · 给下一个接手的人（或下一个对话的我）。
> 目标：读完这一份就能**安全地改代码、跑验证、出包**，不必重新摸索。
> 想先知道"这东西现在还差在哪、下一步做什么"，看 [`ROADMAP.md`](ROADMAP.md)。

---

## 0. 30 秒速览

| 项 | 值 |
|---|---|
| 是什么 | Windows x64 桌面宠物（Electron 44 + 离线 ONNX 人像抠图），悬浮在桌面上，点击看天气 / 喝水 / 温馨话 |
| 本地目录 | `D:\project\deskpet` |
| 仓库 | `ssh://git@ssh.github.com:443/liuhaolh6/desk-pet.git`，分支 `main`，**当前是私有仓库** |
| 版本 | 代码 = 已出包 = `0.6.10`（主题包 P2-7 完成、0.6.9 的更新提示与隐私页一并带上）：`dist\DeskPet-0.6.10-setup.exe`（165,605,153 B ≈ 157.9 MiB，安装器，未签名，SHA-256 `a92bfa52…cf8a5d2`）与 `dist\DeskPet-0.6.10-portable.exe`（153,927,095 B ≈ 146.8 MiB，便携版，SHA-256 `228227a2…b018678`）；tag `v0.6.10` |
| 最近提交 | 0.6.12 = 本提交（P2-4 阶段二收尾：悬停菜单搬进 overlay 窗口、桌宠窗口不再被菜单撑大、Win11 透明窗框差自标定；见 `M32-NOTES.md`）；0.6.11 = 菜单临时长高窗口 + 气泡随内容放大 + 喝水按钮可点；0.6.10 = P2-7 主题包（打包补上 `locales/**` `themes/**` 两条 files 规则）；0.6.9 = P2-3 更新提示 + P2-8 隐私文档；`dba1115` P2-1 安装器 · `58f94b4` P2-2 签名准备；P1 全部落地：`e2952ca` P1-9 e2e 入库 · `6c7a4fb` P1-8 真机 a11y · `94358ae` P1-7 主动说话 · `cdb3531` P1-6 天气增强 · `469d343` P1-5 喝水记录 · `b106382` P1-4 设置可用性 · `6342b75` P1-3 单测 · `01de0b2` P1-2 状态机 · `80332c7` P1-1 完成；0.6.6 收尾 = `e01c1cb`/`12176d2`/`5be8c4d`；再往前 `adbe033` 0.6.5 首次引导 |
| 当前状态 | 功能闭环、可日常使用；**未签名**、未上架、仅 Windows x64 |
| 一条命令自检 | `npm run check && npm test && node tools/check-a11y.js`（`npm test` = smoke + `npm run unit`）；带窗口的再加 `npm run test:e2e` |
| 自动化基线 | smoke **67 项** · unit **182 例** · check-a11y **95 项** · check-i18n **30 文件 / 0 处** · a11y-audit **86 项 / 0 失败** · a11y-keyboard **6 项** · a11y-tree **4 窗口 / 0 无名** · e2e **4 用例**，全部通过 |
| 最新产物 | 安装器 `dist/DeskPet-0.6.8-setup.exe` 165,558,348 字节，SHA-256 `2d5dfe47eb809af9e762b41b367d53da83c21d5634cfa31c9bfb0a82c9fff89c`；便携版 `dist/DeskPet-0.6.8-portable.exe` 153,882,861 字节，SHA-256 `668ba228f9f6c700a93fd1c48c0bfcabdefa910b21a74291c3c89ba62e777a16` |

**能做什么**：换形象（照片抠图 / 导入 PNG）、点击看天气和喝水进度、按时提醒喝水、24 条内置温柔提示语、
气泡内容自己排版（28 种模块）、音效可换、多显示器记忆与贴边吸附、托盘、开机自启、便携运行（数据跟着文件夹走）。

**明确不做**：云同步 / 账号、上传任何照片或使用数据、广告、遥测。照片只在本机处理。

---

## 1. 边界：是什么、不是什么

- **是**：一个单机、离线优先的 Windows 桌面小组件，全部数据落在本地 JSON/PNG。
- **不是**：安装版商业软件（只有 portable）、不是 DSH 插件（早期那套实现已归档到 `D:\project\deskpet-dsh-plugin`）、
  不是跨平台产品（尚未适配 macOS/Linux）、不是"AI 陪聊"（没有对话模型，只有固定文案池）。

---

## 2. 能力现状

图例：✅ 可用并验证过 · ⚠️ 可用但有已知限制 · ⬜ 未做

| 分组 | 能力 | 状态 | 备注 |
|---|---|---|---|
| 桌宠本体 | 透明无边框、置顶可关、跳过任务栏、拖动、贴边吸附 | ✅ | 拖动 4px 阈值，双击去抖 240ms |
| 桌宠本体 | 空白区域鼠标穿透（含预留气泡带） | ✅ | 主进程 50ms 轮询命中区，见 §4.1 |
| 桌宠本体 | 按压/悬停/拖动倾斜动效、贴边镜像 | ✅ | 只用 `transform`，禁止动画 `filter` |
| 气泡 | 点击桌宠循环出卡（天气 → 喝水 → 随机话） | ✅ | 队列可改，`bubble.queue` |
| 气泡 | 点气泡收起、20 秒自动收起、冷却 30 分钟 | ✅ | `bubble.autoHideSeconds` / `cooldownMinutes` |
| 气泡 | 固定 1026:700 云朵框、文字同比缩放不溢出 | ✅ | 见 §4.2 |
| 气泡 | 28 种模块、三档预设、分组选单、折叠样式 | ✅ | 编辑器已去掉拖拽与收藏 |
| 天气 | Open-Meteo 当前/今日/明天/未来 6 小时/日出日落/紫外线/风/体感 | ✅ | 单一数据源，无预警、无自动定位 |
| 天气 | 城市搜索、磁盘缓存、断网降级、贴心提醒 | ✅ | 搜索需要联网；离线时显示缓存时间 |
| 喝水 | 间隔提醒、今日杯数、安静时段、隐藏时系统通知 | ✅ | 无历史记录/周报/导出 |
| 角色 | 内置照片形象、导入 PNG、多角色切换/删除 | ✅ | 角色图走 `pet-role://` 协议 |
| 角色 | 照片抠图（离线 U2Net 44MB，蒙版/擦除/旋转/翻转/回退） | ⚠️ | CPU 推理 0.9–1.3s；复杂背景/发丝仍可能残留 |
| 设置 | 7 个分类面板、即时保存、角色图库、音效库 | ✅ | 无"恢复默认/撤销" |
| 系统集成 | 托盘菜单、开机自启、单实例 | ⚠️ | 本机 `D:\project` 子树里的 exe 一律注册不上托盘（`Shell_NotifyIcon` 返回 `ERROR_ACCESS_DENIED(5)`，换到 `D:\`、`%TEMP%`、`D:\DeskPetTest` 就正常）→ 不是产品缺陷（§6.1 5.10）；`Ctrl+Alt+P` + 悬浮菜单兜底仍在 |
| 打包 | portable exe + NSIS 安装器（可选目录、桌面/开始菜单快捷方式、卸载）、图标/版本信息、便携数据目录 | ✅ | 未签名；无自动更新；安装器仅当前用户（无需管理员） |
| 无障碍 | 4 窗口 + 7 面板 + 编辑器全标签页的自动化审计 | ✅ | 屏幕阅读器与真实高对比度主题**未验证** |

---

## 3. 架构与代码地图

### 3.1 进程与数据流

```
main (Node)  ── BrowserWindow ×4 ──►  pet.html   桌宠 + 气泡 + 悬停菜单
   │                                ├ settings.html 设置（7 面板）
   │                                ├ cutout.html   抠图窗口
   │                                └ editor.html   气泡布置
   │
   ├─ utilityProcess cutout-worker ──► ONNX Runtime（推理 + 合成 + PNG 编码）
   ├─ store（lib/store.js）──► <数据目录>/{settings,roles,weather-cache,sounds}.json + roles/*.png + sounds/*
   ├─ weather（lib/weather.js）──► api.open-meteo.com / geocoding-api.open-meteo.com / air-quality-api.open-meteo.com
   └─ 定时器：喝水提醒、天气刷新、隐藏时通知
```

渲染层**不碰文件系统**：所有落盘、协议（`pet-role://`、`pet-sound://`）都在主进程；
`app/preload.js` 用 `contextBridge` 暴露白名单 API（`window.deskPet`）。

主进程自 0.7.0 起分模块（P1-1）：`app/main/` 下 `log.js`（呼吸日志）、`geometry.js`（窗口尺寸纯函数）、
`window-layout.js`（命中/预留/多屏）、`tray.js`（托盘 + `Ctrl+Alt+P`）、`diagnostics.js`（脱敏导出）、
`ipc.js`（全部 `ipcMain` 通道）、`weather-pump.js`、`reminder.js`、`water-ipc.js`（喝水四通道）、`cutout-service.js`（抠图子进程与回退）、
`windows.js`（五个窗口的创建/单例/设置副效应）、`catalog.js`（角色与声音目录 + 自定义协议）、
`boot.js`（选数据目录 + 单实例锁）；`app/main.js` 只负责装配，**226 行**。
模块之间靠**注入回调**连接（不 `require` 主文件），所以都能单独 `require` 或 mock。

与拆模块同批（P1-2）新增 **`app/window-state.js`**：`idle / bubble / menu / dragging / cutout` 五态机，
主进程持有唯一实例 `winState`；气泡、菜单、拖动、抠图四类事件全部过转移表，
非法事件只计数不抛（`app:status` 的 `window.illegal` 即此）。以后改窗口行为先看这张表。

### 3.2 关键文件

| 路径 | 行数 | 作用 |
|---|---|---|
| `app/main.js` | 226 | 主进程入口：只做装配（P1-1 阶段 1/2/3/4 已拆出 13 个模块） |
| `app/main/windows.js`（新） | 297 | 五窗口工厂：桌宠/设置/编辑器/抠图/引导 + 单例 + 设置副效应 |
| `app/main/catalog.js`（新） | 106 | 角色与声音目录、`pet-role://`与`pet-sound://`协议、设置/角色广播 |
| `app/main/boot.js`（新） | 81 | 数据目录候选与可写探测、日志落盘、单实例锁（不碰 `userData`） |
| `app/main/ipc.js`（新） | 495 | 全部 `ipcMain` 通道（state/app/settings/roles/sounds/weather/cutout/pet/onboard），依赖全部注入；喝水四通道在 `water-ipc.js`，overlay 窗口通道在 `overlay-ipc.js` |
| `app/main/overlay-menu.js`（新，0.6.12） | 198 | 悬停菜单的窗口侧：按渲染层报的面板尺寸与锚点算窗口矩形（上方优先、放不下翻下方、夹在工作区），`open/close/place/follow/setSize`，并自标定 Win11 透明窗框差（整窗比内容区 +6×+7px） |
| `app/main/overlay-ipc.js`（新，0.6.12） | 60 | overlay 窗口的 IPC 面：`bubble:render|hide`、`overlay:grow|click|action`、`overlay:menu-size|menu-action|menu-close`，把菜单动作转发回桌宠窗口 |
| `app/main/overlay.js`（新） | 266 | 气泡独立窗口：懒创建、贴宠物上方/翻下方、跟随、`showInactive` 不抢焦点；按「气泡 || 菜单」决定显隐；`registerOverlayIpc` 已拆到 `overlay-ipc.js` |
| `app/overlay.html` / `overlay.css` / `overlay.js`（新） | 34 / 272 / 274 | 气泡 + 悬停菜单渲染层：气泡只画行与按钮，超框收缩到 0.6 再截断；菜单复用 `#petMenu` 五项 `data-action`，量尺寸上报、点项/点空白/Esc 转发 | 全部 `ipcMain` 通道（state/app/settings/roles/sounds/weather/cutout/pet/onboard），依赖全部注入；喝水四通道在 `water-ipc.js` |
| `app/main/weather-pump.js`（新） | 81 | 天气取数/缓存回退/定时刷新，时钟可注入；`refresh/schedule/current` |
| `app/main/reminder.js`（新） | 69 | 喝水提醒：勿扰/勿扰时段/`snoozeUntil` 延后/间隔/10 分钟限流，`tick()` 返回本次判定 |
| `app/main/cutout-service.js`（新） | 232 | 抠图：解码、输入令牌、utilityProcess、进程内回退、`cutout-trace.jsonl` |
| `app/main/window-layout.js`（新） | 223 | 窗口几何与命中：`hitTest` 纯函数 + `createWindowLayout()`；P2-4 阶段二起不再预留气泡 strip（见 M28-NOTES §5） |
| `app/window-state.js`（新） | 126 | 五态机：转移表 + `transition/can/is/reset` + 非法计数与历史；纯 Node，smoke 直接 require |
| `lib/update-check.js`（新） | 67 | 更新判断的纯函数：`compareVersions/isNewer/validUrl/decideUpdate`（`v` 前缀、预发布、24h 节流） |
| `app/main/updater.js`（新） | 106 | 更新提示：读 feed（`settings.update.feedUrl` 或默认 raw），24h 一次，气泡 + 设置各说一句；`openDownload` 只放行 `https:` |
| `app/main/privacy.js`（新） | 116 | 数据与隐私：`summary()` 现算各目录体积、`cleanup()` 只删日志/轨迹/Chromium 缓存（异步，设置与照片不碰） |
| `app/main/water-ipc.js`（新） | 75 | 喝水四个通道：记一杯（写 log）、「稍后 10 分钟」、「今日/本周统计」、导出 CSV |
| `lib/nudges.js`（新） | 86 | 主动说话的纯决策：`decide()`（久坐/深夜/久未互动/限流/勿扰）、`isNightHour`、`DEFAULTS` |
| `app/main/nudge-pump.js`（新） | 102 | 说话泵：每分钟驱动 `decide()`，同一个气泡出口，全屏时跳过并记日志；`probe()` 可注入时间与状态 |
| `lib/i18n.js`（新，P2-6） | 101 | 纯 Node 的多语言核心：`flatten/interpolate/createI18n/keyDiff/matchLocale`（不碰文件系统，可直接单测） |
| `app/main/i18n.js`（新，P2-6） | 95 | 主进程：`availableLocales` 读 `locales/`、`createMainI18n({requested,system})`、`registerI18nIpc`（`i18n:boot` 同步 / `i18n:info` / `i18n:dict`） |
| `app/i18n.js`（新，P2-6） | 104 | 渲染层：`create(dict,locale)` + `applyStatic(document,bridge)`（`data-i18n` / `-html` / `-title` / `-aria-label` / `-placeholder` / `-alt` + `documentElement.lang`），UMD |
| `locales/zh-CN.json` / `en-US.json`（新） | — | 语言包（嵌套 JSON，点号键 = 层级）；两份键名必须完全一致，检查器强制 |
| `lib/theme-zip.js`（新，P2-7） | 极简 zip 读写（stored/deflate、CRC32、id 净化），不引依赖 |
| `lib/theme.js`（新，P2-7） | 主题包校验（36 个白名单 CSS 变量、注入拒收、id 规则）与 `:root{}` 生成，纯函数 | 
| `app/main/theme.js`（新，P2-7） | 扫描 `themes/` 与数据目录下的用户主题，IPC `theme:list/current/set` |
| `app/theme-boot.js`（新，P2-7） | 渲染层把当前包的 CSS 写进 `<style id="theme-pack">`，六个页面都引入 |
| `lib/theme.js`（新，P2-7） | 主题包校验（36 个白名单 CSS 变量、注入拒收、id 规则）与 `:root{}` 生成，纯函数 |
| `app/main/theme.js`（新，P2-7） | 扫描 `themes/` 与数据目录下的用户主题，IPC `theme:list/current/set` |
| `app/theme-boot.js`（新，P2-7） | 渲染层把当前包的 CSS 写进 `<style id="theme-pack">`，六个页面都引入 |
| `tools/check-i18n.js`（新，P2-6） | 296 | 剥注释后数内联中文：键名对齐 / 空串 / 每文件不得高于基线（`--list` 看计数、`--update` 重写基线） |
| `app/main/fullscreen.js`（新） | 54 | 前台是否全屏：`execFile` 调 PowerShell 读前景窗口矩形与任务栏，2 秒缓存、失败按「不是全屏」 |
| `lib/water-log.js`（新） | 109 | 喝水记录的纯函数：`dayKey/clockOf/cleanLog/summarize/toCsv`（本地时区、七天窗口、老 `today.cups` 升级路径） |
| `app/main/log.js` | 60 | 呼吸日志：`createLogger()` → `log/breadcrumb/setFile/filePath/tail`（纯 Node，无 Electron） |
| `app/main/geometry.js` | 25 | 窗口几何纯函数：`clamp/windowWidth/bubbleReserveFor`（与渲染层同一公式） |
| `app/main/tray.js` | 97 | 托盘 + 全局快捷键：`createTrayHost()` 返回 `probe/status/register/setTooltip`，`ACCELERATOR` 常量 |
| `app/main/diagnostics.js` | 99 | 诊断导出：脱敏设置 + 日志尾巴 → txt，返回 `{ok,path,bytes}` |
| `app/pet.js` | 642 | 桌宠渲染、气泡几何与 60% 字号下限 + 截断、命中区上报、手势仲裁、菜单锚点上报（菜单 DOM 在 overlay 窗口）、气泡上的「稍后 10 分钟」 |
| `app/pet.css` | 450 | 气泡 1026:700 框、动效、reduced-motion |
| `app/settings.js` / `.html` / `.css` | 997 / 417 / 1102 | 设置窗口，7 个 `data-panel` 分类；侧边栏搜索（`FIND_INDEX` + 打分 + 键盘）、顶栏按页「恢复这页默认」（二次确认层）、天气页最近城市；其他面板带托盘/快捷键状态、诊断导出与语言下拉 |
| `app/cutout.js` / `.html` / `.css` | 621 / — / 353 | 抠图窗口：三态视图、擦除、旋转、保存 |
| `app/editor.js` / `.html` / `.css` | 537 / — / 233 | 气泡布置编辑器 |
| `app/onboard.js` / `.html` / `.css` | 57 / 52 / 183 | 首次欢迎卡（M17 P0-1）：三步说明 + 两个按钮，关闭即写 `onboarded` |
| `app/bubble-model.js` | 367 | 卡片→行→模块的数据模型（纯函数，Node 可测）；含天气/空气/喝水取值 |
| `app/sound-model.js` | 208 | 音效事件/片段模型（纯函数） |
| `app/tokens.css` | — | 设计 token（配色、圆角、阴影、字号） |
| `lib/store.js` | 364 | 设置/角色/缓存的原子读写 + 读取缓存；`defaults()` 深拷贝、`weather.recent`（去空/去重/≤5）与 `water.log`（排序/上限 500/杯量 50–1000）读写时规整 |
| `lib/weather.js` | 221 | Open-Meteo 取数（三天预报 + 空气质量）、城市搜索、`advice()` 提醒推导、`aqiGrade/parseDays` 纯函数 |
| `lib/placement.js` | 185 | 多显示器归属、吸附、启动还原（纯函数） |
| `lib/cutout*.js` + `lib/png.js` | 359/320/438/161 | 离线抠图：入口、数学、像素管线、PNG 编解码 |
| `lib/cutout-model.js`（新） | 131 | 抠图模型注册表：env → resources/models → assets/models，<1MB 视为缺失 |
| `lib/cutout-eval.js`（新） | 137 | 评测指标纯函数：iou / boundaryLength / edgeSharpness / maskFromImage / summarize |
| `tools/cutout-eval.js`（新） | 150 | 评测 CLI：逐图跑真实 ONNX 管线，输出 IoU/edge/ms/coverage |
| `tools/make-cutout-golden.js`（新） | 145 | 合成 golden set 生成器（10 张 + 真值蒙版） |
| `tools/smoke.js` | 1684 | `npm test` 的第一段：存储/角色/天气/气泡/几何/文案/引导/托盘/诊断/模块拆分/窗口状态机/天气泵/提醒/设置搜索与恢复默认/喝水记录/多语言/菜单搬 overlay 67 项断言 |
| `tests/unit/*.test.js` | 182 例 | `npm run unit`（`node:test`，零依赖）：`bubble-model` 19 · `placement` 16 · `weather` 24 · `cutout-math` 15 · `water-log` 15 · `nudges` 11 · `boot-candidates` 5 · `update-check` 13 · `privacy` 5 · `cutout-model` 10 · `cutout-eval` 13 · `i18n` 18（P1-3/P1-7/P2-1/P2-3/P2-5/P2-6/P2-8） |
| `docs/USER-GUIDE.md` | 123 | 用户手册：三分钟上手 + 9 条 FAQ（0.6.6 / ROADMAP P0-4） |
| `docs/PRIVACY.md`（新） | 84 | 隐私说明：不发遥测、照片不外传、联网三处、数据目录、一键清理（P2-8） |

### 3.3 气泡几何契约（0.6.1 起，改之前先读 `M14-NOTES.md`）

```
WIN_PAD = 54                    窗口左右各留 54px，桌宠水平居中
--bubble-w = clamp(220, innerWidth - 12, 340)
气泡高度 = --bubble-w × 700 / 1026      （CSS aspect-ratio: 1026/700）
预留 reserve = ceil(气泡高度) + 8
窗口高度 = 桌宠尺寸 + reserve        启动即如此，运行中不变（见 §4.1）
桌宠窗口坐标 = (petX - WIN_PAD, petTop - reserve)   气泡永远在桌宠上方
```

文字容器 `left:var(--bubble-vx) top:var(--bubble-vy) width:66% height:64%`，坐标来自 `measureBubbleCentre()`
（实测屏幕上云朵的绘制矩形，**不是** SVG viewBox 的几何中心——两者差 18px）。

---

## 4. 不变量（违反就会复发已修过的 bug）

### 4.1 运行中绝不改透明窗口尺寸
`transparent: true` 的窗口 `setBounds` 会让新露出的区域先合成一帧旧背景 → 肉眼频闪。窗口在
`createPetWindow()` 里就按 `桌宠 + reserve` 建好，之后 `applyBubbleHeight()` 的 `changed` 恒为假。
不要在 `hideBubble()` / 菜单关闭 / 卡片切换里加 `resizeForBubble(0)`。见 `M16-NOTES.md` §7。

### 4.2 透明窗口上不要动画 `filter`，也不要用会过冲的缓动
`drop-shadow` 在透明窗口逐帧重合成（触摸按压、缩放时尤其明显），`cubic-bezier(0.34,1.3,0.6,1)`
会缩放到 1.3 再回弹，产生越界帧＝虚影。阴影放 `.pet-flip`，`#pet` 只留 `transition: transform`。
见 `PET-WINDOW-NOTES.md` §1。

### 4.3 桌宠的屏幕矩形必须显式保存
用 `petPos` + `petScreenRect()` / `windowBoundsForPet()`，不要从窗口几何反推（无边框窗口外框与
`getBounds()` 差几像素）。任何改窗口尺寸的代码都要保证桌宠 top/bottom 不动。

### 4.4 气泡永远在桌宠上方
靠近屏幕顶部时**下移桌宠**，不要翻到下方（用户明确要求，0.6.2）。拖动也有同样的下限。

### 4.5 alpha 只走自有管线
`nativeImage` 的 `getBitmap/createFromBitmap` 是**预乘 BGRA**；对含透明像素的 nativeImage 调 `resize()`
会把 alpha=0 雾化成半透明。缩放/合成/羽化/编码都在 `lib/cutout-pixels.js` + `lib/png.js`，
`lib/cutout.js` 只在入口解码一次。不要恢复 `mask²`、`a<0.45`、按图 min-max 归一化。

### 4.6 抠图重活留在 utilityProcess
推理/合成/PNG 编码在主进程会卡 600ms；`postMessage` 的 transfer list **只接受 MessagePort**，
ArrayBuffer 只能结构化克隆（复制）。打包必须 `asarUnpack` `lib/**` 与 `onnxruntime-common`。

### 4.7 原图不进渲染层
`cutout:pick` / `cutout:load` 只返回 token + ≤1200px 预览，`cutout:run({token})` 用 token 取回原图；
token 表上限 3，窗口关闭即清空。

### 4.8 无障碍基线不许回退
`--muted` 对浅底 ≥4.5:1（当前 `#5d6a86`）；滑杆/图标按钮/复选框 ≥24×24；四个窗口都要有
`prefers-reduced-motion`；编辑器 ≤720px 单列回流；桌宠菜单能靠 `.pet-wrap:focus-within` 显示；
动态音效控件带 `aria-label`。改完跑 `node tools/check-a11y.js`。

### 4.9 渲染进程脚本顶部不能加 `'use strict'`
文件开头 `'use strict'` 紧跟 `(function(){…})()` 会被解析成调用字符串，整个页面报
`"use strict" is not a function`。

### 4.10 设置读取必须走缓存
`store.readSettings()` 在拖动/气泡每帧被调用，已有 mtime 校验的缓存（无缓存时 175µs/次）。

### 4.11 `registerI18nIpc` 必须留在 `createPet` 之前
`app/preload.js` 用 `ipcRenderer.sendSync('i18n:boot')` 同步取字典（`sendSync` 没有超时兜底）。
`app/main.js` 里 `registerI18nIpc(...)` 在第 215 行、`windows.createPet()` 在第 247 行——**顺序不能颠倒**，
否则第一个窗口加载时会卡在等回包。新增窗口一律走 `windows.js`（`createWindows()` 更早），顺序天然成立。
另：`webPreferences` 没开 `sandbox:false`，preload 是沙箱环境，**不能 `require` 本项目模块**，
所以 preload 里的 `t()` 是自包含的副本。

---

## 5. 验证矩阵

| 工具 | 覆盖 | 命令 | 当前 |
|---|---|---|---|
| 语法 | 51 个 JS 文件 | `npm run check` | ✅ |
| `tools/smoke.js` | 存储/角色/天气码/`advice`/气泡模型/几何不变量/文案/首次引导/托盘兜底/诊断导出/主进程模块拆分/窗口状态机/预留-可见性分离/天气泵回退/提醒限流与勿扰/设置搜索与按页恢复默认/喝水记录与延后/主动说话/气泡独立窗口/菜单搬 overlay/多语言骨架与桌宠窗口 | `npm test` | ✅ 67 项 |
| `tools/check-i18n.js` | 语言包键名对齐、空串、每个文件的内联中文数不得高于基线（剥注释后计数） | `node tools/check-i18n.js` | ✅ 30 文件 / 0 处 |
| `tests/unit/` | 纯函数单测：气泡模型归一化/取值、多显示器放置与吸附、天气文案与 AQI、抠图数学、喝水记录、主动说话决策、便携数据目录候选、版本比较与更新决策、隐私清理边界、抠图模型解析与评测指标、多语言计数与静态覆盖 | `npm run unit` | ✅ 182 例 |
| `tools/check-a11y.js` | 静态无障碍断言（对比度数学、24px、reduced-motion、forced-colors 分支、回流、aria、`lang`、引导卡、托盘/诊断行、搜索框与恢复默认确认层） | `node tools/check-a11y.js` | ✅ 95 项 |
| `tools/a11y-audit.js` | 真实 DOM 审计（AX 名称、对比度、目标尺寸、焦点、320px 回流、forced-colors、reduced-motion） | `--port <调试端口>` | ✅ 86 项 / 0 失败 |
| `tools/a11y-keyboard.js` | 键盘-only 抠图全流程 | `node tools/a11y-keyboard.js` | ✅ 6 项 |
| `tools/a11y-tree.js` | 无障碍树走查：四个窗口的每个可交互节点都必须有名字（代替"没装 NVDA"的读屏检查） | `node tools/a11y-tree.js 9229` | ✅ 4 窗口 / 0 无名 |
| `tools/a11y-real.js` | 真机留证：四窗口截图 + 横向溢出计数 + 高对比度计算色（`docs/a11y-shots/`） | `node tools/a11y-real.js 9229 [outDir] [tag]` | ✅ 200% 缩放 0 溢出 |
| `tools/cutout-diag.js` | 合成图 alpha/背景/主体/边缘指标 | `npm run diag:fixtures` | ✅ |
| `tools/e2e/` | 真窗口 e2e：无 resize / 气泡与预留 / 城市搜索与存盘 / 语言切换重启生效（自带本地桩，不依赖外网） | `npm run test:e2e` | ✅ 4 用例 |
| CI | `ci.yml`：`test` job（check + a11y 静态 + test + 合成图 + 真模型正/负例）+ `e2e` job（真 Electron，headless） | push / PR | 配置在库，**私有仓库无法匿名查看** |

起一个可被 CDP 连的开发实例：

```powershell
$env:DESKPET_DATA_DIR='D:\project\deskpet\.dev-data'
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
.\node_modules\electron\dist\electron.exe . --no-sandbox --remote-debugging-port=9229
```

---

## 6. 环境与已知坑（按主题，别重新踩）

### 6.1 启动与运行
1. **`--no-sandbox` 必须加**（本机安全策略下 Chromium 沙箱起不来；打包版不加会静默退出 `0x80000003`）。
2. **`ELECTRON_RUN_AS_NODE` 会被环境继承**：不清掉时 `electron.exe --no-sandbox` 会变成 node 执行，
   报 `bad option: --no-sandbox`。启动前 `Remove-Item Env:ELECTRON_RUN_AS_NODE`。
3. **不要用 `app.getPath('userData')` 做探测**：受限环境会**原生崩溃**；用 `process.env.APPDATA` 拼路径。
4. **写不了 `%APPDATA%`** 时用 `DESKPET_DATA_DIR`；单实例锁失败会直接退出。
5. **前台启动 GUI 会挂住工具调用**：用 `run_in_background` 或计划任务/Explorer 分离启动。
5.1 **在 DSH 受限沙箱（workspace-write）里跑不起来**：会看到
   `FATAL:mojo\public\cpp\platform\platform_channel.cc:108 Check failed: . : 拒绝访问。 (0x5)`，
   之后 `DevTools listening` 照样打印、`app.log` 能写到 `windows created`，但进程随即 `exit code: 1`。
   `Start-Process` / WMI `Win32_Process.Create`（直接 `拒绝访问`）/ `schtasks` 三条分离路都绕不过去，
   必须在 `danger-full-access` 下启动（见 `M17-NOTES.md` §3）。
5.2 **别用 `cmd /c start "" electron.exe …` 做“分离启动”**：启动器立即返回、应用日志一行不增，
   容易误判为启动失败；直接把 electron 放进 background job 台前台跑，日志才能跟着来。
5.3 **测长气泡之前先看 `bubble-model.js` 的归一化上限**：单个模块被 `slice(0, 200)` 截断、每行最多 8 个模块、
   每卡最多 6 行。0.6.6 排查“长文案为什么不截断”时，用 500 字单模块测了半天——实际只渲染了 200 字，
   当然放得下。要压爆气泡必须 **6 行 × 200 字**。
5.4 **溢出不能只测 `scrollHeight`**：安全区是 `justify-content:center`，超出的内容同时从上下两端溢出，
   底部 scroll 指标有时读不出。0.6.6 改成量 `.bubble-content` 与首个子元素的 `getBoundingClientRect()`
   （`overflowAmount()`），两端都算。
5.5 **一键截断别按 10% 慢慢剪**：每轮只剪最长的一行，1200 字要 ~80 轮才收敛，循环护栏先耗尽、还差 35px。
   按 `over.h / clientHeight` 估算超出比例、**一次把所有模块按比例缩短**（`keepRatio`），2–3 轮就收敛。
5.6 **判断托盘图标在不在，别信 `tray.getBounds()`**：图标被折叠时它返回全 0，健康机器上也会这样。
   可靠做法是读 UI Automation：`Shell_TrayWnd` → 名为"显示隐藏的图标"的按钮 → `InvokePattern` 展开 →
   `EnumWindows` 找类名含 `Overflow` 的窗口 → 遍历子 `Button` 的 `Name`（见 `.tmp/check-overflow.ps1`）。
5.7 **全局快捷键要测就测系统级**：CDP 注入的键盘事件走页面、走不到 `globalShortcut`；用 `keybd_event`
   发 Ctrl+Alt+P，再用 UIA/`IsWindowVisible` 看桌宠窗口 `vis=True→False→True`，才算真验过（0.6.6 已验）。
5.8 **node 里 `fetch('http://127.0.0.1:…')` 会被代理劫持**：环境里有 `HTTP_PROXY` 时 CDP 脚本一句不打印、
   直接挂死。跑 CDP 前设 `NO_PROXY=127.0.0.1,localhost`（0.6.6 卡了 40 秒才发现）。
5.9 **分离启动只有 WMI 这条路在本机可用**：
   `Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine='cmd.exe /c xxx.cmd'}`
   返回 `ReturnValue=0` 才算启动；`cmd /c start ""` 和 `Start-Process explorer.exe <cmd>`
   在本机都是**静默不启动**（进程数 0、日志不增）。
5.10 **"托盘不显示"结案（0.6.6）：是本机 `D:\project` 这个目录的问题，不是产品缺陷**。
   裸 P/Invoke 探针（`CreateWindowEx` + `LoadImage` + `Shell_NotifyIcon` + `GetRect`，脚本在 `.tmp/cstray/`）
   在同一台机器上：`D:\project\.tmp\cstray\trayprobe.exe` → `NIM_ADD=False err=5`（`ERROR_ACCESS_DENIED`）；
   同一个 exe 复制到 `%TEMP%`、`C:\Users\Public`、`D:\`、`D:\agent`、`D:\DeskPetTest` → `NIM_ADD=True err=0`。
   目录矩阵：`D:\project`、`D:\project\.tmp`、`D:\project\deskpet`、`D:\project\zz2` 全失败，
   `D:\project2`、`D:\zz\project`、`D:\project_new` 全成功 → 只跟**这个目录对象**有关，与名字、cwd 无关；
   把 `D:\project` 的 DACL 原样复刻到 `D:\ACLtest3` 也能成功 → 也不是 DACL。**Electron 不看 `NIM_ADD`
   的返回值**，所以表现成"托盘静默消失"。0.6.6 打包版复制到 `D:\DeskPetTest\app` 启动后，通知区里
   能看到 `[小芳 · 桌宠]`（截图 `.tmp/overflow-now.png`）。→ **开发/验证一律在 `D:\project` 之外运行**；
   兜底（`Ctrl+Alt+P` + 悬浮菜单 + 设置页状态）继续保留。

### 6.2 打包与分发
6. **32 位 NSIS 打大包会崩**（`Internal compiler error #12345`）：用 64 位 `makensis` +
   `ELECTRON_BUILDER_NSIS_DIR`，见 `M6-PACKAGING.md` §3.2。
7. **模型不能进 asar**：走 `extraResources/models`；`onnxruntime-node` 走 `asarUnpack`，只留 win32 x64。
8. **portable 会把 153MB 解压到 `%TEMP%`**：未签名进程可能被安全软件拦成 `ACCESS_DENIED`；
   本机测试用 `dist\win-unpacked\DeskPet.exe` 更省事。
9. **未签名 exe 会触发 SmartScreen**；不要在任何文档/回复里声称"已签名"。
10. **一次推超过 3 个 tag 不会触发任何 workflow**（GitHub 限制）；要发版就单独推那个 tag。
11. **仓库私有**：匿名 API/网页一律 404，CI/Release 结果只能网页登录看或用 token。
12. **安装器别再改回向导式**：`nsis.oneClick: false` 在静默安装（CI、`/S`）时没有向导页，`$INSTDIR` 为空，
    electron-builder 模板里的 `CHECK_APP_RUNNING` 会拿空路径匹配进程、误判「应用正在运行」而以成功码退出。
    现在固定 `oneClick: true` + `perMachine: false` + `createDesktopShortcut`，不要再用 `oneClick:false`。
13. **安装目录名来自 `appId` 的主进程产物名**：`appId: com.liuhao.deskpet` → `%LOCALAPPDATA%\Programs\desk-pet`
    （不是产品中文名“桌宠”）。验证脚本一律从 `app:status` 的 `dataDir`/exe 路径反推，不要猜。
14. **安装版的启动日志在系统临时目录**：`path.dirname(process.execPath)` 在安装目录里不可写，
    `breadcrumb()` 会回退到 `os.tmpdir()\desk-pet-boot.log`；排查“双击没反应”先看那里。
15. **卸载是异步的**：`Uninstall DeskPet.exe /S` 退出码返回后文件还要再删几秒；脚本里要轮询而不是刚退出就断言失败。
16. `dist\` 会累积十几版旧包（2GB+），每次出包前跑 `node tools/clean-dist.js`（保留当前版本与 `win-unpacked`）。

### 6.3 测试与环境细节
12. **按下即收起气泡只在真正拖动（>4px）时发生**，否则第二次点击永远回到第一张卡。
13. **双击去抖 240ms**，双击只推进一张卡；桌宠的 `dblclick`/`contextmenu` 已移除，别再挂。
14. **截图别用来量像素**：本机 DPR 1.5，`capturePage` 得到的图与窗口 CSS 尺寸不等比，用 CDP 量。
15. **`node tools/a11y-audit.js` 需要一个已经跑起来的调试实例**（默认端口 9229，用 `--port` 指定）。
16. **a11y 键盘流程会往数据目录写一个合成角色**：跑完桌宠可能变成矢量小人，换个数据目录再演示。

### 6.4 渲染与视觉
17. **气泡隐藏后 540ms 再收缩/切换**，改短会把回收动画裁掉；入场延迟 50ms（先加高窗口再显示）。
18. **镜像判定用桌宠矩形**（`petRectOf` + 20px 阈值），不是窗口矩形（窗口左右各有 54px padding）。
19. **给软边照片角色加 `drop-shadow` 会透出深色描边**：`body.photo-role .pet-flip { filter: none }`。
20. **`--muted` 不要再退回 `#7d89a5`/`#8890a8`** 这类浅色，对比度会掉到 3.1:1。

### 6.5 抠图
21. **coverage 双侧门禁**：`<0.02 → NO_PERSON`、`>0.90 → OVER_SEGMENTED`，都要走回退并要求二次确认；
    `cutout:save` 没有 `confirmFallback:true` 必须拒绝。
22. **擦除蒙版是 610×610 图像空间**，画的时候用同样的 translate/rotate/scale 做 `destination-in`，
    指针坐标要反旋转/反翻转再映射。
23. **模型是静态量化版**（44,253,573 字节）：动态量化会产生 CPU EP 无实现的 `ConvInteger`；
    参考目录里那份 58MB 模型是截断的。
24. **每次抠图 trace 写 `<数据目录>/cutout-trace.jsonl`**（>256KB 轮转），排查先看它。

### 6.6 多语言（P2-6 起）
25. **`t()` 必须是同步的**：渲染层拿字典走 `ipcRenderer.sendSync('i18n:boot')`（`preload.js` 的
    `readBoot()`），所以 `registerI18nIpc` 一定要在 `createPet()` 之前（§4.11）。改主进程装配顺序时先看这里。
26. **preload 在沙箱里**（`sandbox` 未关），`require('../lib/i18n.js')` 会失败——preload 里的 `t()`
    是自包含副本，改插值语义要两处一起改（`lib/i18n.js` 的 `interpolate` 与 `preload.js` 的 `apply`）。
27. **基线数字不能跨版本比**：`tools/check-i18n.js` 第一版只数 HTML 属性值、漏了文本节点，
    修好后 `settings.html` 从 28 跳到 173。同一个文件只能和后一版自己比（`--update` 会重写基线）。
28. **剥注释是刚需**：注释里的中文不算文案，`stripJsComments` 用小状态机处理模板串；
    在块注释里写 `/* */` 会提前闭合注释（写文档时踩过，语法直接报错）。
29. **动态拼的键**（`'tray.status.' + status`）会让「语言包里没人用的键」误报，所以那条只提示不失败。

---

## 7. 工作流

### 7.1 改代码
1. 先读 §4 不变量与相关 `*-NOTES.md`。
2. 改完至少跑：`npm run check && npm test && node tools/check-a11y.js`。
3. 涉及窗口/气泡/命中区 → 加跑 CDP 脚本（`.tmp-verify/`，不入库）。
4. 涉及抠图 → 加跑 `npm run diag:fixtures`，必要时 `--input` 跑真模型。

### 7.2 提交
- 提交信息：`type(scope): 中文摘要`（`feat` / `fix` / `docs` / `test` / `refactor` / `chore`），
  正文写"为什么"与验证方式。
- 用户可见的变化要进 `CHANGELOG.md`（`新增` / `修复` / `变更` / `文档` / `打包`），
  机制性改动另开 `Mxx-NOTES.md`。

### 7.3 签名（P2-2）
- 三条路线与各自阻塞写在 `SIGNING.md` §0（SignPath 免费但需先公开仓库；Azure Trusted Signing ≈$9.99/月、
  1–3 天出证；OV 证书 ¥2000–5000/年 + 硬件 token）。
- 仓库侧已就绪：`sign-release.yml` 有 `build-sign`（SignPath）与 `build-sign-azure` 两个作业，靠仓库
  vars 开关，未配置自动跳过；`npm run verify:signature` 默认验 setup/portable/win-unpacked 三个 exe。
- **不要再改回“把 pfx 塞进仓库”那种做法**：证书只能进 CI secret 或云 HSM。

### 7.4 版本与发布
- 版本号有**两处**：`package.json` 与 `package-lock.json`（含 `packages[""].version`）。
- 本机构建 portable（64 位 NSIS 包装）与安装器：

```powershell
$env:ELECTRON_BUILDER_CACHE='D:\project\deskpet\.builder-cache'
$env:CSC_IDENTITY_AUTO_DISCOVERY='false'
$env:ELECTRON_BUILDER_NSIS_DIR='D:\project\deskpet\.tmp-verify\nsis-legacy'
node tools/clean-dist.js                  # 先清旧包（保留当前版本 + win-unpacked）
node node_modules/electron-builder/cli.js --win portable --x64
node node_modules/electron-builder/cli.js --win nsis --x64   # → dist\DeskPet-<v>-setup.exe
```

- 安装器验证（静默，无需管理员）：`"dist\DeskPet-<v>-setup.exe" /S` → `%LOCALAPPDATA%\Programs\desk-pet\DeskPet.exe`；
  卸载 `"Uninstall DeskPet.exe" /S /currentuser`（异步，等几秒再断言）。

- 发布：推**单个** `v*` tag → `release.yml` 构建并创建 Release（失败自动开 Issue）；
  签名工作流 `sign-release.yml` 在配置 `SIGNPATH_*` 变量后才生效（见 `SIGNING.md`）。
- 推送/tag 属于对外动作，**先问用户**。

---

## 8. 交接清单（新接手 30 分钟）

1. 读 `README.md` → 本文 §0–§4 → `ROADMAP.md`（不足与路线）。
2. `npm ci`；若 `node_modules/electron/dist/electron.exe` 不存在，进 `node_modules/electron` 跑 `node install.js`。
3. 跑 §5 的三条命令，确认 51 / 67 / 182 全绿。
4. 起开发实例，点桌宠看三张卡、拖动、开设置、跑一次抠图。
5. 看 `dist/DeskPet-0.6.4-portable.exe` 是否在；核对 §0 的哈希。
6. 把 §4 十条不变量抄进你的工作记忆，再动代码。

---

## 9. 文档索引（按什么时候读）

| 想做的事 | 读 |
|---|---|
| 看整体还差什么、下一步优先级 | [`ROADMAP.md`](ROADMAP.md) |
| 改气泡外观/几何/命中区 | §3.3、§4.1–4.4、[`M14-NOTES.md`](M14-NOTES.md)、[`M16-NOTES.md`](M16-NOTES.md) |
| 改抠图链路 | [`M12-PLAN.md`](M12-PLAN.md)、[`M12-HANDOFF.md`](M12-HANDOFF.md)、`lib/cutout-pixels.js` |
| 碰无障碍 | [`A11Y-AUDIT.md`](A11Y-AUDIT.md)、`tools/check-a11y.js` |
| 改文案 / 加语言 | [`M30-NOTES.md`](M30-NOTES.md)（分层、同步取字典的理由、基线怎么降）、`tools/check-i18n.js --list` |
| 打包/发版踩坑 | [`M6-PACKAGING.md`](M6-PACKAGING.md)、`CONTRIBUTING.md` |
| 签名 | [`SIGNING.md`](SIGNING.md) |
| 模型与二进制资产决策 | [`MODEL-ASSETS.md`](MODEL-ASSETS.md) |
| 改主进程/拆模块 | [`M18-NOTES.md`](M18-NOTES.md)（`app/main/*` 的边界与注入约定）、[`M19-NOTES.md`](M19-NOTES.md)（窗口五态机与转移表） |
| 改设置页 | [`M21-NOTES.md`](M21-NOTES.md)（搜索索引、按页默认值、最近城市的规整边界） |
| 改阻挡式交互 / 首次引导 | [`M17-NOTES.md`](M17-NOTES.md) |
| 窗口屏闪 / 缩放虚影 / 位移 | [`PET-WINDOW-NOTES.md`](PET-WINDOW-NOTES.md) |
| 历次版本细节 | `CHANGELOG.md` + 对应 `Mxx-NOTES.md` |

---

## 10. 新对话开场白（直接粘贴）

> 继续 `D:\project\deskpet` 的 Windows 桌面宠物项目，先读 `HANDOFF.md`（§0 速览、§4 不变量、§6 坑）
> 和 `ROADMAP.md`（不足与优先级）。当前版本 `0.6.12`，`main` 已同步，tag 到 `v0.6.12`。
> 验证基线：`npm run check`（51 个 JS）+ `npm test`（smoke 67 项 + unit 182 例）+ `node tools/check-a11y.js`（95 项）全部通过；
> 带界面的还要跑 `npm run test:e2e`（4 用例）、`a11y-audit`（86 项）与 `a11y-keyboard`（6 项）。
> 记住：运行中不要改透明窗口尺寸、气泡永远在桌宠上方、alpha 只走自有管线、a11y 基线不许退。

## 9. P2-4 阶段二（0.6.12 已完成）

> 这一节原来写的是「唯一剩下的任务」，现在做完了，保留要点方便以后改菜单。

- 活动代码：`app/main/overlay-menu.js`（窗口矩形 + 自标定）、`app/main/overlay-ipc.js`（菜单通道）、`app/overlay.html` 的 `#petMenu`（五项 `data-action`）、
  `app/pet.js` 只报锚点、`app/main/window-layout.js` 的 `applyBubbleHeight` 恒 `{reserve: 0, side: 'above'}`。
- 验收证据：CDP（连 overlay target）五项动作 10/10 到达桌宠页；菜单完整落在窗口内（面板 196×187、窗口 208×216）；
  桌宠窗口 330×222 开合前后不变；Esc/点空白/失焦都能收起；「退出」动作让进程真的退出。
- 踩过的坑：Win11 透明无边框窗整窗比内容区宽 6、高 7（显示后高差 17），`setBounds` 要按标定值补；
  隐藏态窗框不可信，显示后要再 `place()` 一次。细节见 `M32-NOTES.md`。
