# M25 · 真机无障碍（P1-8）

> 2026-10-23 · 对应提交：`test(P1-8): 真机 a11y——200% 缩放留证、强制高对比度、无障碍树走查`
> 前置：[`A11Y-AUDIT.md`](A11Y-AUDIT.md)（0.5.5–0.6.5 的 92 项审计）、[`ROADMAP.md`](ROADMAP.md) P1-8。

## 1. 做了什么

| 维度 | 之前 | 现在 |
|---|---|---|
| 200% 缩放 | 只测了 320 CSS px 回流 | 真机 `--force-device-scale-factor=2`（dpr=2）跑四窗口，量溢出并留图 |
| 高对比度 | 只有 `onboard.css` 有 `forced-colors` 分支，其余窗口靠"应该没问题" | 四个 CSS 都补了分支；用 `--force-high-contrast` 实测计算色 |
| 读屏 | 只有 `a11y-audit.js` 的 AX 名称抽查 | 新增 `tools/a11y-tree.js`：整棵树的每个可交互节点都必须有名字 |
| 证据 | 没有截图 | `docs/a11y-shots/` 12 张（正常/高对比度 × 四窗口 + 200% × 四窗口） |

## 2. 设计决定

**"真机"不等于"改用户系统设置"。** 切 Windows 高对比度主题要改注册表并重启资源管理器，会影响用户正在用的桌面。
所以用 Chromium 自己的 `--force-high-contrast`：它让 `(forced-colors: active)` 命中、系统色替换生效，
足够验"我们的 CSS 在强制色下还看不看得见"。真主题下的观感（阴影/图片）留给人工，写进 `A11Y-AUDIT.md` §7.4。

**NVDA 没装，就用无障碍树验"读得出名字"。** 读屏软件读的是 Chromium 的 AX 树，`Accessibility.getFullAXTree`
拿到的是同一份数据；四个窗口 83 个可交互节点全部有名字，退出码非 0 即失败，可以进 CI。
"听读顺序/重复朗读"这类只有人能判断的，列成 §7.3 的手工清单——不假装已经验过。

**截图进仓库。** 12 张 PNG 合计约 1.1 MB，换来的是"下次改动前后能对比"。`tools/a11y-real.js` 一键重拍：
`node tools/a11y-real.js 9229 docs/a11y-shots -scale2`，tag 决定文件名后缀。

**云朵框必须 `forced-color-adjust: none`。** SVG 的 `fill/stroke` 不归系统调色板管，作者色（白底 `#FFFFFF`、深蓝描边 `#203170`）
在深色高对比主题里会和 `CanvasText` 撞成"黑底黑字"。`app/pet.css` 末尾钉死 `fill: Canvas; stroke: CanvasText`。

## 3. 验证

| 层面 | 手段 | 结果 |
|---|---|---|
| 200% 缩放 | `--force-device-scale-factor=2` + `tools/a11y-real.js … -scale2` | 四窗口 0 溢出（509×632 / 949×636 / 769×636 / 328×444） |
| 高对比度 | `--force-high-contrast`，读计算样式 | 媒体查询命中；`adjust: none`、`fill: rgb(255,255,255)`、`stroke: rgb(0,0,0)`；设置页 `outline: 2px Highlight` |
| 无障碍树 | `node tools/a11y-tree.js 9229` | 4 窗口 83 个可交互节点，0 个无名字 |
| 静态门禁 | `node tools/check-a11y.js` | 84 → **95** 项（+11：每文件 forced-colors 分支、系统色、云朵框钉色） |
| 运行时 | `a11y-audit` / `a11y-keyboard` | 86/0、6/6 |

## 4. 踩坑

**CDP 的 `Emulation.setEmulatedMedia` 只让媒体查询命中，不会真替换颜色。** 第一轮用它模拟 `forced-colors: active`，
截图和普通模式**逐字节相同**（sha256 一样）；`getComputedStyle(.card).borderTopColor` 却是黑色——说明只有标准属性被映射，
SVG 与渐变仍走作者色。要看到真实观感必须用 `--force-high-contrast` 启动，`setEmulatedMedia` 只能用来测"规则有没有命中"。

**改 CSS 后必须重启 Electron。** 第一次量计算样式时 `forced-color-adjust` 还是 `preserve-parent-color`，
因为跑的是加 CSS 之前起的实例；重启后才是 `none`。

**`node --check` 与 `check-a11y` 的计数口径不同。** `npm run check` 现在是 39 个文件（不是 35）；`check-a11y` 数的是
`PASS` 行，加了 11 条后是 95 项——文档里的数字要跟着实测改，别凭记忆写。

## 5. 没做 / 边界

- 没切真实的 Windows 高对比度主题（会动用户系统设置），见 §2；
- NVDA 的朗读顺序、重复朗读需要装读屏的机器人工过一遍（清单在 `A11Y-AUDIT.md` §7.3）；
- 没测触摸 + 读屏、语音输入、多显示器混合 DPI（`A11Y-AUDIT.md` §6 保留）。