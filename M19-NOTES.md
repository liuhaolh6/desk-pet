# M19 · 显式窗口状态机（0.7.0 / P1-2）

> 目标：ROADMAP `P1-2` / 问题 `L7`——桌宠窗口的行为原来靠一堆布尔和"等 540ms 再收气泡"这种
> 时序约定串起来：`petDragging`、`bubbleTimer`、`scheduleRectReport()` 的 50ms 防抖、菜单自己的
> `state.menuOpen`。谁先谁后全靠人记，0.6.3/0.6.4 的几次回归（气泡盖住菜单、拖动时窗口尺寸跳变、
> 抠图窗口抢焦点）都出在这块。
>
> 做法：一个纯 Node 的五态机 `app/window-state.js`，主进程持有唯一实例；所有会改变"桌宠现在在
> 干什么"的事件都过它，非法事件记数但不抛。**行为不变**，只是把隐式约定变成显式表。
>
> 验收（ROADMAP 原文）：状态机单测覆盖全部转移；连点 20 次无 resize、无闪。

---

## 1. 状态与转移

五个状态，`hidden`（窗口被收进托盘）故意**不是**状态——可见性和"在干什么"是正交的两件事，
混进来会让每个事件都要判断两遍。`collapsed`（气泡预留收起）同理，属于几何，不属状态。

| 状态 | 含义 |
|---|---|
| `idle` | 桌宠显示、无气泡、无菜单、不在拖 |
| `bubble` | 气泡展示中（含 50ms 防抖里的尺寸上报） |
| `menu` | 悬停菜单打开 |
| `dragging` | 按住左键拖动 |
| `cutout` | 抠图窗口开着 |

转移表（`app/window-state.js` 的 `TABLE`，也是单测的数据源）：

| 事件 | 从 | 到 |
|---|---|---|
| `bubble-show` | `idle` | `bubble` |
| `bubble-hide` | `bubble` | `idle` |
| `menu-open` | `idle`、`bubble` | `menu` |
| `menu-close` | `menu` | `idle` |
| `drag-start` | `idle`、`bubble`、`menu` | `dragging` |
| `drag-end` | `dragging` | `idle` |
| `cutout-open` | `idle` | `cutout` |
| `cutout-close` | `cutout` | `idle` |

有意不给 `bubble → dragging → bubble` 之类的回边：拖动一开始渲染层就 `hideBubble()` 了，
回来时按"再点一次"处理，状态不会自己复原。少一条边就少一种"我以为它还在"的 bug。

`transition(event)` 返回 `{ ok, prev, next, reason }`；`reason` 是 `illegal` / `unknown-event`。
非法事件不改状态、不抛异常，把 `{ event, from }` 记进 `lastIllegal` 并 `illegal++`，
`history` 留最近 20 条。这是故意的：状态机不能因为一次顺序错位就把桌宠弄死，
而这些计数会进诊断导出，用户报 bug 时能直接看到。

## 2. 接线

| 位置 | 改动 |
|---|---|
| `app/window-state.js`（新） | 127 行，无 Electron 依赖，smoke 直接 `require` |
| `app/main.js` | `const winState = createWindowState({ onChange, log })`；删除 `let petDragging`；`updatePetInteractive()` 改读 `winState.is('dragging')` |
| `app/main.js` IPC | `pet:bubble` → `bubble-show/hide`；`pet:menu` → `menu-open/close`；`pet:dragging` → `drag-start`，`false` 时守卫 `is('dragging')`；`pet:drag-end` 只存位置不再转移；`openCutout`/`cutoutWin.on('closed')` → `cutout-open/close` |
| `app/main.js` `app:status` | 新增 `window: { state, illegal, lastIllegal }` |
| `app/preload.js` | 新增 `setMenu(open)` → `pet:menu` |
| `app/pet.js` | `openMenu()` / `closeMenu()` 里各加一行 `api.setMenu(true/false)` |

`pet:dragging` 的 `false` 用 `is('dragging')` 守卫，是因为渲染层在 `endDrag` 里先发
`setDragging(false)`、再（只有真的移动过才）发 `dragEnd`——两个 IPC 都会走到"结束拖动"，
不守卫的话每次拖动都会多记一条非法转移。

## 3. 验证

### 静态

- `node tools/smoke.js` → **55 项**。新增：五态名单、**全矩阵**（5 状态 × 8 事件 = 40 组，
  每组先沿合法路径走到起点再触发）、非法计数与 `lastIllegal`、`unknown-event`、
  三条历史回归序列（气泡→菜单→拖→松、抠图进出）、`onChange` 只在合法转移触发、
  `main.js` 已接线且 `let petDragging` 已消失、`preload.setMenu` 存在。
- `npm run check` 把 `app/window-state.js` 加进 `node --check` 链。

### 运行时（Electron 44.9.0，CDP 9229，数据目录 `.dev-p11`）

| 场景 | 结果 |
|---|---|
| 连点气泡 20 次（间隔 60ms） | `windowSize` 一次没变（always `328×…`），`illegal 0`，结束时 `state=idle` |
| 40 次"点击 + 悬停菜单"混合 | `illegal 0`，每次都能走到 `menu` 再回 `idle` |
| 真实气泡高度 vs 预留（1/2/3/4 行与 120 字无标点五种文案） | 五种都是 **180px**，与 `sendRects` 的 `bubbleHeight` 完全一致 → 不再整窗 resize |
| 焦点 | 气泡/菜单全程 `showInactive`；抠图窗口 `focusable: false`，只有点"开始"才 `focus()` |

连点第 2 次之所以不变尺寸，还有个渲染层的细节：`showBubble` 在 `state.nonce` 相同时不重算几何，
所以第 2..N 次只是复位 `repeatWhileShown`，`setBubble(true, h)` 的 `h` 一样，主进程就不会动窗口。

## 4. 踩到的坑

1. **`setDragging(false)` 与 `drag-end` 双发**：一开始两个事件都直接 `transition('drag-end')`，
   跑完一轮拖动 `illegal` 就 +1。改成 IPC 侧守卫 + `drag-end` 只做落盘。
2. **抠图窗口原来抢焦点**：`showInactive()` 对 `focusable: true` 的窗口仍然会激活。
   要同时把 `focusable` 设成 `false`（打开前设，`ready-to-show` 里设已经晚了），
   再在"开始抠图"时显式 `focus()`——否则键盘快捷键全废。
3. **预加载断言写错**：smoke 里断定 `setMenu: (open) => ipcRenderer.send('pet:menu'`，
   实际是 `..., !!open)`。断言正则要贴住真实调用形状，不然测的是自己的想象。
4. **`petWin.getBounds()` 在窗口未显示时返回 `{0,0,0,0}`**：`savePosition()` 里加了 `isVisible()` 守卫，
   否则"托盘启动时隐藏"会把位置写成 0,0。
5. **真实气泡高度不等于"预留高度公式"是正常的**：预留是"内容区 700px 线宽换算"的上限，
   单行文案远小于它；验收看的是"不同文案不触发 resize"，不是"两者数值相等"。

## 5. 未做 / 下一段

- **真实鼠标**未测：CDP 的 `Input.dispatchMouseEvent` 走的是 Chromium 的真实输入管线（不是 JS 直接改
  class），但毕竟不是人手；托盘图标不显示的那台机器上只能这么验。真人一把拖动/连点建议留到发版前。
- `cutout-open` 目前只从 `idle` 进入。抠图窗口理论上也能从菜单开，但菜单打开时点不到"抠图"，
  所以没加 `menu → cutout` 的边；以后加"设置里抠图"时要补。
- P1-1 还剩阶段 2（`window.js`）与阶段 3（`pickDataDir/boot`）；状态机是阶段 2 的前置，
  窗口尺寸/位置那部分之后直接读 `winState` 而不是各自查布尔。