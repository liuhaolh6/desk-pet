# M28 · 气泡独立窗口（P2-4）

> ROADMAP P2-4 分两段做：**阶段一（本次）** 把气泡搬进独立窗口、行为与旧版一致；
> **阶段二（未做）** 才去掉桌宠窗口的 224px 预留、把悬停菜单也搬过去，让桌宠窗口真正只装桌宠。

## 1. 为什么分两段

一次性把“气泡搬家 + 预留区拆除 + 菜单搬家 + 命中判定重写”全做完，等于同时改四件互相依赖的事：
气泡位置依赖预留区高度、命中判定依赖气泡矩形、菜单锚点依赖窗口宽度。真要一起改，出问题时分不清是哪一件。
阶段一先证明“气泡在第二个窗口里能画对、能跟随、能点、能转发按钮”，阶段二才有安全的落点。

## 2. 阶段一做了什么

| 文件 | 变化 |
|---|---|
| `app/overlay.html`（新） | 只有气泡骨架：`#bubble`（`aria-live="polite"`）+ `#bubbleContent` + 与 `pet.css` 同源的云朵 SVG |
| `app/overlay.css`（新） | 从 `pet.css` 派生的气泡样式；窗口只有气泡那么大，所以 `inset:0` 铺满；沿用 `--u` 缩放与 `FIT_FLOOR = 0.6` 截断规则 |
| `app/overlay.js`（新，169 行） | 只负责画：换算 `--u`、渲染行/按钮、超框收缩 + 逐字截断（`data-full` + `title`/`aria-label` 留全文）、点击与按钮转发 |
| `app/main/overlay.js`（新，211 行） | 窗口生命周期：懒创建、定位（贴宠物上方，上方放不下翻下方）、跟随、`showInactive` 显示、`alwaysOnTop` 同步；`registerOverlayIpc` 注册 `bubble:render` / `bubble:hide` / `overlay:click` / `overlay:action` |
| `app/pet.js` | 不再画气泡：`showBubble` 只把卡片整包 `api.renderBubble(payload)` 发出去，然后照旧 `setReserve` 保留桌宠窗口上方的 strip；点击/按钮的语义仍在 `boot()` 里处理（`water-done` / `water-later`） |
| `app/pet.html` | 删掉 `#bubble` 骨架（气泡搬到 overlay） |
| `app/preload.js` | 新增 `renderBubble` / `onOverlayRender` / `onOverlayClear` / `onOverlaySide` / `overlayClick` / `overlayAction` |
| `app/main.js` | 创建 `overlay` 实例并注入 `registerIpc` |
| `app/main/ipc.js` | 拖动后 `overlay.follow()`；气泡出现/收起翻译成状态机事件（`bubble-show`/`bubble-hide`） |
| `app/main/nudge-pump.js` | `nudge:probe` 通道挪到这里（P2-4 让 `ipc.js` 又长了 16 行，先把探针搬出去，守住 450 行上限） |

阶段一**保留**了桌宠窗口上方的预留 strip（`pet.js` 的 `bubbleReserve()`），所以视觉上气泡仍然在
原来的位置，只是它现在是一扇独立的窗口。这样做的好处：截图对比看不出差别，风险只集中在“窗口跟随 + 首帧”上。

## 3. 三个必须踩过的坑

1. **懒建窗口的首帧会丢**。`create()` 之后立刻 `send('overlay:render')`，此时 `loadFile` 还没完成，
   渲染进程根本没注册监听 → 气泡窗口出现但空白。修法：记住 `lastRender`，在 `did-finish-load` 里补发一次；
   `show()` 里用 `webContents.isLoading()` 判断是否需要当场发。
2. **`'use strict'` 后面紧跟 IIFE 少了分号**。`app/overlay.js` 的第一版就是
   `'use strict'` + 换行 + `(() => {…})()`，被 ASI 解析成 `'use strict'(...)` 调用字符串，
   运行时报 `TypeError: "use strict" is not a function`，而 `node --check` **抓不到**。
   smoke 里为此加了一条文本断言（IIFE 前必须有分号）。
3. **`overlay` 与桌宠窗口的坐标口径**。`overlay.place()` 用的是 `layout.petScreenRect(size)`（宠物本体，
   不含 pad），不是窗口 bounds；拖动时主进程先更新 `layout.petPos` 再 `setBounds`，所以 `follow()` 拿到的是新位置。

## 4. 验证记录（2026-10-23，端口 9250，数据目录 `.dev-p24`）

CDP 脚本 `D:\project\.tmp\cdp-p24.js`，7/7：

| 检查 | 结果 |
|---|---|
| 点宠物后创建 overlay 窗口 | PASS |
| overlay 里气泡为 `show`（load 后补发 render） | PASS |
| overlay 渲染出卡片行 | PASS（5 行「💧 该喝水啦…」） |
| overlay 截图 | PASS（`.tmp/p24-overlay.png`，41 KB，气泡与桌宠贴合） |
| 拖动搬动宠物窗口 | PASS（1196,418 → 886,274） |
| overlay 跟随（不贴边时位移相同） | PASS（overlay 340 / pet 340） |
| 点气泡后收起 | PASS |

另外 `cdp-p24-action.js` 验证了卡片按钮转发：点「喝过了」→ 桌宠窗口收到 `bubble:action` → `drinkDone()` →
气泡收起（与 P2-4 之前的行为一致），桌宠 IPC 仍正常。

门禁：`npm run check`（58 个 JS 文件）、`npm test`（smoke **62** 项）、`npm run unit`（**123** 例）、
`node tools/check-a11y.js`（静态无障碍）全绿。

## 5. 阶段二待做（下一步）

- 去掉 `app/pet.css` 的 `aspect-ratio` 预留与 `pet.js` 的 `bubbleReserve()`：桌宠窗口变回 `size + 2*pad`。
- 悬停菜单也搬进 overlay（菜单需要可聚焦与键盘操作，得先想清楚它和气泡窗口的焦点关系）。
- `window-layout.js` 的命中矩形只剩宠物本体，`updateInteractive()` 可以大幅简化。
- 气泡可以真正“比宠物大”：`metrics()` 的宽度 clamp 不再受 `petWidth` 限制。