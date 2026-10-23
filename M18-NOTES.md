# M18 · 拆 `app/main.js`（0.7.0 / P1-1 阶段 1）

> 目标：ROADMAP `P1-1` / 问题 `L21`——`app/main.js` 到 0.6.6 已经 1451 行，改一处要读半屏，新人不敢动。
> 做法：分三段抽模块。**阶段 1（本文）**只抽耦合最低、可脱离 Electron 单测的四块；
> 行为零变化，`main.js` 只负责接线。
> 验收（ROADMAP 原文）：单文件 ≤300 行；行为零变化（52 + 57 + 86 + 6 全绿）。

---

## 1. 阶段 1 做了什么

| 文件 | 行数 | 内容 |
|---|---|---|
| `app/main/log.js`（新） | 60 | `createLogger()` → `{log, breadcrumb, setFile, filePath, tail}`；纯 Node，不依赖 Electron，所以能被 smoke 直接 `require` |
| `app/main/geometry.js`（新） | 25 | `WIN_PAD` / `clamp` / `windowWidth` / `bubbleReserveFor`；把"渲染层同一公式"变成可断言函数（`windowWidth(220) === 328`） |
| `app/main/tray.js`（新） | 97 | `ACCELERATOR = 'CommandOrControl+Alt+P'`、`createTrayHost({ assets, readSettings, log, actions })` → `probe / status / register / setTooltip`；托盘菜单项的 `click` 走 `actions.togglePet` 等注入回调，不碰全局函数 |
| `app/main/diagnostics.js`（新） | 99 | `createDiagnostics({ version, getStore, logger, getWeather, getTrayStatus, getShortcutReport, log })` → `{ sanitizedSettings, build, export }`；返回 `{ ok, path, bytes }` |
| `app/main.js` | 1451 → **1284** | 顶部 `require('./main/*')`；托盘/快捷键/日志/诊断的旧实现整段删除，改为调用模块 |
| `tools/smoke.js` | 880 → 929 | 新增 `mainSource()`（读 `main.js` + `app/main/*.js` 拼接），6 处原文断言改读它；新增模块契约断言；**54 项** |
| `package.json` | — | `check` 脚本把 4 个新模块加进 `node --check` 链 |
| `.gitignore` | — | `.dev-onboard/ .dev-tray/ .dev-packaged/ .dev-pkg/` 合并成 `.dev-*/` |

### 为什么先抽这四块

1. **依赖方向干净**：`log`、`geometry` 零依赖；`tray`、`diagnostics` 只吃注入的回调（logger、readSettings、actions），
   不反向引用 `main.js` 里的窗口变量。没有循环依赖，`require` 顺序无所谓。
2. **可脱离 Electron 断言**：前两个模块纯 Node，smoke 能直接 `require` 并验证数字（328、`ceil(316*700/1026)+8`）。
   后两个模块用工厂 + 注入，句柄全在参数里（`ipcMain.handle` 的注册仍留在 `main.js`）。
3. **它们正好是"最容易出回归"的部分**：托盘/快捷键 0.6.6 刚大改过，诊断导出带脱敏逻辑——抽出来单独测最划算。

### 有意没做的

- **不拆窗口管理**（`createWindow`/`hitWindows`/`forwardMouse`）：那是 540ms/50ms 时序约定的落脚点，
  得等 P1-2 状态机一起改，现在拆只会把约定搬到两个文件里。
- **不拆 IPC 注册**：`ipcMain.handle` 全是薄胶水，拆成模块反而多一层间接。
- **不改任何行为**：`app:status` 的字段仍是 `{ version, electron, platform, dataDir, tray, shortcut }`，
  `tray` 形状 `{ ok, reason }`、`shortcut` 形状 `{ ok, accelerator, reason, registered }` 与 0.6.6 一致（实测见 §3）。

## 2. 验证

### 静态（全绿）

```
npm run check          # 19 个文件 node --check（新增 4 个模块）
npm test               # smoke 54 项
node tools/check-a11y.js  # 57 项
```

### 运行时（真机 Electron 44.9.0，CDP 9229，数据目录 `.dev-p11`）

| 检查 | 结果 |
|---|---|
| 冷启动（新数据目录）| 首启引导正常弹出，主进程无异常退出 |
| `getAppStatus().tray` | `{ ok: true, reason: '' }`（托盘创建链路完整；本机 `D:\project` 下图标不可见是目录特性，见 M17-NOTES §8.1） |
| `getAppStatus().shortcut` | `{ ok: true, accelerator: 'Ctrl+Alt+P', registered: true }` |
| `app.log` | 596 行，含 `tray created …`、`shortcut … ok=true`、`windows created …`、`diagnostics exported …` —— `log.js` 的 `setFile/tail` 正常 |
| `exportDiagnostics()` | `{ ok: true, path: '…\\diagnostics-20261023-055249.txt', bytes: 15959 }` |
| 导出内容 | 含托盘与快捷键状态；城市/坐标写成 `[已脱敏]`，原始城市名不出现 |
| `a11y-audit --port 9229` | 86 项 / 0 失败 |
| `a11y-keyboard --port 9229` | 6 / 6 |

## 3. 踩到的坑

1. **smoke 的原文断言绑死在 `app/main.js` 上**：6 处 `readFileSync('app/main.js')` 在拆分后立刻红。
   修法是 `mainSource()` 把 `main.js` + `app/main/*.js` 拼起来再跑正则——这样后续每抽一块都不用改断言。
2. **断言写死了调用形态**：`click: togglePet` 变成 `click: actions.togglePet` 后，原正则 `\\/click: togglePet\\//` 失败。
   教训：断言尽量匹配"能力"（`function togglePet` 存在 + 菜单项指向 `actions.togglePet`），别匹配排版。
3. **`logger.filePath()` 现在是选项对象**：`tail(logger.filePath(), 200)` 这种写法在 `tail(file, lines)` 签名下也要能跑，
   所以 `log.js` 的 `filePath()` 返回字符串、`tail(file, lines)` 保持旧签名——拆分不改 API，只换位置。
4. **`mainSource()` 少了一个右花括号**：`node tools/smoke.js` 直接 `SyntaxError: Unexpected end of input`，
   报错行是文件末尾（929），真正的问题在 38 行。改完函数立刻 `node --check tools/smoke.js` 更快定位。
5. **文件工具用真实 revision**：`ops_edit_file` / `ops_write_file` 的 `expectedRevision` 必须先 `ops_stat` 取，
   凭记忆填会一直 `REVISION_CONFLICT`（本轮踩了三次）。
6. **`.gitignore` 与 `store.js` 是 CRLF**：多行替换要带 `\r\n`，否则 `oldText not found`。

## 4. 下一段（阶段 2 / 阶段 3）

| 阶段 | 内容 | 前置 |
|---|---|---|
| 2 | `window.js`：`createWindow` / 位置还原 / 拖动守卫 / 命中窗口与 `forwardMouse` | 建议与 P1-2 状态机一起做，避免把 540ms 约定搬两次 |
| 3 | `ipc.js` + `weather-pump.js` + `reminder.js`：`ipcMain.handle` 汇总、天气定时器与断网降级、喝水提醒调度 | 阶段 2 之后（依赖窗口句柄） |

阶段 2 完成后 `main.js` 应落在 300 行左右；届时把 `HANDOFF.md` §3.2 的"主进程入口"一行改成装配说明。