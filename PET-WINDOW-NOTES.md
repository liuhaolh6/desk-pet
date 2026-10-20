# 桌宠窗口触摸按压屏闪（0.5.5）

> 日期：2026-10-21 · 版本：`0.5.5`（未签名）
> 现象：触摸按动桌宠时，偶尔整块桌宠窗口闪一下
> 影响范围：`app/pet.js`、`app/pet.css`、`app/main.js`（气泡预留高度）、`tools/smoke.js`

## 1. 结论（先说原因）

两个独立原因叠加，都在“透明窗口”上放大成可见屏闪：

1. **触摸按压误触发 hover 滤镜动画（主因，按压瞬间）**
   桌宠窗口是 `transparent: true`，`#pet` 上带 `filter: drop-shadow(...) brightness(1.02)`，并且原 CSS 写了 `transition: transform …, filter 0.18s`。
   触摸按压时 Chromium 会补发 `pointerenter`，`pointerType` 为 `'touch'`；而原来的代码无条件 `showHover()`，于是**按下的那一刻**开始 0.18 秒的 `filter` 过渡。
   每帧重新做一次 drop-shadow/composite，透明窗口在 Windows 上就会闪。鼠标没这个问题，因为按下前早就 hover 了，滤镜值没变化——这与“**触摸**按动才闪”完全吻合。

2. **气泡/菜单改窗口尺寸（次因，按下后约 1 秒）**
   气泡出现时 `main.js` 的 `applyBubbleHeight()` 会 `setBounds()` 把窗口向上长高（实测 `222 → 362`）。透明窗口的每次 resize 都可能闪一帧。
   而且原来**每张卡片高度不同就再 resize 一次**（`222 → 362 → 222 → 342 …`），所以是“有时”闪。

## 2. 证据

CDP 采样（开发版，`transparent: true`）：

- 触摸按压前后逐 30ms 采样，用 `Input.dispatchTouchEvent` 发真实触摸事件，并在页内记录 pointer 事件类型：
  ```
  events: wrap-pointerenter:touch, pointerenter:touch, wrap-pointerdown:touch, pointerdown:touch …
  ```
  说明触摸确实会触发 `pointerenter`（`pointerType === 'touch'`）。
- **修复前**：按压后立刻出现 `wrap=pet-wrap hover pressing`，随后连续采样到**插值中的 filter**：
  `drop-shadow(rgba(15,23,42,0.235) 0px 13.62px 21.43px) brightness(1.01811)` → 典型的 0.18s 滤镜动画，每帧重合成。
- **修复后**：触摸按压期间 `withHover=0`（32 个采样）、`filter` 始终是基础值、`pressing` 缩放反馈正常（`withPressing=4`）。
- 鼠标 hover 仍然生效（`wrap=pet-wrap hover`，filter 直接跳到 hover 值，**没有中间帧**）。
- 窗口尺寸：修复后统计全部采样，**气泡可见期间 resize 次数 = 0**；只在 `可见→隐藏`/`隐藏→可见` 时各一次。

## 3. 修复

| 位置 | 改动 |
|---|---|
| `app/pet.js` | `pointerenter`/`pointerleave` 增加 `pointerType === 'touch'` 判断，触摸不再触发 hover 外观；`☰` 菜单按钮的点击仍然主动 `showHover()`（菜单需要保持可见） |
| `app/pet.css` | `#pet` 的 transition 只保留 `transform`，去掉 `filter` 过渡：hover 阴影**瞬时切换**，不再逐帧重合成透明窗口 |
| `app/main.js` | `applyBubbleHeight()` 在气泡可见期间**只增不减**（`visible ? Math.max(cardHeight, extraBubbleHeight) : 0`）：同一串卡片高度不同也不再反复 resize；隐藏时一次性缩回。另在改尺寸前重新声明 `setBackgroundColor('#00000000')`，避免新露出的区域被窗口底色合成一帧 |
| `tools/smoke.js` | 新增静态回归断言（第 44 项）：触摸分支存在、`#pet` 不过渡 `filter`、气泡只增不减 |

**没有改**：气泡/菜单的窗口包裹策略（窗口仍只包住桌宠，不吞桌面点击）、拖拽、音效、Q 弹反馈、610 PNG 契约。

## 4. 验证

| 项 | 方式 | 结果 |
|---|---|---|
| 触摸不触发 hover | `Input.dispatchTouchEvent` + 页内 pointer 记录（`.tmp-verify/probe-touch.js`） | `touchAppliesHover=false`，`mouseHoverWorks=true` |
| 触摸按压仅缩放反馈 | `.tmp-verify/probe-flash-fix.js` | 32 采样 `withHover=0`、`baseFilterSeen=true` |
| 滤镜不再插值 | 同一脚本 | 鼠标 hover 直接到 `14px 22px` 值，`interpolatedFrames=0` |
| 气泡只增不减 | `window.deskPet.setBubble()` 直测（`.tmp-verify/probe-bubble.js`） | `220 → 520`（+300）、请求 120 **保持 520**、请求 420 → `640`、隐藏 → `220` |
| 气泡可见期间不 resize | 采样统计（`.tmp-verify/press-flash.json`） | `withinVisible=0` |
| 菜单 / 拖拽回归 | `.tmp-verify/probe-pet-regression.js` | 菜单开 `oh=428` → Esc 关 `oh=221`；拖拽 `(1196,653)→(1070,664)`、`dragging` 清理、拖拽不弹气泡、位置已写入 `settings.json` |
| 单元测试 | `node tools/smoke.js` | **44 checks passed** |
| 静态无障碍 | `node tools/check-a11y.js` | 通过（未受影响） |
| 解包版 / portable | 构建后 CDP | 见 §5 |

## 5. 产物

- `package.json` / `package-lock.json` → `0.5.5`；
- `dist/DeskPet-0.5.5-portable.exe`：153,075,231 字节，SHA-256 `0ddaa5bc55e6d1fc3be572003cadb25d86557ec036de362b949de02917331280`（该构建同时包含 `A11Y-AUDIT.md` 的无障碍修复）；
- `dist/win-unpacked/DeskPet.exe`：FileVersion `0.5.5`；
- 仍未签名。

## 6. 未覆盖 / 风险

- “屏闪”是 Windows 合成器/DWM 层面的现象，CDP 只能证明**触发条件被消除**（不再有滤镜动画、气泡可见期间不再 resize），无法逐帧证明桌面上的闪光消失。真实触摸屏（非 CDP 合成触摸事件）与不同显卡驱动仍需人工复验。
- 真正的物理触摸设备未在本机参与验证；CDP `Input.dispatchTouchEvent` 已确认会产生 `pointerType === 'touch'` 的事件，与真实触摸一致。
- 若在个别机器上“气泡首次长高”仍闪，下一步方案是**预留固定高度 + `setIgnoreMouseEvents(true, { forward: true })` 做命中转发**（窗口恒定尺寸，彻底没有 resize），代价是输入命中逻辑变复杂、透明区域要自己转发鼠标事件，需单独评估。
- 鼠标 hover 的阴影从 0.18s 渐变动画改为瞬时切换（视觉上是唯一的有意变化）。

## 7. 回滚

- `pet.js`：把三个 `hoverForPointer`/`leaveForPointer` 换回直接传 `showHover`/`hideHoverSoon`；
- `pet.css`：把 `filter 0.18s var(--ease-out)` 加回 transition；
- `main.js`：`normalized` 改回 `visible ? cardHeight : 0`；
- 三者互相独立，可单独回滚；`smoke.js` 的新断言需要同步删除。