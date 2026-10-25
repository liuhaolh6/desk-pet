# M34 · 悬停菜单被窗口剪掉：尺寸量在了缩放动画上

> 现象：`0.6.14` 里点桌宠头上的菜单按钮，菜单能弹出来，但下缘（有时还带右侧）被截掉一截，
> 五个按钮只有前几个完整。
> 根因：菜单面板量尺寸用的是 `getBoundingClientRect()`，量的时候面板正处在 `scale(0.96)` 的
> 收起态，报给主进程的尺寸小了一圈；主进程又拿「整窗比内容区大 6×7px」的固定常量去补窗框，
> 而窗口从隐藏变显示后高差会变成 17px。两个误差叠加，窗口比面板矮了 10 来像素。
> 结果：渲染层改量布局尺寸、主进程改成 `setContentBounds` + 渲染层实测校正后，CDP 验收 10/10 全过，
> 贴顶/贴右/右下角/重复打开都不再裁；unit **185** 例、smoke **67** 项、`npm run check`（51 文件）、
> check-a11y、check-i18n（30 文件 / 0 内联）全绿。

## 1. 现象与复现

用户报「菜单按钮展开的菜单不完整，有部分被截掉了」（0.6.14 便携版）。开发版同样能复现：

用 `.tmp/launch-p24s2.cmd` 起开发版（端口 9251、独立 `DESKPET_DATA_DIR`），
`.tmp/cap-menu.js` 先 `pointerenter` 再点 `#menuBtn`，等待 700ms 后连 overlay target 量：

```
innerW 202 · innerH 182            # overlay 窗口内容区
#petMenu rect 196 × 187 @ (6, 6)   # 面板实际布局尺寸
```

面板底边 6+187=193，窗口内容区只有 182——下缘 11px 在窗口外，被裁掉。

## 2. 两个根因

### 2.1 渲染层：`getBoundingClientRect()` 把缩放算进去了

`app/overlay.js` 的 `menuSize()` 原来这样量：

```js
const rect = menu.getBoundingClientRect()
const size = { width: Math.ceil(rect.width), height: Math.ceil(rect.height) }
```

但 `.pet-menu` 的收起态是 `transform: scale(0.96) translateY(10px)`，`getBoundingClientRect()`
返回的是**变换后**的尺寸：196×187 被量成 189×170（加载时字体还没落定，高度更小）。
主进程按 189×170 开窗，窗口天然比面板小。

### 2.2 主进程：窗框差不是常量

`app/main/overlay-menu.js` 里原来用一次「标定」记下 `frame = 整窗 - 内容区`，拿 6×7px 去补。
问题是这组差值在窗口隐藏态和显示态不一样：隐藏时高差 7px，显示后变 17px。标定又只在第一次
打开时做一次（且常在窗口还隐藏时跑），于是补少 10px。日志里能看到 `frame {x:0,y:0,width:0,height:0}`，
`setBounds` 拿到的就是「面板 + 12」的原值，最后落成内容区 202×182。

两个误差叠加的最终效果：面板 196×187 要 208×199 的内容区，实际只给了 202×182。

## 3. 修法

### 3.1 渲染层量布局尺寸

`app/overlay.js`：

```js
// offsetWidth/Height 是布局尺寸，不受 transform 影响
const size = { width: menu.offsetWidth, height: menu.offsetHeight }
```

并且 `openMenu()` 在加上 `.open` 之后（`requestAnimationFrame` 内）再 `reportMenuSize()` 一次，
多语言/字体落定后的真实高度也能补上。

### 3.2 主进程用 `setContentBounds` + 实测校正

`app/main/overlay-menu.js` 删掉 `frame` / `calibrate()`，改成：

```js
function apply(next, attempt) {
  const w = getWindow()
  w.setContentBounds({ x: next.x, y: next.y, width: next.width, height: next.height })
  verify(next, attempt)
}

function verify(next, attempt) {
  // 向渲染层要 [innerWidth, innerHeight, screenX, screenY]
  // 差多少补多少，最多三轮，容忍 1px 舍入
}
```

`setContentBounds` 由 Electron 自己换算窗框，不用再猜 6/7/17px；`verify` 再把「窗口实际画出来的
内容区」和「面板 + 12」对一次，位置（`screenX/Y`）也一起校。`open()` 里改成**先显示窗口再摆位**，
避免在隐藏态做换算。

### 3.3 翻到下方时同步 side

菜单翻到桌宠下方时，渲染层要按 `body[data-bubble-side="below"]` 换展开方向与尾巴朝向。
原来 `overlay.js` 的 `setSide` 只改主进程变量、不推给窗口，翻下去之后动画仍按「上方」展开。
现在 `setSide` 变化时调 `syncSide()` 发 `overlay:side`。

## 4. 验证证据

- CDP 验收 `.tmp/p24-verify.js menu`：**10/10 PASS**。菜单在窗口内（面板 196×187、窗口内容区
  208×200）、五项齐全、桌宠窗口 330×222 前后不变、设置/布置/喝水都到达、点项/Esc 收起、
  收到 `pet:menu-closed`。
- 摆位矩阵 `.tmp/p24-geom2.js` + `.tmp/probe-once.js`：中间-上方、贴顶-翻下方（`side=below`）、
  贴右夹取、右下角、同位置重复打开，全部「面板完整在窗口内 + 窗口内容区 = 面板 + 12 + 屏幕可用区内」。
- 屏幕级截图（`CopyFromScreen` 抓 overlay 窗口区域）：上方与下方两种摆位的五项按钮都完整可见，
  底部留白正常，不是「只在渲染层看着完整、合成时被剪」。
- 回归：`tools/smoke.js` 加两条断言（`offsetWidth/offsetHeight` 量尺寸、`setContentBounds` + 实测校正），
  防以后被改回 `getBoundingClientRect` 或固定窗框常量。

## 5. 教训

1. **不要用 `getBoundingClientRect()` 量「带着动画/缩放」的元素**：要布局尺寸就用
   `offsetWidth/offsetHeight`（或临时 `transform: none` 再量）。
2. **透明无边框窗口的窗框差不是常量**，且隐藏态与显示态不同；别拿一次标定当永久常量，
   用 `setContentBounds` 让 Electron 换算，再用渲染层实测兜底。
3. 菜单/气泡共用一扇窗时，**窗口尺寸要按当前内容重算**；`place()` 和 `setSize()` 都要走同一条
   「内容区 → 窗口」路径，别一个用 `setBounds`、一个用 `setContentBounds`。