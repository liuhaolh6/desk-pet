# 无障碍审计（WCAG 2.2 AA 可自动化部分）— 0.5.5

> 日期：2026-10-21 · 版本：`0.5.5`（未签名）
> 工具：`tools/a11y-audit.js`（CDP）+ `tools/check-a11y.js`（静态回归）
> 范围：`pet.html` / `cutout.html` / `settings.html`（7 个面板）/ `editor.html`（全部标签页）/ `onboard.html`（0.6.5 起）

## 1. 结论

- 首次审计（同一工具，`0.5.5` 修复前）**40 项检查中 10 项失败**；补齐面板/标签页遍历后共 **76 项**，再修完目标尺寸与名称问题，最终 **82 项全部通过**（含键盘-only 流程 6 项）。
- `0.6.5` 把首次欢迎卡（`onboard.html`）纳入审计，每个窗口 10 项，合计 **86 项 + 键盘流程 6 项 = 92 项，失败 0**。
- `0.6.6` 设置页新增「托盘和快捷键」「遇到问题」两段纯文本 + 一个导出按钮；静态断言加到 **57 项**，页面审计项数不变（settings 仍是 10 项 + 7 面板 ×3）。
- 修的都是真问题，不是把断言放宽：
  1. **次要文字对比度不足**：`--muted` `#7d89a5` 对 `--surface-3` 只有 **3.12:1**、对白 3.5:1 → 改为 `#5d6a86`（对 `#eef2fa` 4.83:1、对白 5.42:1）；
  2. **气泡默认文字色**：`bubble-model.js` 的天气提示/更新时间默认 `#8890a8` 对白 3.18:1 → 改 `#5d6a86`（同一处也是真实气泡的颜色，不只是编辑器预览）；
  3. **目标尺寸 <24×24（2.5.8）**：滑杆 16px 高、编辑器图标按钮 24×20、音效行复选框 13×16、编辑器 clear 按钮等 → 统一补 `min-height/min-width: 24px`；
  4. **音效面板控件没有可访问名称（4.1.2）**：每个事件的复选框/片段下拉/音量滑杆、总音量滑杆都是无名控件 → 补 `aria-label`；
  5. **`settings.css` 没有 reduced-motion**：29 个元素仍带过渡 → 四个窗口统一加 `prefers-reduced-motion` 全量规则；
  6. **编辑器 320px 回流（1.4.10）**：两栏网格横向溢出 639px → 窄屏改为单列堆叠；
  7. **桌宠菜单键盘不可达**：`☰` 只有 hover 才显示 → 增加 `.pet-wrap:focus-within .menu-btn`，键盘聚焦即显示（原先靠 `:focus-visible` 也能显示，但审计与视觉一致化）。

## 2. 方法与检查项（92 项）

先用 `--remote-debugging-port` 启动应用，然后跑两个工具（0.6.0 起拆开）：

```bash
node tools/a11y-audit.js --port 9229      # 86 项：结构 / 对比度 / 尺寸 / 焦点 / 回流 / forced-colors / reduced-motion
node tools/a11y-keyboard.js --port 9229   # 6 项：键盘-only 抠图流程（WCAG 2.1.1）
```

页面审计会用到视口与媒体模拟，模拟后第一次调用可能偏慢，所以键盘流程单独走一遍。

每个窗口都会跑：

| 检查 | 依据 | 做法 |
|---|---|---|
| AX 树可访问名称 | WCAG 4.1.2 | `Accessibility.getFullAXTree`，交互角色/`image` 节点必须有名字 |
| 文本对比度 | 1.4.3 | 遍历有直接文本的可见元素，向上找有效背景，按字号/字重判断 4.5:1 或 3:1 |
| 目标尺寸 ≥24×24 | 2.5.8 | 控件或它的 `label` 任一满足即可（复选框靠 label 达标） |
| 焦点可见性 / 顺序 | 2.4.7 / 2.4.3 | CDP 发真实 `Tab`，逐个检查 outline/box-shadow |
| 键盘-only 流程 | 2.1.1 | 由 `tools/a11y-keyboard.js` 单独执行：照片载入后全部用 `Enter`/`Escape` 完成：开始抠图 → 蒙版 → 结果 → 擦除 → 退出 → 保存（保存会关窗，关窗即成功） |
| 320px 回流 | 1.4.10 | `Emulation.setDeviceMetricsOverride(320)` 后不得横向滚动 |
| forced-colors | 1.4.11 参考 | 模拟 `forced-colors: active`，控件仍需可辨 |
| reduced-motion | 2.3.3 | 模拟 `prefers-reduced-motion: reduce`，不得有 >50ms 的过渡/动画 |

面板/标签页遍历：设置 7 个面板（外观/角色/气泡/提醒/天气/音效/其他）与编辑器全部标签页各自重复跑对比度、目标尺寸、可访问名称。

## 3. 最终结果

```
pet.html       10/10 PASS
cutout.html    10/10 PASS
settings.html  10/10 PASS + 7 个面板 ×3 项 PASS
editor.html    10/10 PASS + 标签页 ×3 项 PASS
onboard.html   10/10 PASS
键盘-only 流程  6/6 PASS
合计 **92 项（86 + 6），失败 0**
```

产物：`.tmp-verify/a11y-audit7.json`（开发版；打包版另跑一次，见 §5）。

## 4. 静态回归（CI）

`node tools/check-a11y.js` 现在有 **57 项**结构断言，覆盖本次修的东西，避免回退：

- `--muted`/`--ink-2` 对各浅色底的对比度（脚本内直接算 WCAG 比值）；
- 气泡默认文字色对白 ≥4.5；
- 四个 CSS 都有 `prefers-reduced-motion`；
- 滑杆/图标按钮/音效 label ≥24px；音效控件有 `aria-label`；
- `.pet-wrap:focus-within .menu-btn`；
- 首次引导卡（dialog 名称/Esc/按钮名称/焦点/forced-colors）；
- 托盘与快捷键状态行是纯文本、不 `aria-hidden`、走 `textContent`；导出按钮有名称、结果行不进 `aria-live`；
- 原有的 `lang`、`#previewAlt` live region、`aria-keyshortcuts`、按钮名称等。

CI（`.github/workflows/ci.yml`）跑 `node tools/check-a11y.js`；`tools/a11y-audit.js` 需要真实 GUI，不进 CI。

## 5. 打包版验证

`dist/win-unpacked/DeskPet.exe`（FileVersion `0.5.5`）用同一套脚本跑过 `node tools/a11y-audit.js --port 9230 --flow`：**82 项、失败 0**（含键盘-only 流程 6 项）。portable 与解包版同源。

- `dist/DeskPet-0.5.5-portable.exe`：153,075,231 字节，SHA-256 `0ddaa5bc55e6d1fc3be572003cadb25d86557ec036de362b949de02917331280`（未签名）。
- 开发版证据：`.tmp-verify/a11y-audit7.json`；打包版：`.tmp-verify/a11y-audit-pkg.json`。

## 6. 本环境**无法**验证的部分（不要当成已通过）

> P1-8 补上了其中三条的**可自动化部分**（200% 缩放实测、`forced-colors` 计算色、无障碍树走查），
> 详见 §7；下面保留的是仍然必须人工做的事。

1. **真实屏幕阅读器的朗读效果**（NVDA / Narrator / VoiceOver）：§7.3 证明了"每个可交互节点在无障碍树里都有名字"，
   但没有听读顺序、重复朗读、虚拟光标导航的实测。NVDA 未安装在本机，手工清单见 §7.3。
2. **真实高对比度主题**：§7.2 用的是 Chromium 的 `--force-high-contrast`（媒体查询命中、系统色替换生效），
   但**没有**切换 Windows 的"高对比度"开关（那会改用户系统设置，需要重启资源管理器）。
   阴影/图片可见性在真主题下的观感仍需人工确认。
3. **触摸 + 读屏组合、语音输入**：未测。
4. **气泡文字的实际可读性**：气泡背景是透明的，最终对比度取决于桌面壁纸；本轮只保证默认色对白 ≥4.5（`#5d6a86`），深色壁纸下仍可能需要阴影/底色（现有 `text-shadow` 是缓解而非保证）。
5. **动画内容**：`prefers-reduced-motion` 下已无 >50ms 过渡，但拖拽、flip、气泡出现是否在真实使用中引起不适，需要人工体验。
6. **自动化对比度算法的近似**：渐变/半透明背景按最近不透明祖先色估算；实际渲染可能有小幅差异。

## 7. 真机检查（P1-8）

### 7.1 200% 缩放

`--force-device-scale-factor=2` 启动（`devicePixelRatio === 2`，四窗口同一次运行），
用 `tools/a11y-real.js 9229 docs/a11y-shots -scale2` 量每个窗口的横向溢出：

| 窗口 | 视口（CSS px） | 横向溢出 | 截图 |
|---|---|---|---|
| 设置 | 509×632 | 0 | [settings-scale2-normal.png](docs/a11y-shots/settings-scale2-normal.png) |
| 编辑器 | 949×636 | 0 | [editor-scale2-normal.png](docs/a11y-shots/editor-scale2-normal.png) |
| 抠图 | 769×636 | 0 | [cutout-scale2-normal.png](docs/a11y-shots/cutout-scale2-normal.png) |
| 桌宠 | 328×444 | 0 | [pet-scale2-normal.png](docs/a11y-shots/pet-scale2-normal.png) |

判定口径：`document.documentElement.scrollWidth === innerWidth`，且任何元素 `getBoundingClientRect().right > innerWidth + 1` 都算溢出。
设置页在 200% 下仍然是一列卡片 + 可滚动内容区，没有横向滚动条（截图右侧的竖条是内容滚动条）。

### 7.2 高对比度

用 `--force-high-contrast` 启动（`matchMedia('(forced-colors: active)').matches === true`），
`node tools/a11y-real.js 9229` 会额外拍 `-forced-colors.png` 并打印关键计算值：

| 窗口 | 检查 | 计算值 |
|---|---|---|
| 设置 | 当前分类高亮 | `outline: 2px solid Highlight`（截图里"外观"外面那圈蓝框） |
| 设置 | 卡片分层 | `border: 1px CanvasText`（黑色边框），`background: Canvas` |
| 桌宠 | 云朵框 | `forced-color-adjust: none` · `fill: rgb(255,255,255)`(Canvas) · `stroke: rgb(0,0,0)`(CanvasText) |
| 抠图 | 舞台边框 | `border: 1px CanvasText`；回退态内阴影换成 `inset 0 0 0 2px CanvasText` |

截图：[settings-forced-colors.png](docs/a11y-shots/settings-forced-colors.png) ·
[pet-forced-colors.png](docs/a11y-shots/pet-forced-colors.png) ·
[editor-forced-colors.png](docs/a11y-shots/editor-forced-colors.png) ·
[cutout-forced-colors.png](docs/a11y-shots/cutout-forced-colors.png)

为什么云朵框要单独钉色：SVG 的 `fill/stroke` 不受系统调色板保护，作者色（白底深蓝描边）在深色高对比主题下
会和 `CanvasText` 撞成"黑底黑字"。`forced-color-adjust: none` + 系统色是唯一稳的写法（`app/pet.css` 末尾）。

### 7.3 无障碍树走查（代替 NVDA 脚本）

本机没有 NVDA（`C:\Program Files (x86)\NVDA\nvda.exe` 不存在），装了也无法在 CI 里"听"结果。
读屏软件最终读的是 Chromium 的无障碍树，所以改用 `node tools/a11y-tree.js 9229` 直接走 CDP
`Accessibility.getFullAXTree`：

| 窗口 | 可交互节点 | 没有名字的 | 角色分布（前几） |
|---|---|---|---|
| 桌宠 | 3 | 0 | button×3 · image×1 · StaticText×12 |
| 设置 | 15 | 0 | button×8 · LabelText×6 · paragraph×4 |
| 编辑器 | 55 | 0 | button×55 · heading×2 |
| 抠图 | 11 | 0 | button×9 · paragraph×4 · heading×3 |

脚本退出码非 0 表示有可交互节点读不出名字。**NVDA 手工清单**（有读屏的机器上补做）：

1. 启动 NVDA，`Ctrl+Alt+N` 读窗口标题，确认读作"桌宠设置"而不是"document"；
2. 设置页 `Tab` 走一遍：每个控件应读出"名称 + 角色 + 状态"，滑杆读出当前值；
3. 编辑器：`Tab` 到模块，听到"模块名 + 按钮"，`Ctrl+↑/↓` 应读出新位置；
4. 抠图：`Tab` 到"挑一张照片"，回车能打开文件框（这是读屏用户唯一的入口）；
5. 桌宠：`Tab` 应只到三个按钮（菜单/设置/退出），气泡出现时 `aria-live` 能读出新文案。

### 7.4 遗留

- 真高对比度主题（系统开关）下的观感、阴影/图片可见性；
- 深色壁纸上的气泡可读性（§6.4）；
- NVDA 的实际朗读顺序（§7.3 清单）。

## 8. 回滚

本次改动彼此独立：`--muted` 令牌、`bubble-model.js` 默认色、各窗口 `min-height`/`aria-label`、四个 CSS 的 reduced-motion、编辑器窄屏媒体查询、桌宠 `:focus-within`。逐项回滚即可；`tools/a11y-audit.js` 与 `tools/check-a11y.js` 是新增文件，删除即回滚审计能力。