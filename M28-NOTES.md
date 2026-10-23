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

## 5. 阶段二（已完成）：把预留 strip 删掉

阶段一留了个尾巴：气泡虽然搬进了 overlay，桌宠窗口仍然按 `bubbleReserveFor(windowWidth(size))`
预留一条 224px 的透明 strip。它不可见，但让窗口一直比桌宠大一圈：`328×400` 对 `328×220`。

### 改了什么

| 文件 | 改动 |
|---|---|
| `app/main/window-layout.js` | `applyBubbleHeight()` 不再算预留：`reserve` 恒为 0，只把窗口尺寸归一到 pet 大小（旧版本留下的 strip 在第一次调用时被收回）。`windowBoundsForPet()` 保留 reserve 参数——纯函数测试还在用 |
| `app/main/windows.js` | 建窗时 `height = size`（原 `size + reserve`），`layout.begin({ reserve: 0 })`；改尺寸时窗口贴着 pet 顶对齐 |
| `tools/smoke.js` | 旧的「预留增长/贴边下推」断言换成新不变量：预留恒 0、窗口高度恒等于桌宠、`wantReserve` 不再出现在布局里 |

`pet:reserve` 通道**保留**（渲染层还在发），但已经是空操作——这样旧渲染层、旧 preload 不会报错。

### 验证

| 项 | 结果 |
|---|---|
| 桌宠窗口几何 | PASS（CDP：`outerWidth 328 × outerHeight 220`，原来 220 + 180 = 400） |
| 气泡默认在上方 | PASS（overlay bottom 636 ≤ pet top 642，gap 6px） |
| 气泡贴上沿自动翻到下方 | PASS（拖到 `screenY 117` 后气泡 `screenY 343` ≥ pet bottom 338） |
| `pet:reserve` 不再动窗口 | PASS（smoke 断言 `reserve = 0` + 高度恒等） |
| 静态门禁 | check 0 / smoke 67 / unit 166 / check-i18n 0 / check-a11y 通过 |
| 运行时无障碍 | a11y-audit 86 项 0 失败 |

### 还没做（明确放弃的部分）

- **悬停菜单搬进 overlay**：菜单要能聚焦、要键盘可达（`role="menu"` + 方向键），搬进一个默认不聚焦的
  气泡窗口会和「气泡不抢焦点」的承诺打架。现在的做法是菜单仍留在桌宠窗口里——它的尺寸本来就只依赖
  桌宠本体，不再受 strip 影响。
- 气泡宽度仍按 `petWidth - 12` 算（`metrics()`）。想去掉这个上限得先定「气泡能不能比桌宠宽」这个
  设计问题，不是重构问题。

