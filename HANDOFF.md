# 交接文档（HANDOFF）

> 版本 `0.6.6` · 最后更新 2026-10-22 · 给下一个接手的人（或下一个对话的我）。
> 目标：读完这一份就能**安全地改代码、跑验证、出包**，不必重新摸索。
> 想先知道"这东西现在还差在哪、下一步做什么"，看 [`ROADMAP.md`](ROADMAP.md)。

---

## 0. 30 秒速览

| 项 | 值 |
|---|---|
| 是什么 | Windows x64 桌面宠物（Electron 44 + 离线 ONNX 人像抠图），悬浮在桌面上，点击看天气 / 喝水 / 温馨话 |
| 本地目录 | `D:\project\deskpet` |
| 仓库 | `ssh://git@ssh.github.com:443/liuhaolh6/desk-pet.git`，分支 `main`，**当前是私有仓库** |
| 版本 | `0.6.6`，**已出包** `dist\DeskPet-0.6.6-portable.exe`（153.7 MB，未签名）与 `dist\win-unpacked\`；tag 推到 `v0.6.6`（`0.6.1`–`0.6.5` 按用户决定不补 tag，只在 `main` 历史里） |
| 最近提交 | `12176d2` = 0.6.6 重新打包 + 托盘收口 + 真按键验证；`5be8c4d` = 0.6.6 长文案/托盘兜底/手册/诊断导出；再往前 `adbe033` 0.6.5 首次引导、`63ae453 docs(0.6.4)` |
| 当前状态 | 功能闭环、可日常使用；**未签名**、未上架、仅 Windows x64 |
| 一条命令自检 | `npm run check && npm test && node tools/check-a11y.js` |
| 自动化基线 | smoke **52 项** · check-a11y **57 项** · a11y-audit **86 项** · a11y-keyboard **6 项**，全部通过 |
| 最新产物 | `dist/DeskPet-0.6.4-portable.exe`，153,754,785 字节，SHA-256 `22d173d4219b47e1e2df82de9c43f9a6777613668c0ec3e937ea09f9f206e82c`（0.6.5 还没打包，重打后再换这一行） |

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
| 系统集成 | 托盘菜单、开机自启、单实例 | ⚠️ | 本机 Win11 26200 通知区不显示托盘图标：Electron **39.8.5 与 44.9 都复现**，同机 WinForms `NotifyIcon` 与应用自带的 DSH 托盘正常 → 判定为 Electron 与该系统通知区的兼容问题（§6.1 5.10）；已用 `Ctrl+Alt+P` + 悬浮菜单兜底 |
| 打包 | portable exe、图标/版本信息、便携数据目录 | ✅ | 未签名；无安装器、无自动更新 |
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
   ├─ weather（lib/weather.js）──► api.open-meteo.com / geocoding-api.open-meteo.com
   └─ 定时器：喝水提醒、天气刷新、隐藏时通知
```

渲染层**不碰文件系统**：所有落盘、协议（`pet-role://`、`pet-sound://`）都在主进程；
`app/preload.js` 用 `contextBridge` 暴露白名单 API（`window.deskPet`）。

### 3.2 关键文件

| 路径 | 行数 | 作用 |
|---|---|---|
| `app/main.js` | 1451 | 窗口/托盘/IPC/天气调度/提醒/命中轮询/日志/诊断导出；**最大的单体文件**（P1-1 要拆） |
| `app/pet.js` | 819 | 桌宠渲染、气泡几何与 60% 字号下限 + 截断、命中区上报、手势仲裁、菜单 |
| `app/pet.css` | 450 | 气泡 1026:700 框、动效、reduced-motion |
| `app/settings.js` / `.html` / `.css` | 512 / 295 / 831 | 设置窗口，7 个 `data-panel` 分类；其他面板带托盘/快捷键状态与诊断导出 |
| `app/cutout.js` / `.html` / `.css` | 621 / — / 353 | 抠图窗口：三态视图、擦除、旋转、保存 |
| `app/editor.js` / `.html` / `.css` | 537 / — / 233 | 气泡布置编辑器 |
| `app/onboard.js` / `.html` / `.css` | 57 / 52 / 183 | 首次欢迎卡（M17 P0-1）：三步说明 + 两个按钮，关闭即写 `onboarded` |
| `app/bubble-model.js` | 346 | 卡片→行→模块的数据模型（纯函数，Node 可测） |
| `app/sound-model.js` | 208 | 音效事件/片段模型（纯函数） |
| `app/tokens.css` | — | 设计 token（配色、圆角、阴影、字号） |
| `lib/store.js` | 302 | 设置/角色/缓存的原子读写 + 读取缓存 |
| `lib/weather.js` | 141 | Open-Meteo 取数、城市搜索、`advice()` 提醒推导 |
| `lib/placement.js` | 185 | 多显示器归属、吸附、启动还原（纯函数） |
| `lib/cutout*.js` + `lib/png.js` | 359/320/438/161 | 离线抠图：入口、数学、像素管线、PNG 编解码 |
| `tools/smoke.js` | 880 | `npm test`：存储/角色/天气/气泡/几何/文案/引导/托盘/诊断 52 项断言 |
| `docs/USER-GUIDE.md` | 123 | 用户手册：三分钟上手 + 9 条 FAQ（0.6.6 / ROADMAP P0-4） |

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

---

## 5. 验证矩阵

| 工具 | 覆盖 | 命令 | 当前 |
|---|---|---|---|
| 语法 | 14 个 JS 文件 | `npm run check` | ✅ |
| `tools/smoke.js` | 存储/角色/天气码/`advice`/气泡模型/几何不变量/文案/首次引导/托盘兜底/诊断导出 | `npm test` | ✅ 52 项 |
| `tools/check-a11y.js` | 静态无障碍断言（对比度数学、24px、reduced-motion、回流、aria、`lang`、引导卡、托盘/诊断行） | `node tools/check-a11y.js` | ✅ 57 项 |
| `tools/a11y-audit.js` | 真实 DOM 审计（AX 名称、对比度、目标尺寸、焦点、320px 回流、forced-colors、reduced-motion） | `--port <调试端口>` | ✅ 86 项 / 0 失败 |
| `tools/a11y-keyboard.js` | 键盘-only 抠图全流程 | `node tools/a11y-keyboard.js` | ✅ 6 项 |
| `tools/cutout-diag.js` | 合成图 alpha/背景/主体/边缘指标 | `npm run diag:fixtures` | ✅ |
| CDP 脚本 | 气泡几何/命中/收起/城市搜索/编辑器/无 resize | `.tmp-verify/cdp-*.js`（不入库） | 按需 |
| CI | `ci.yml`：check + a11y 静态 + test + 合成图 + 真模型正/负例 | push / PR | 配置在库，**私有仓库无法匿名查看** |

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
5.10 **Win11 26200 的托盘问题结案（0.6.6）**：本机 Electron 39.8.5 与 44.9 **都不进通知区**（dev、打包、
   用 WMI 脱离 DSH 进程树启动都一样；PNG 与 ICO 图标都试过；重启 explorer 无效），而同机
   WinForms `NotifyIcon` 与应用自带的 DSH（Electron 打包版）托盘都正常 → 判定为 Electron 托盘实现
   与该 Windows 版本通知区之间的兼容问题，应用侧无解，只能兜底：`Ctrl+Alt+P` + 桌宠悬浮菜单 +
   设置页如实说明（0.6.6 起文案不再说"托盘没问题"）。

### 6.2 打包与分发
6. **32 位 NSIS 打大包会崩**（`Internal compiler error #12345`）：用 64 位 `makensis` +
   `ELECTRON_BUILDER_NSIS_DIR`，见 `M6-PACKAGING.md` §3.2。
7. **模型不能进 asar**：走 `extraResources/models`；`onnxruntime-node` 走 `asarUnpack`，只留 win32 x64。
8. **portable 会把 153MB 解压到 `%TEMP%`**：未签名进程可能被安全软件拦成 `ACCESS_DENIED`；
   本机测试用 `dist\win-unpacked\DeskPet.exe` 更省事。
9. **未签名 exe 会触发 SmartScreen**；不要在任何文档/回复里声称"已签名"。
10. **一次推超过 3 个 tag 不会触发任何 workflow**（GitHub 限制）；要发版就单独推那个 tag。
11. **仓库私有**：匿名 API/网页一律 404，CI/Release 结果只能网页登录看或用 token。

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

### 7.3 版本与发布
- 版本号有**两处**：`package.json` 与 `package-lock.json`（含 `packages[""].version`）。
- 本机构建 portable（64 位 NSIS 包装）：

```powershell
$env:ELECTRON_BUILDER_CACHE='D:\project\deskpet\.builder-cache'
$env:CSC_IDENTITY_AUTO_DISCOVERY='false'
$env:ELECTRON_BUILDER_NSIS_DIR='D:\project\deskpet\.tmp-verify\nsis-legacy'
node node_modules/electron-builder/cli.js --win portable --x64
```

- 发布：推**单个** `v*` tag → `release.yml` 构建并创建 Release（失败自动开 Issue）；
  签名工作流 `sign-release.yml` 在配置 `SIGNPATH_*` 变量后才生效（见 `SIGNING.md`）。
- 推送/tag 属于对外动作，**先问用户**。

---

## 8. 交接清单（新接手 30 分钟）

1. 读 `README.md` → 本文 §0–§4 → `ROADMAP.md`（不足与路线）。
2. `npm ci`；若 `node_modules/electron/dist/electron.exe` 不存在，进 `node_modules/electron` 跑 `node install.js`。
3. 跑 §5 的三条命令，确认 49 / 44 / 通过。
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
| 打包/发版踩坑 | [`M6-PACKAGING.md`](M6-PACKAGING.md)、`CONTRIBUTING.md` |
| 签名 | [`SIGNING.md`](SIGNING.md) |
| 模型与二进制资产决策 | [`MODEL-ASSETS.md`](MODEL-ASSETS.md) |
| 窗口屏闪 / 缩放虚影 / 位移 | [`PET-WINDOW-NOTES.md`](PET-WINDOW-NOTES.md) |
| 历次版本细节 | `CHANGELOG.md` + 对应 `Mxx-NOTES.md` |

---

## 10. 新对话开场白（直接粘贴）

> 继续 `D:\project\deskpet` 的 Windows 桌面宠物项目，先读 `HANDOFF.md`（§0 速览、§4 不变量、§6 坑）
> 和 `ROADMAP.md`（不足与优先级）。当前版本 `0.6.6`，`main` 已同步，tag 到 `v0.6.6`。
> 验证基线：`npm run check` + `npm test`（52 项）+ `node tools/check-a11y.js`（57 项）全部通过；
> 带界面的还要跑 `a11y-audit`（86 项）与 `a11y-keyboard`（6 项）。
> 记住：运行中不要改透明窗口尺寸、气泡永远在桌宠上方、alpha 只走自有管线、a11y 基线不许退。