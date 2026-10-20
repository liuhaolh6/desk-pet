# 桌宠窗口渲染问题记录（0.5.5 / 0.5.6）

> 日期：2026-10-21 · 版本：`0.5.5`（屏闪）、`0.5.6`（点击/拖动缩放虚影与卡顿）
> 现象 1：触摸按动桌宠时，窗口偶尔闪一下
> 现象 2：点击桌宠时出现一两帧放大/缩小的虚影，拖动/交互显得卡顿
> 影响范围：`app/pet.js`、`app/pet.css`、`app/main.js`、`lib/store.js`、`tools/smoke.js`

## 1. 0.5.6：点击缩放虚影与拖动卡顿

### 1.1 结论

点击时的“放大/缩小的虚影”是**三个因素叠加**，全部可量化：

1. **弹簧缓动的过冲**：`#pet` 用 `--ease-spring` = `cubic-bezier(0.34, 1.3, 0.6, 1)`，进度会冲到 ~1.3，于是缩放**越过目标值**——实测 hover 稳定值 1.030 会出现 **1.034** 的帧，按下的 0.90 会掉到 **0.877**。这就是“一两帧放大/缩小”的虚影。
2. **过渡太快 + 中途反向**：按压过渡只有 `0.06s`（≈3～4 帧走完 12% 的压缩），而 `endDrag` 又把 `pressing` 强制保持 36ms，于是回弹从动画中途接管 —— 实测每帧缩放跳 **4%～5%**（`1.030 → 0.914 → 0.877 → 0.922 → 0.958 → 0.998 → 1.015`），肉眼就是拖影/卡顿。
3. **`filter` 与 `will-change: transform` 同层**：`#pet` 同时带 `filter: drop-shadow(...)` 和 `will-change: transform`，缩放时 Windows 合成器复用旧光栅再拉伸，产生模糊残影。

### 1.2 实测（CDP 逐帧采样 `getComputedStyle(#pet).transform`）

| 指标 | 修复前 | 修复后 |
|---|---|---|
| 缩放范围 | 0.877 ~ **1.034**（双向越界） | **0.900 ~ 1.030**（不越界） |
| 按压帧数 | 3 帧 | 6～7 帧（≈110ms，走完再回弹） |
| 单帧缩放变化 | ~4%～5%（最大 12%） | ~1.5%～2% |
| `filter` 计算值种类 | 随 hover 变化 | 恒定（不再随缩放重合成） |
| hover 上升沿 | 1.000 → … → 1.030 → **1.034** | 1.000 → … → 1.030（单调） |

### 1.3 修复

| 位置 | 改动 |
|---|---|
| `app/pet.css` | `#pet` 改用单调的 `transition: transform 0.16s var(--ease-out)`，**不再用会过冲的 `--ease-spring`**；`drop-shadow` 移到外层 `.pet-flip`（只包住精灵、不含菜单），被缩放的精灵本身**不再带 `filter`**；按压改为 `1.04 / 0.90`、`transition-duration: 0.11s`；`.pet-flip` 镜像过渡也换成 `--ease-out` |
| `app/pet.css` | `.pet-wrap.dragging #pet { transition: none }`：拖动时倾斜角**立刻跟手**（原来的 `0.08s linear` 会滞后一帧，看起来就是卡顿） |
| `app/pet.js` | 按压保持时间 36ms → **110ms**，让单调过渡走完再回弹；拖动 IPC 用 `requestAnimationFrame` **按帧合并**（`queueDrag`/`flushDrag`），结束时把未发送的位移一次性补发，窗口不会落后一帧 |
| `lib/store.js` | `readSettings()` 加缓存：拖动时每帧都要读设置（`pet:drag` + `petTopLeft()` 各一次），原来是 **175µs/次** 的同步读盘 + 解析 + 深合并，现在是 **0.20µs/次**（约 875×）；`writeSettings()` 立即失效，外部手改 `settings.json` 仍在 1 秒内被读到 |
| `app/main.js` | `pet:drag` 增加 `DESKPET_TRACE_DRAG=1` 的按需计数日志（默认关闭、零开销），用于验证窗口移动次数 |
| `tools/smoke.js` | 新增静态回归：`#pet` 不用 `ease-spring`、只过渡 `transform`、自身无 `filter`、阴影在 `.pet-flip`、拖动有 `requestAnimationFrame(flushDrag)`、按压保持 110ms、`store` 有 `settingsCache` |

### 1.4 验证

- `node .tmp-verify/probe-scale.js`：逐帧缩放序列 `1.030 → 0.979 → 0.942 → 0.921 → 0.909 → 0.903 → 0.900 → 0.937 → 0.967 → 0.990 → 1.005 → 1.015 → 1.022 → 1.026 → 1.029 → 1.030`，无越界、无反向尖峰。
- `lib/store.js` 缓存：3000 次 `readSettings()` 从 **526ms → 0.6ms**；外部改动 1s 内可见、写入立即生效。
- 回归（`.tmp-verify/probe-touch.js`、`probe-pet-regression2.js`、`probe-drag.js`）全部通过：触摸不触发 hover、鼠标 hover 正常、菜单（触摸与鼠标）可开、拖动落点正确并持久化。
- `node tools/smoke.js` → **44 checks passed**；`node tools/check-a11y.js` 通过；`node tools/a11y-audit.js --port 9231 --flow` → **82 项、失败 0**（pet 改动没有回退无障碍基线）。
- 三端逐帧复测（用 `PROBE_PORT` 指定端口，避免连错应用——变体脚本的 `sed` 端口替换曾失效过一次）：

  | 构建 | 缩放范围 | 按压帧数 | 触摸不触发 hover | 菜单/拖动 |
  |---|---|---|---|---|
  | 开发版（9229） | 0.900 ~ 1.030 | 6～7 | ✅ | ✅ |
  | 解包版（9230） | 0.900 ~ 1.030 | 7 | ✅ | ✅ |
  | portable（9231） | 0.900 ~ 1.030 | 7 | ✅ | ✅ |
- 产物：`dist/DeskPet-0.5.6-portable.exe`，153,075,790 字节，SHA-256 `f82a65215c3e6b63eb66338b113d5237b93c69da35dae9038541e4ae23b90c29`（未签名）。

### 1.5 未覆盖 / 风险

- CDP 只能证明**触发条件消失**（无过冲帧、每帧步长变小、`filter` 恒定），桌面实际观感仍需真机确认。
- 用 CDP 合成指针测「按帧合并」的比率不可靠：Chromium 按帧调度输入，且合成事件用 client 坐标、窗口一移动坐标就漂移（会测出位移放大的假象）。合并的收益主要针对高回报率鼠标/事件突发；本机实测仍是每帧一次窗口移动。
- 拖动的位移放大**不是**产品缺陷，是 CDP 合成输入的假象；真实鼠标用绝对屏幕坐标。
- 阴影移到 `.pet-flip` 后，按下时阴影**不再随精灵一起缩放**（视觉上阴影恒定）——有意取舍。

### 1.6 回滚

`#pet` 的 `filter` 与 `--ease-spring`、36ms 按压保持、拖动 `api.drag` 直发、`store.readSettings()` 的无缓存版本，均可单独回滚；`smoke.js` 的新断言需同步删除。

## 2. 0.5.5：触摸按压屏闪

### 2.1 结论（先说原因）

两个独立原因叠加，都在“透明窗口”上放大成可见屏闪：

1. **触摸按压误触发 hover 滤镜动画（主因，按压瞬间）**
   桌宠窗口是 `transparent: true`，`#pet` 上带 `filter: drop-shadow(...) brightness(1.02)`，并且原 CSS 写了 `transition: transform …, filter 0.18s`。
   触摸按压时 Chromium 会补发 `pointerenter`，`pointerType` 为 `'touch'`；而原来的代码无条件 `showHover()`，于是**按下的那一刻**开始 0.18 秒的 `filter` 过渡。
   每帧重新做一次 drop-shadow/composite，透明窗口在 Windows 上就会闪。鼠标没这个问题，因为按下前早就 hover 了，滤镜值没变化——这与“**触摸**按动才闪”完全吻合。

2. **气泡/菜单改窗口尺寸（次因，按下后约 1 秒）**
   气泡出现时 `main.js` 的 `applyBubbleHeight()` 会 `setBounds()` 把窗口向上长高（实测 `222 → 362`）。透明窗口的每次 resize 都可能闪一帧。
   而且原来**每张卡片高度不同就再 resize 一次**（`222 → 362 → 222 → 342 …`），所以是“有时”闪。

### 2.2 证据

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

### 2.3 修复

| 位置 | 改动 |
|---|---|
| `app/pet.js` | `pointerenter`/`pointerleave` 增加 `pointerType === 'touch'` 判断，触摸不再触发 hover 外观；`☰` 菜单按钮的点击仍然主动 `showHover()`（菜单需要保持可见） |
| `app/pet.css` | `#pet` 的 transition 只保留 `transform`，去掉 `filter` 过渡：hover 阴影**瞬时切换**，不再逐帧重合成透明窗口 |
| `app/main.js` | `applyBubbleHeight()` 在气泡可见期间**只增不减**（`visible ? Math.max(cardHeight, extraBubbleHeight) : 0`）：同一串卡片高度不同也不再反复 resize；隐藏时一次性缩回。另在改尺寸前重新声明 `setBackgroundColor('#00000000')`，避免新露出的区域被窗口底色合成一帧 |
| `tools/smoke.js` | 新增静态回归断言（第 44 项）：触摸分支存在、`#pet` 不过渡 `filter`、气泡只增不减 |

**没有改**：气泡/菜单的窗口包裹策略（窗口仍只包住桌宠，不吞桌面点击）、拖拽、音效、Q 弹反馈、610 PNG 契约。

### 2.4 验证

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

### 2.5 产物

- `package.json` / `package-lock.json` → `0.5.5`；
- `dist/DeskPet-0.5.5-portable.exe`：153,075,231 字节，SHA-256 `0ddaa5bc55e6d1fc3be572003cadb25d86557ec036de362b949de02917331280`（该构建同时包含 `A11Y-AUDIT.md` 的无障碍修复）；
- `dist/win-unpacked/DeskPet.exe`：FileVersion `0.5.5`；
- 仍未签名。

### 2.6 未覆盖 / 风险

- “屏闪”是 Windows 合成器/DWM 层面的现象，CDP 只能证明**触发条件被消除**（不再有滤镜动画、气泡可见期间不再 resize），无法逐帧证明桌面上的闪光消失。真实触摸屏（非 CDP 合成触摸事件）与不同显卡驱动仍需人工复验。
- 真正的物理触摸设备未在本机参与验证；CDP `Input.dispatchTouchEvent` 已确认会产生 `pointerType === 'touch'` 的事件，与真实触摸一致。
- 若在个别机器上“气泡首次长高”仍闪，下一步方案是**预留固定高度 + `setIgnoreMouseEvents(true, { forward: true })` 做命中转发**（窗口恒定尺寸，彻底没有 resize），代价是输入命中逻辑变复杂、透明区域要自己转发鼠标事件，需单独评估。
- 鼠标 hover 的阴影从 0.18s 渐变动画改为瞬时切换（视觉上是唯一的有意变化）。

### 2.7 回滚

- `pet.js`：把三个 `hoverForPointer`/`leaveForPointer` 换回直接传 `showHover`/`hideHoverSoon`；
- `pet.css`：把 `filter 0.18s var(--ease-out)` 加回 transition；
- `main.js`：`normalized` 改回 `visible ? cardHeight : 0`；
- 三者互相独立，可单独回滚；`smoke.js` 的新断言需要同步删除。