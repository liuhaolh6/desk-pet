# M14 气泡契约重做（0.6.1）

> 日期：2026-10-21 · 版本：`0.6.1`（未签名）
> 触发：用户反馈「文字超出气泡不改尺寸/位置偏/仍有掉帧」，并要求参考 `dsh-whale-widget`。
> 决策（用户拍板）：渲染走 **A 固定比例框 + 整体缩放**；窗口走 **① 固定预留、永不 resize**；
> 编辑器走 **② 保留行编辑、去掉拖拽与模块库**，并把喝水卡片内容做丰富。

## 1. 抄来的和没抄到的

`dsh-whale-widget`（`~/.dsh/profiles/desktop/node_modules/dsh-whale-widget/assets/whale-widget.js`）的泡泡是
**框驱动**的：

| 机制 | whale | 我们（0.6.0 及以前） |
|---|---|---|
| 形状 | `.dshwv-pop { aspect-ratio: 1026/700; width: 100% }`，`svg` 与框同比 | 同一个 1026×700 路径，但 `preserveAspectRatio="none"` **拉伸**填满文本框 |
| 文字位置 | `.dshwv-text` 放 `66%×64%` 安全区，中心由 `getBBox()` 实测写入 `--dshw-vx/--dshw-vy` | 靠硬编码 `padding: 6px 24px 54px` |
| 缩放 | 字号/行距用 `--dshw-u = base/1026`，与形状同一单位 | 固定 px，与形状无关 |
| 尺寸变化 | 不涉及窗口，整体等比缩放 | 每张卡高度不同 → 主进程 `setBounds` 改透明窗口 |
| 阴影 | 无 `filter`（靠 18 单位描边） | `filter: drop-shadow(...)` 在透明窗口上重绘 |

结论：外观和分批动效早就抄了，**布局契约没抄**，所以文字能溢出、位置会偏、每张卡还会 resize 触发闪烁。

## 2. 改法

1. **固定比例框**：`.bubble { width: var(--bubble-w); aspect-ratio: 1026/700 }`，SVG 去掉
   `preserveAspectRatio="none"`（`meet` 下与框完全吻合），云朵不再变形。
2. **实测居中**：`measureBubbleCentre()` 用 `getBoundingClientRect()` 取**屏幕上真实绘制**的云朵中心，
   写入 `--bubble-vx/--bubble-vy`。为什么不能用 `getBBox()`：这条路径含大圆弧 + 18 单位描边，
   几何 bbox 中心在 44.25%，而**实际画出来**的中心在 50%，两者差 18px —— 正是「文字总是偏一点」的根因。
3. **同比缩放 + 先换行后收缩**：模块字号在 `bubble-model` 里按 300px 参考宽书写，渲染时换算成
   `calc(var(--u) * N)`（`--u = 气泡宽 / 1026`）；长文本先 `white-space: normal` 换行，
   `fitBubbleText()` 再按 `scrollWidth/scrollHeight` 逐次收缩 `--bubble-fit`，因此**结构上不可能溢出**。
4. **固定预留、永不 resize**：`bubbleReserve()` 只与气泡宽（= 桌宠尺寸）有关；`showBubble` 每次调用
   `api.setBubble(true, reserve)` 但 reserve 恒定 → 主进程 `changed` 为 false → 不 `setBounds`；
   `hideBubble` 不再回缩（去掉 shrink 定时器）。这是「换卡闪烁」的最后一环。
5. **去掉气泡 `drop-shadow`**：透明窗口上做模糊阴影会重绘整条区域并出现彩色毛边；18 单位描边已足够分离。
6. **鼠标穿透**：窗口常驻一条透明气泡带，默认 `setIgnoreMouseEvents(true, { forward: true })`，
   渲染层按 `elementFromPoint` 命中桌宠/气泡/菜单时通过 `pet:interactive` 恢复可交互（拖拽中强制可交互）。

## 3. 喝水卡片

新增模块：`water.progress`（8 格 ●○）、`water.interval`（每 60 分钟）、`water.quiet`（安静 23 点到 8 点 /
不设安静时段）、`water.last`（上次 22:12 / 今天还没喝呢）、`water.tip`（按小时与杯数挑一句叮嘱）。
默认卡片从 2 行扩到 5 行：

```
💧 该喝水啦
●●●○○○○○ 今天第 3 杯
再过 42 分钟
每 60 分钟 · 安静 23 点到 8 点
慢慢喝，别急呀
```

## 4. 气泡布置

- 去掉：`⠿` 拖拽排序、圆点/行内拖放插入、模块库（我的收藏）与其「存入库」按钮、相关 CSS。
- 保留：卡片标签、一键预设（简洁/标准/详细）、行 ↑↓ 换序、行内 ＋×、模块选单（分组）、
  「再调调样式」（字号/字形/颜色/底色）、预览、保存/还原/关闭。
- 修：文字模块的 chip 副标题原本重复显示正文，改为固定「写好的文字」；chip 变成
  `role="button"` + 24px 最小高度（WCAG 2.5.8）。

## 5. 验证

| 项 | 结果 |
|---|---|
| `npm test` | **48 checks**（新增：固定比例、禁 `preserveAspectRatio=none`、实测居中、超框收缩、固定预留、穿透、喝水 7 模块与 5 行卡片） |
| `node tools/check-a11y.js` | 通过 |
| CDP 气泡契约测试（`.tmp-verify/cdp-bubble.js`） | aspect=1.466、三张卡 `overflow 0/0`、文字与云朵中心差 ≤0.1px、`viewport` 与气泡尺寸在换卡时不变 |
| CDP 编辑器测试 | 预设 6→2/10→6、分组 写点什么:3 天气:16 **喝水:7** 时间:2、样式默认折叠、保存提示正常 |
| `tools/a11y-audit.js` | **76 项 0 失败** |
| `tools/a11y-keyboard.js` | **6/6** |
| 长文本 | 30 字中文在 316px 气泡内换行显示，`overflow 0`，`--bubble-fit` 保持 1 |

## 6. 未验证 / 风险

- **鼠标穿透与拖拽手感**：自动化只能确认 IPC 存在，无法真机验证「指针快速甩出桌宠时仍不断拖」。
  已做的保护：拖拽期间（`.pet-wrap.dragging`）强制可交互。需要你上手拖几次确认。
- 两个小尾巴仍是 whale 原样的「思考泡泡」散点，若你觉得离得太开，可以调 `.bubble-b1/b2` 的 `cy`。
- 气泡宽度上限 340px / 下限 220px；超长文案会先换行再缩字号，缩到 0.45 倍为止（极端情况会更小）。
- 未改模型、未改 610 PNG 契约、未引入联网依赖。