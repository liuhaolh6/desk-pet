# M32 · 悬停菜单搬进 overlay 窗口（P2-4 阶段二收尾）

> 目标：菜单不再被桌宠窗口剪掉；桌宠窗口的尺寸/位置不随菜单变化；五项动作照旧。
> 结果：菜单在 overlay 窗口渲染，CDP 10/10；桌宠窗口 330×222 开合前后不变；
> 门禁 smoke **67** / unit **182** / `npm run check`（51 文件）/ check-a11y / check-i18n（30 文件 / 0 内联）全绿。

## 1. 为什么搬，而不是继续把桌宠窗口加大

0.6.11 的做法是「打开菜单时把桌宠窗口临时调高，菜单关掉再收回」。它有三个绕不过去的问题：

1. `transparent: true` 的窗口运行中 `setBounds` 会先合成一帧旧背景（§4.1 的频闪），菜单一开一关就是两次；
2. 菜单顶到屏幕边缘时窗口没处长（最大长到工作区边缘），贴顶只能翻到桌宠下方，窗口高度仍要变；
3. 窗口变大 = 命中区变大，`setIgnoreMouseEvents` 的矩形跟着重算，鼠标经过菜单边缘的行为会变。

气泡此前已经搬进独立的 overlay 窗口（P2-4 阶段一）。菜单和气泡天然是「贴在桌宠旁边的一块内容」，
于是把菜单也放进同一扇窗：桌宠窗口回到纯宠物尺寸，菜单画在哪、开多大完全由 overlay 决定。

## 2. 分层（谁管什么）

| 层 | 文件 | 职责 |
|---|---|---|
| 菜单 DOM | `app/overlay.html` 的 `#petMenu` | 五项按钮复用原 `data-action`（settings/editor/weather/hide/quit）与 `data-i18n`，主题变量直接生效 |
| 渲染层 | `app/overlay.js` | 打开时量 `#petMenu` 的 `getBoundingClientRect` → `reportMenuSize`；点项 → `menuAction(id)`；Esc / 点面板空白 → `menuClose()`；收 `overlay:menu {open}` 显隐 |
| 窗口侧 | `app/main/overlay-menu.js` | `createMenuController()`：按锚点+面板尺寸算窗口矩形（上方优先、放不下翻下方、夹在工作区），`open/close/place/follow/setSize/setSize`，并自标定窗框差 |
| IPC 面 | `app/main/overlay-ipc.js` | `bubble:render|hide`、`overlay:grow|click|action`、`overlay:menu-size|menu-action|menu-close`；菜单动作转发回桌宠窗口 |
| 业务 | `app/main/ipc.js` `pet:menu` | 收 `{open, anchor}`：打开先把状态机从 bubble 拉回（`bubble-hide`）再 `menu-open`；关闭时 `menu-close`，并向桌宠发 `pet:menu-closed` |
| 桌宠侧 | `app/pet.js` | 只量 `#petWrap` 报锚点（`setMenu(true, {x, y})`），不再持有菜单 DOM；`onMenuAction` 用 if/else 白名单路由五个动作 |
| 几何 | `app/main/window-layout.js` | `applyBubbleHeight()` 恒返回 `{reserve: 0, side: 'above'}`，不再为菜单改窗口 |
| 显隐 | `app/main/overlay.js` | `visible = bubbleShown || menuShown`；菜单打开才 `setFocusable(true)`，关闭即整窗隐藏 |

坐标口径：锚点是**桌宠窗口内容区坐标**（渲染层 `getBoundingClientRect` 得到）；`petRect` 用
`petWin.getContentBounds()`，不要用 `getBounds()`。其余矩形都是屏幕坐标。

## 3. 最重要的一坑：Win11 透明窗的「窗框差」

实测（本机 Win11，`transparent: true, frame: false`）：

- 整窗比渲染层内容区**宽 6px、高 7px**；
- 窗口隐藏时 `setBounds`、再 `show()` 之后，高差变成 **17px**（Windows 在显示后才给出真实窗框）；
- 客户区原点还与 `getContentBounds()` 有 1~4px 偏移。

直接用 `setBounds(panelRect)` 的后果：菜单面板底边被窗口裁掉 1~5px（截图里最后一项下沿缺一条）。
`setContentBounds()` 也靠不住——它报的值和渲染层实际的 `innerWidth/innerHeight` 对不上。

修法是**自标定**（`overlay-menu.js#calibrate`）：

```js
// 渲染层：内容区尺寸 + 屏幕原点
JSON.stringify([innerWidth, innerHeight, screenX, screenY])
// 主进程：contentBounds - 渲染层 = 窗框差
frame.width = c.width - iw;  frame.height = c.height - ih
frame.x = c.x - sx;          frame.y = c.y - sy
// 摆位：面板矩形补上窗框差再 setBounds
w.setBounds({ x: next.x - frame.x, y: next.y - frame.y,
              width: next.width + frame.width, height: next.height + frame.height })
```

标定只跑一次即可（窗框差只跟窗口样式有关）。`open()` 里 `place()` 要调**两次**：`syncVisibility()`
之前那次用的是隐藏态窗框（不准），显示之后再放一次才是最终位置。

## 4. 焦点、收起与动作

- 菜单打开时 `win.setFocusable(true)` + `win.focus()`：键盘可以 Tab 进菜单、Esc 退出；
  关闭时立刻 `setFocusable(false)`，不让一个不可见窗口偷焦点。
- 收起有三条路：Esc（渲染层）、点面板空白（渲染层）、窗口失焦（主进程 `blur`）。三种都经
  `overlay:menu-close` → `overlay.closeMenu()` + 状态机 `menu-close` + `pet:menu-closed` 回桌宠清状态。
- 点菜单项：渲染层 `menuAction(id)` → 主进程转发 `pet:menu-action` → `app/pet.js` 的 if/else 白名单
  （settings/editor/weather/hide/quit）；未知 id 不执行任何东西。
- 菜单顶掉气泡：`pet:menu {open:true}` 里若 `bubbleVisible`，先 `bubble-hide` 再过 `menu-open`，
  避免两条状态互相踩。

## 5. 验证证据（2026-10-24，便携开发实例，CDP 连 overlay target）

| 检查 | 结果 |
|---|---|
| 菜单在 overlay 窗口内、未被裁 | 面板 196×187，窗口内容区 208×216（`Page.captureScreenshot` 312×324 物理像素，视觉确认五项齐全、悬停高亮、分隔线、危险项红色） |
| 五项动作到达桌宠页 | settings / editor / weather / hide / quit 全部触发（喝水按钮走既有 `overlay:action` 链路） |
| 桌宠窗口尺寸不随菜单变化 | 开合前后 `330×222`、坐标不变 |
| 收起 | 点项后收起；Esc 收起；窗口失焦收起；`pet:menu-closed` 计数 4 |
| 隐藏 | 点「先藏起来」：Win32 枚举三个窗口 `vis` 全 false（桌宠 + overlay 都隐藏），不是只改 CSS |
| 退出 | 点「先退出啦」：CDP target 消失，进程真的退出 |
| 气泡回归 | 点桌宠：气泡 `316×216`、铺满 overlay 窗口、文字完整未裁 |

门禁：`node tools/smoke.js` 67 checks passed；`npm run check` 51 文件 exit 0；
`node --test --test-isolation=none tests/unit/*.test.js` 182 pass / 0 fail；
`node tools/check-a11y.js` 静态检查通过；`node tools/check-i18n.js` 2 语言包一致、30 文件 0 内联。

## 6. 以后改这里要注意

1. 别把菜单 DOM 挪回 `app/pet.html`：桌宠窗口一旦装菜单，又会回到「窗口要长大」的老路。
2. 别用常量补窗框差（6/7 只是这台机器的值，显示后还会变 17）；加新窗口样式时先跑 `calibrate`。
3. 隐藏态窗框不可信：任何 `show()` 之前的 `place()` 都只是占位，显示后必须再 `place()`。
4. `tools/smoke.js` 里有断言盯着「菜单在 overlay.html」「`applyBubbleHeight` 恒 0」「桌宠 html 不出现 data-action」——
   改结构时先跑 smoke，别先改断言。
5. 仓库多数文件是 CRLF，`ops_edit_file` 的 `oldText` 要带 `\r\n`；CDP 验收连 overlay target，不是 `#pet` 页。