# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 的组织方式，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

格式说明：`新增` / `修复` / `文档` / `打包`。每一条都对应仓库里的提交与 `*-NOTES.md` 记录。

## [Unreleased]

- 计划中的工作与现有不足的完整清单见 [`ROADMAP.md`](ROADMAP.md)（成熟度评分、P0–P3 方向、未来展望）；
  机制细节与踩坑记录见 [`HANDOFF.md`](HANDOFF.md)。

## [0.6.4] - 2026-10-22

把 0.6.3 带回来的频闪修掉，同时保留 0.6.3 的手感改进。

### 修复
- **点桌宠又闪了**：0.6.3 为了不"占一个矩形"，让窗口在空闲时缩回桌宠大小、点开气泡再长高——透明窗口在运行中
  改大小，Windows 会先合成一帧旧背景，看起来就是闪一下。现在窗口**一创建就带着气泡预留那一块**（高度 = 桌宠 +
  气泡条），运行过程中再也不改窗口大小：点桌宠、换卡片、点气泡收起、开关菜单（菜单不高于气泡时）都不会闪。
- 预留的那一块依旧完全透明，并且**光标不在桌宠/气泡上时是穿透的**（主进程每 50ms 按命中区翻
  `setIgnoreMouseEvents`），所以不会回到"看不见但吃鼠标的矩形"。
- 启动时不再出现"先 220 高、再长到 444"的跳动：窗口出生即 `桌宠 + 预留`，桌宠仍停在原来的位置。

### 验证
- CDP 连点桌宠 5 次 + 点气泡收起：`innerHeight` 全程 444，`bubble-resize` 打点一条都没有（`resizeForBubble` 只在
  预留值真的变化时打点，说明 `setBounds` 从未被调用）。
- 真实光标 + `WindowFromPoint`：光标离开桌宠 → 预留条与桌宠都解析到 `DESKTOP`（穿透）；光标在桌宠上 → `PET`。
- `node tools/smoke.js` **49 项**、`node tools/check-a11y.js` 通过、`tools/a11y-audit.js` **76/0**、
  `tools/a11y-keyboard.js` **6/6**。

## [0.6.3] - 2026-10-22

按你的反馈把气泡的"矩形占位"和"点了没反应"一起处理掉。

### 修复
- **点击气泡就收起**。以前气泡虽然能点（`pointer-events` 是开的），但没有任何处理函数，点上去什么也不会发生，
  感觉像点在了空气上。现在点气泡正文（或里面的"知道啦/待会儿"按钮之外的地方）直接把气泡收起来；
  点桌宠仍然是"换下一条"。
- **不显示气泡时窗口缩回桌宠大小**。0.6.1 为了不闪，一直预留着一整块气泡高度的透明区域——那就是你看到的
  "依旧占一个矩形"。现在空闲时窗口只有桌宠那么大，点开气泡才长高，收起 0.5 秒后缩回；同一串气泡里的
  卡片切换仍然不改变窗口大小（不会闪）。
- **气泡的点击区跟着云朵走**。命中区用三条横带近似云朵轮廓，云朵四个角外面的透明区域点下去会直接穿透到桌面，
  而不是被一个看不见的矩形吃掉。
- **天气还没配置城市时说实话**：气泡里显示"还没告诉我你在哪座城市呢"，不再是一排"—"或者一直"正在取天气…"；
  天气在加载时卡片只留一行"正在取天气…"，取到后再展开成完整几行（不再出现"今日 — · 降水 —"）。
- 菜单展开时按"气泡高度 / 菜单高度取较大者"预留，窗口缩回后打开菜单不会被裁切。

### 验证
- 真实光标 + `WindowFromPoint`：气泡主体 → 桌宠窗口（可点），气泡四角 → 桌面（穿透）；光标移开桌宠后窗口整体穿透。
- 真实鼠标点击气泡 → 气泡收起、窗口从 444 缩回 220；CDP 复核 `--bubble-room` 归零。
- `node tools/smoke.js` **49 项**（新增"天气未加载占位""空行剪枝"断言）、`node tools/check-a11y.js` 通过、
  `tools/a11y-audit.js` **76/0**、`tools/a11y-keyboard.js` **6/6**。

## [0.6.2] - 2026-10-22

修掉鼠标穿透的漏判、气泡在屏幕边缘翻到下方、以及城市搜索"点了没反应"。

### 修复
- 鼠标穿透改为**主进程按光标位置轮询**（渲染层上报桌宠/气泡/菜单的矩形）。以前靠渲染层 `mousemove`，
  切换到穿透后的第一次移动可能收不到，桌面上的光标滑过桌宠却仍是穿透态——这就是"有时候点不了"。
  现在 50ms 一次 `getCursorScreenPoint()` 判定，进出都稳定；拖拽期间强制可交互。
- 气泡**永远在桌宠上方**：不再因为靠近屏幕顶部就翻到下方；空间不够时把桌宠下移，桌宠与屏幕边界之间
  始终保留一整块气泡高度。拖拽也有同样的下限，不会被拖进气泡预留区。
- 城市搜索的反馈不再一闪而过：「我找找看…」会一直挂着，找到后显示"找到 N 个地方，点下面那一行就用它"，
  选中后显示"记住啦：衡阳市 · 湖南，正在换天气…"；天气面板常驻一行"现在用的是：衡阳市 · 湖南（26.89, 112.62）"。
- 换城市后天气卡会立即重绘（原来只在下次点击时才更新，看起来像"一直是北京"）。

## [0.6.1] - 2026-10-21

气泡按 `dsh-whale-widget` 的布局契约重做，并精简气泡布置。

### 修复
- 文字不再超出气泡：气泡框固定 1026:700 比例、云朵不再被拉伸；模块字号按 `--u` 同比缩放，长文本先换行、
  必要时再按比例收缩。
- 文字不再偏心：坐标改用**屏幕上实际绘制**的云朵中心（几何 bbox 与绘制中心相差 18px，是偏移的根因）。
- 换卡不再闪烁：气泡区域固定预留，卡片切换不再改透明窗口尺寸；同时去掉气泡的 `drop-shadow`
  （模糊阴影在透明窗口上重绘并产生彩色毛边）。
- 常驻透明气泡带默认鼠标穿透，指针移到桌宠/气泡/菜单上时自动恢复可交互。

### 变更
- 喝水卡片内容扩充：今日进度（8 格）、下次提醒、提醒间隔、安静时段、上次喝水时间、一句随时段变化的叮嘱。
- 气泡布置精简：去掉拖拽排序、圆点插入与「我的收藏」；保留预设、行换序/增删、模块选单与「再调调样式」。
- 文字模块的标签不再重复显示正文；气泡里的模块小块变成可聚焦按钮并满足 24×24 目标尺寸。

### 细节
- 做法、验证与风险见 [`M14-NOTES.md`](M14-NOTES.md)。

## [0.6.0] - 2026-10-21

体验升级：形象、说话方式、天气与视觉一起改，功能不减。

本机构建：`dist/DeskPet-0.6.0-portable.exe`（153,754,355 字节，SHA-256 `3e78adf200c71d2473ad18899e3283ad5b579f241eb9f51e6924e406f1c90ca8`）；细节与未覆盖项见 [`M13-NOTES.md`](M13-NOTES.md)。

### 新增
- 应用图标、托盘图标与默认形象改为指定照片（`tools/make-assets.py --photo`，含预乘 alpha 还原与圆形徽标生成）。
- 内置温馨提示 6 → **24 条**，改成对爱人说话的温柔活泼口吻。
- 天气新增：体感温度、风速、紫外线、日出日落、明天、未来 6 小时，以及一句「贴心提醒」（带伞 / 加外套 / 防晒 / 路滑慢走…）；断网时用最近缓存并补算提醒。
- 气泡新增 7 个天气模块与「贴心提醒 / 未来几小时」收藏项；数值缺失不再显示 `null`。

### 变更
- 四个窗口的文案改成温柔、通俗的说法（设置 / 抠图 / 气泡布置 / 托盘与提醒），技术词（冷却、间隔、强度…）换成日常表达。
- 配色改为照片里的粉 + 奶油色系（新增 `--blush` / `--cream` 系列 token），圆角与阴影更柔和；设置窗口当前分类带粉色标记，品牌图标改为圆形。
- 气泡布置简化：一键「简洁 / 标准 / 详细」预设；模块选单按 写点什么 / 天气 / 喝水 / 时间 分组；字号、字形、颜色、底色折叠进「再调调样式」。

### 修复
- 角色图库的「删掉」按钮目标尺寸 30×16 → ≥24×24（WCAG 2.2 AA 2.5.8）。
- 内置形象与照片角色不再叠加 drop-shadow：柔边会把阴影透成深色描边。

## [0.5.8] - 2026-10-21

仓库与发布工程化版本，应用行为与 0.5.7 一致（无障碍修复来自 0.5.5）。

已发布：[`v0.5.8`](https://github.com/liuhaolh6/desk-pet/releases/tag/v0.5.8) 由 CI 构建，产物 `DeskPet-0.5.8-portable.exe`（153,074,476 字节，SHA-256 `cadd1b0bde5ddcca6eea6c539eedfbecc0908f248727015395cb6d85025edec3`）与 `SHA256SUMS.txt`。

### 新增
- GitHub Release 自动化：[`.github/workflows/release.yml`](.github/workflows/release.yml) 在推送 `v*` tag 时跑检查、构建 portable 产物、生成 `SHA256SUMS.txt` 并创建 Release。
- 协作文档与模板：[`CONTRIBUTING.md`](CONTRIBUTING.md)、[`SECURITY.md`](SECURITY.md)、[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)、[`CHANGELOG.md`](CHANGELOG.md)、Issue 表单、PR 模板、[`.github/CODEOWNERS`](.github/CODEOWNERS)、[`.editorconfig`](.editorconfig)、Dependabot 配置。
- README 增加 CI / Release / License / Platform 徽章、下载说明与文档索引；`package.json` 补 `repository` / `homepage` / `bugs` / `engines` 与关键词。

### 变更
- CI 与 Release 工作流都会先跑 `npm run check`、`npm test`、`node tools/check-a11y.js` 再打包，避免发布未验证产物。
- Release 工作流改用 64 位 NSIS 编译器构建 portable（默认 32 位 `makensis` 对 ~170MB 载荷会 mmap 失败，见 [`M6-PACKAGING.md`](M6-PACKAGING.md) §3.2），并支持 `workflow_dispatch` 手动重跑；构建失败时自动开 Issue 附日志。

## [0.5.7] - 2026-10-21

### 修复
- 气泡加高时不再把桌宠顶走：顶部边界 clamp，气泡改到桌宠下方并记录 `petPos`，气泡收起后桌宠回到原位。
- 相关静态回归加入 `tools/smoke.js`；细节见 [`PET-WINDOW-NOTES.md`](PET-WINDOW-NOTES.md)。

## [0.5.6] - 2026-10-21

### 修复
- 点击时的缩放不再过冲（按压反馈的合成与回弹对齐）。
- 拖动改为按帧合并 `setPosition`，减少 IPC 抖动。
- `lib/store.js` 增加 settings 读取缓存，降低高频读取开销。

## [0.5.5] - 2026-10-21

### 修复
- 触摸按压桌宠不再触发 hover 滤镜动画：透明窗口上逐帧重合成会导致可见屏闪；触摸后有 900ms 忽略 Chromium 补发的兼容鼠标事件。
- 气泡可见期间窗口尺寸只增不减，隐藏时一次性缩回，避免同一串卡片反复 resize。

### 新增
- 完整的无障碍审计（可自动化部分）：[`tools/a11y-audit.js`](tools/a11y-audit.js) 对宠物 / 抠图 / 设置（7 个面板）/ 气泡编辑器（全部标签页）跑 82 项检查，含键盘-only 抠图流程，开发版与打包版均 0 失败；报告见 [`A11Y-AUDIT.md`](A11Y-AUDIT.md)。

### 修复（无障碍）
- 次要文字 `--muted` 对浅色底从 3.12:1 提到 4.83:1；气泡天气提示/更新时间默认色从 3.18:1 提到 4.83:1。
- 滑杆、图标按钮、复选框 label 等目标尺寸补齐 ≥24×24（WCAG 2.2 AA 2.5.8）。
- 音效面板动态控件补 `aria-label`（4.1.2）。
- 四个窗口统一 `prefers-reduced-motion`；气泡编辑器 ≤720px 单列回流（1.4.10）；桌宠 ☰ 菜单可被键盘聚焦显示。

## [0.5.4] - 2026-10-21

### 新增
- 抠图 token IPC：原图留在主进程，渲染层只拿 token + ≤1200px 预览，25MB 照片不再往返渲染进程。
- 抠图画布 `aria-live` 文本替代、`Q`/`W` 旋转与 `F` 翻转快捷键、进出修补模式的焦点管理。
- 仓库基线：`.gitattributes`、[`MODEL-ASSETS.md`](MODEL-ASSETS.md)、`npm run check`、CI 增加合成图与真实模型正/负例断言。

### 文档
- 新增 [`M12.4-NOTES.md`](M12.4-NOTES.md)。

## [0.5.3] - 2026-10-21

### 新增
- 抠图重活移入 Electron `utilityProcess`：推理 / 蒙版 / 合成 / PNG 编码都在 worker，抠图中主进程 IPC 往返 max 5–7ms（进程内对照 644ms）；worker 失败自动退回进程内。
- 边缘去色污：羽化过渡带取最近主体色，红主体/绿背景的绿色边缘像素 12 → 0。

### 修复
- 照片角色阴影降级；修复保存新角色后桌宠不刷新（`app/pet.js` 补 `roles:changed` 订阅）。

### 文档
- 新增 [`M12.3-NOTES.md`](M12.3-NOTES.md)。

## [0.5.2] - 2026-10-20

### 新增
- 抠图窗口三态视图（结果 / 原图 / 蒙版）、图像空间擦除与恢复、撤销 3 步、旋转 ±90° 与水平翻转。
- 预处理 A/B：squash 与 letterbox 可切换，实测两者差异 <1%，默认 letterbox 仅用于保持长宽比。

### 文档
- 新增 [`M12.2-NOTES.md`](M12.2-NOTES.md)。

## [0.5.1] - 2026-10-20

### 修复
- 抠图 alpha 合成：改用自己的直通 alpha 管线（预乘 BGRA 解码、自己的缩放与 PNG 编码），背景平均 alpha 23 → 0、非边缘半透明 8.25% → 0、边缘 7.67px → 2.23px。
- 回退语义不再“假成功”：`mode`/`cutout` 标记、二次确认、角色“未抠图”徽标。
- 统一 25MB 图片上限；新增 `tools/cutout-diag.js` 与合成图 fixture。

### 文档
- 新增 [`M12-NOTES.md`](M12-NOTES.md)。

## [0.5.0] - 2026-10-20

### 新增
- 离线照片抠图（U2Net 人像分割，模型随包 44MB）与独立抠图窗口：拖动、缩放、保存为角色。
- 无网络依赖，照片只在本机处理；识别不到人像或模型失败时回退“仅缩放导入”。

### 文档
- 新增 [`M11-NOTES.md`](M11-NOTES.md)。

## [0.4.2] - 2026-10-20

### 新增
- 气泡改为 whale classic SVG 外观（云朵路径 + 两个尾巴 ellipse），按内容横向适配，多行不裁切。

### 文档
- 准备 SignPath Foundation 免费 OSS 签名方案（[`SIGNING.md`](SIGNING.md)）。

## [0.4.1] - 2026-10-20

### 修复
- 去掉桌宠双击/右键响应，设置只从悬停 ☰ 或托盘进入。
- 适配 whale 气泡与菜单样式。

## [0.4.0] - 2026-10-20

### 新增
- 触摸动效（按压 Q 弹、松手回弹、悬停微放大、拖动倾斜、贴边镜像）与悬停 ☰ 菜单。
- 设置界面重构（左侧分类导航 + 卡片式字段 + 角色图库）。
- 内置 DeskPet Sans 字体（Noto Sans SC 子集，OFL），各窗口共用设计 token。

## [0.3.0] - 2026-10-19

### 新增
- 多显示器记忆与贴边吸附（四边 + 可调阈值）。
- 音效库：内置 5 种合成音色，可导入 wav/mp3/ogg/m4a/flac，事件级片段与音量、试听。
- 气泡模块化编辑器（行 / 模块、拖拽排序、模块库复用）。
- 桌面快捷方式脚本；portable 打包记录。

## [0.2.0] - 2026-10-19

### 新增
- 气泡模块化编辑器初版与存储层。
- 启动兜底与启动面包屑，排查“双击无反应”。

## [0.1.0] - 2026-10-19

### 新增
- 首个可运行版本：无边框透明置顶窗口、自定义角色、点击看天气、喝水提醒、托盘菜单、设置窗口、即时保存。
- 本地运行，不上传数据；天气来自 Open-Meteo。

<!-- 0.6.1–0.6.4 尚未打 tag，链接统一指向 v0.6.0 之后的比较。 -->
[Unreleased]: https://github.com/liuhaolh6/desk-pet/compare/v0.6.0...HEAD
[0.5.8]: https://github.com/liuhaolh6/desk-pet/compare/v0.5.7...v0.5.8
[0.5.7]: https://github.com/liuhaolh6/desk-pet/compare/v0.5.6...v0.5.7
[0.5.6]: https://github.com/liuhaolh6/desk-pet/compare/v0.5.5...v0.5.6
[0.5.5]: https://github.com/liuhaolh6/desk-pet/compare/v0.5.4...v0.5.5
[0.5.4]: https://github.com/liuhaolh6/desk-pet/compare/v0.5.3...v0.5.4
[0.5.3]: https://github.com/liuhaolh6/desk-pet/compare/v0.5.2...v0.5.3
[0.5.2]: https://github.com/liuhaolh6/desk-pet/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/liuhaolh6/desk-pet/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/liuhaolh6/desk-pet/compare/v0.4.2...v0.5.0
[0.4.2]: https://github.com/liuhaolh6/desk-pet/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/liuhaolh6/desk-pet/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/liuhaolh6/desk-pet/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/liuhaolh6/desk-pet/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/liuhaolh6/desk-pet/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/liuhaolh6/desk-pet/releases/tag/v0.1.0