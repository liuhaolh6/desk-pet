# M16 气泡手感：点击收起、空闲缩窗、命中区跟随云朵

> 版本 0.6.3 · 触发：用户反馈"穿透没了，桌宠依旧占一个矩形，我希望其气泡出来后点击它，会让气泡收起来"

## 1. 现象与真正的原因

三条反馈混在一起，先分别定位：

| 反馈 | 实测 | 结论 |
| --- | --- | --- |
| 穿透没了 | 真实光标 + `WindowFromPoint`：桌宠区 → 桌宠窗口，空白区 → 桌面 | 穿透没坏 |
| 桌宠依旧占一个矩形 | 空闲时窗口仍是「桌宠 + 一整块气泡高度」的透明区域 | 0.6.1 为了不闪，**常驻预留**气泡条 |
| 点击气泡没反应 | 气泡 `pointer-events: auto`，但没有任何 click 处理函数 | 点了确实什么都不会发生 |

另一条可能：用户手上跑的是 **0.6.0** 的 portable——那一版还没有穿透逻辑，整个窗口都吃鼠标。

## 2. 改法

### 2.1 空闲缩回桌宠大小

0.6.1 的常量预留换成了「要显示才预留」：

```
showBubble()  → state.wantBubble = true  → syncBubbleSpace() → resizeForBubble(bubbleReserve())
hideBubble()  → state.wantBubble = false → 520ms 后 resizeForBubble(0)
```

- 520ms 是收起动画的时长，动画播完再缩，避免缩窗把动画切掉。
- 同一串气泡里换卡片**不缩也不长**（`wantBubble` 仍为 true），所以链式切换依旧不闪。
- `state.wantBubble` 同时修掉一个竞态：窗口变高触发的 `resize` 事件可能在 `.show` 加上之前到达，
  `syncBubbleSpace()` 会误判"没气泡"把预留改回 0，气泡就被裁掉——现在以 `wantBubble` 为准。

### 2.2 点击气泡收起

```js
bubble.addEventListener('click', () => { if (state.menuOpen) return; hideBubble() })
```

点桌宠仍然是"换下一条"（`advance()`），两件事分开。气泡内容里如果以后加按钮，
按钮自己 `stopPropagation()` 即可。

### 2.3 命中区跟随云朵

窗口是矩形的，云朵不是。命中区从"整个气泡框"改成三条横带：

| 带 | 起点（占气泡高） | 宽度（占气泡宽） | 位置 |
| --- | --- | --- | --- |
| 上 | 0.05 | 0.74 | 居中 |
| 中 | 0.30 | 0.92 | 居中 |
| 下（带尾巴） | 0.55 | 0.20 | 居中 |

四角之外的透明区域还给桌面。量矩形要在 `.show` 之后（入场是 `scale(.7)→1`，动画中量到的偏小），
所以 `showBubble()` 里除了立即上报，还补一次 520ms 后的上报。

### 2.4 天气还没配置城市时说清楚

`weather.ok === false` 时以前渲染成一排 `—`（`🌤️ 天气一` / `今日 — · 降水 —`）。现在：

- 没城市：`🌤️ 天气` / `还没告诉我你在哪座城市呢`（`weather.message` 直出）
- 正在取：`🌤️ 天气` / `正在取天气…`
- 取到了：照常展开成 5~6 行

`resolveCard()` 多了一条剪枝：**一行里的动态模块全为空时整行丢掉**（不再出现"今日 · 降水"这种只有标签的行），
只剩连接符（`·`、`/`、`—`）的行也丢。

### 2.5 菜单不被裁切

`openMenu()` 预留 `max(气泡高度, 菜单高度)`；`syncBubbleSpace()` 在菜单打开时也按这个值预留，
否则窗口缩回后打开菜单会被切掉底部。

## 3. 验证

| 项 | 方法 | 结果 |
| --- | --- | --- |
| 命中区 | 真光标 + `WindowFromPoint`：气泡主体 → 桌宠窗口，气泡四角 → 桌面 | 通过 |
| 点击收起 | 真鼠标 `mouse_event` 点气泡正文 | 气泡收起，窗口 444 → 220，`--bubble-room` 归零 |
| 空闲尺寸 | CDP 读 `innerHeight` | 220（= 桌宠 220，无预留） |
| 卡片不裁切 | 打开气泡 / 打开菜单后量 `getBoundingClientRect()` | 气泡 316×215.6、菜单 187 高，均完整在窗口内 |
| 天气三态 | 无城市 / 加载中 / 衡阳市 18° 阴 | 三种文案都正确 |
| 冒烟 | `node tools/smoke.js` | **49 项通过**（新增 4 条：点击收起、命中区、缩窗、天气占位） |
| 静态无障碍 | `node tools/check-a11y.js` | 通过 |
| 动态无障碍 | `tools/a11y-audit.js` / `tools/a11y-keyboard.js` | **76/0** · **6/6** |

## 4. 风险与回滚

- 空闲缩窗意味着**每次说话窗口都要长高一次**。0.6.1 之所以常驻预留就是为了免这一步闪；
  现在用 520ms 的收起延迟 + 只在本串气泡结束时缩，正常链式切换看不到变化。真机上如果仍觉得闪，
  把 `hideBubble()` 里的 `resizeForBubble(0)` 换成 `resizeForBubble(bubbleReserve())` 就退回 0.6.1 的行为。
- 三条横带是近似：如果以后改了云朵 SVG，带子的比例也要跟着调（`reportHitRects()`）。
- 天气占位依赖 `weather.message`（主进程 `refreshWeather()` 给的 `NO_LOCATION` 文案），改文案只改那一处。

## 5. 相关文件

- `app/pet.js`：`wireBubbleClick`、`hideBubble`、`showBubble`、`syncBubbleSpace`、`reportHitRects`、`openMenu`
- `app/bubble-model.js`：`valueOf` 的 weather 分支、`resolveCard` 剪枝
- `app/pet.css`：`.bubble.show { pointer-events: auto; cursor: pointer }`
- `tools/smoke.js`：4 条新断言
## 6. 构建产物

| 文件 | 大小 | SHA-256 |
| --- | --- | --- |
| `dist/DeskPet-0.6.3-portable.exe` | 153,754,213 B | `83c2282506f77094fd298732b28f2503483fd4cb1ae1d5ef14dcf26fd7535a02` |

- `dist/win-unpacked/DeskPet.exe` 的 `FileVersion` = `0.6.3`、`ProductVersion` = `0.6.3.0`。
- 打包版实测：空闲 `innerHeight=220`、气泡展开 `444`、点气泡收起回 `220`，卡片文案与开发版一致。
- 打包版启动时**不要**带 `ELECTRON_RUN_AS_NODE`（会把 exe 当 node 跑，报 `bad option: --no-sandbox`）。

## 7. 0.6.4 修正：运行中不要再 resize

第 2 节那套"空闲缩回 220、点开长到 444"的做法，用户在用 0.6.3 的包时反馈**点桌宠有频闪**。原因很明确：

- Windows 上给 `transparent: true` 的窗口调 `setBounds`，新暴露出来的那一条会被合成一帧旧背景/黑色，
  看起来就是闪一下。0.6.1 之所以不闪，正是因为它**只预留一次、之后再也不改大小**。
- 0.6.3 把缩小加在了 `hideBubble()` 的 520ms 定时器里，于是每点一次桌宠（开→收起→再开）就 resize 两次，
  闪烁随之回来。

现在的做法（三条一起才成立）：

1. `app/main.js` `createPetWindow()` 里用 `bubbleReserveFor(windowWidth(size))` 算出预留高度，
   窗口**出生就是 `桌宠 + 预留`**，`winY = pos.y - reserve` 让桌宠留在原来的位置（并夹进工作区）。
   公式与 `app/pet.js` 的 `syncBubbleMetrics()`/`bubbleReserve()` 一致：
   `--bubble-w = clamp(220, innerWidth - 12, 340)`，高度 `w * 700 / 1026`，再 `+8`。
2. `app/pet.js` 里 `resizeForBubble(0)` 的调用全部删除；`syncBubbleSpace()`/`closeMenu()` 一律
   `resizeForBubble(bubbleReserve())`，`hideBubble()` 不再缩窗。`applyBubbleHeight()` 的 `changed` 判断因此
   永远为假，`setBounds` 一次都不会被调用。
3. 为了能证明"真的没 resize"，`resizeForBubble()` 在预留值变化时打 `bubble-resize`（`DESKPET_TRACE_BUBBLE=1`）。

验证脚本：`.tmp-verify/cdp-noresize.js`（连点 5 次 + 点气泡收起，断言 `innerHeight` 恒为 444 且
`bubble-resize` ≤1 条）、`.tmp-verify/cdp-idle-bounds.js` + `.tmp-verify/hit-test.ps1`（真光标 `WindowFromPoint`
 验证穿透）。

**新不变量**：只要气泡还没有显示，就绝不假设窗口可以改大小；要改之前先在 NOTES 里写明为什么不会闪。
