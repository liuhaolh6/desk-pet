# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 的组织方式，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

格式说明：`新增` / `修复` / `文档` / `打包`。每一条都对应仓库里的提交与 `*-NOTES.md` 记录。

## [Unreleased]

（下一轮从这里开始记）

## [0.6.16] - 2026-10-25

### 修复

- **CI 徽章常红**：`e2e` job 在 `windows-latest`（en-US 系统）上挂掉——种子设置没写 `locale`，
  设置页分类渲染成 Weather/Bubble，`city` 用例按 `/天气/` 找分类按钮自然找不到。现在 e2e 种子固定
  `locale: 'zh-CN'`，用例改用 `data-panel="weather"` 定位并给 5 秒等待窗口。`ci.yml` 两个 job 全绿，
  README 徽章 passing。
- **CI 失败原因查不到**：Actions 的 job 日志接口未鉴权返回 403，只能登录网页看。新增
  `tools/e2e/annotate.js`：失败时把 `FAIL` 行 / 断言行与 `app.log` 尾巴用 `::error::` 写成 check-run
  注解（公开仓库匿名可读），e2e 输出同时 `tee` 到 `e2e.log`；`DESKPET_E2E_KEEP=1` 保留 `.e2e-data/`
  供注解步骤读取。
- **Release 的「Build installer」必挂**：electron-builder 会从 `repository` 字段推断出 GitHub 发布源，
  构建收尾自动 `publish`；CI 上没有 `GH_TOKEN`，于是 `GitHub Personal Access Token is not set` 退出 1
  （tag `v0.6.15` 的 Release 就挂在这一步，日志里安装器其实已经构建出来了）。`dist` / `dist:installer`
  改成显式 `--publish never`——发布只由 `release.yml` 的 `gh release` 步骤负责。
- **Release 失败时新建的 Issue 正文是字面量 `System.Object[]`**：`@("…", "", $tail, $fence)` 把数组当普通元素
  拼进去，改成 `@(…) + $tail + @($fence)`。之后 Issue #7/#8 正文才是可读的日志尾巴。

### 文档

- HANDOFF §0/§6/§10 同步：CI 已绿（公开仓库、匿名可看注解）、开场白版本改 0.6.16。

### 打包

- **安装器重回 CI**：新增 `installer-probe.yml`（只跑安装器构建，约 3~5 分钟，失败时把日志写成 check-run 注解）
  与 `tools/ci-annotate.js`（挑 `error/failed/cannot/ERR_` 等关键词转 `::error::`，公开仓库匿名可读）。
  本机杀软仍拦安装器解包（`ERR_ELECTRON_BUILDER_CANNOT_EXECUTE`，见 `docs/SELF-SIGNING.md` §9），CI 不受影响；
  `v0.6.16` 的 Release 同时产出便携版与安装器。
- **探针里的路径被 YAML 吞掉**：`node_modules` 下的 electron 目录写成了 `node_moduleselectron`，统一改正斜杠。

## [0.6.15] - 2026-10-25

### 修复

- **悬停菜单展开后底部/右侧被窗口剪掉**：菜单面板的展开动画带着 `transform: scale(0.96)`，渲染层却用
  `getBoundingClientRect()` 量尺寸（量到缩放后的 189×170，而不是布局的 196×187），窗口就按小一圈的尺寸开；
  主进程又用「整窗比内容区大 6×7px」的固定常量补窗框，而窗口从隐藏到显示后这个高差会变成 17px，
  两个误差叠在一起，菜单下缘被裁掉 10 来像素。修法两处：渲染层改用 `offsetWidth/offsetHeight` 量布局尺寸，
  并在展开后再复量一次；主进程改走 `setContentBounds`（交给 Electron 换算窗框），再向渲染层要
  `innerWidth/innerHeight/screenX/screenY` 实测核对，差多少补多少、最多三轮，不再依赖窗框常量。
  顺带修好翻到桌宠下方时 `side` 没推给渲染层、展开方向仍按「上方」的问题。
  实测：窗口内容区 208×200、面板 196×187、桌宠窗口 330×222 前后不变；CDP 验收 10/10 全过，
  贴顶/贴右/右下角/重复打开四种摆位都不再裁。见 `M34-NOTES.md`。

### 变更

- `tools/smoke.js` 加两条防回归断言：菜单尺寸必须用 `offsetWidth/offsetHeight` 量（不能把展开动画的
  `scale` 算进去），窗口尺寸必须走 `setContentBounds` + 渲染层实测校正（不能再用固定窗框常量）。

### 打包

- 便携版 `dist/DeskPet-0.6.15-portable.exe`（153,833,193 字节，SHA-256 `f332c93c…f647d4`，未签名）；
  安装器仍受本机杀软限制（`docs/SELF-SIGNING.md` §9），最后可用安装器仍是 `0.6.11`。

## [0.6.14] - 2026-10-24

### 修复

- **导入的音效没有声音**：`pet-sound://` 自定义协议注册时没开 `corsEnabled`，响应也没带 CORS 头，
  `file://` 页面里的 `fetch('pet-sound://…')` 被浏览器拦成 `TypeError: Failed to fetch`，于是只有内置
  （WebAudio 合成）音色能响、导入的 WAV/MP3 全部哑掉。修法两处、缺一不可：`app/main.js` 的 privileges 加
  `corsEnabled: true`；`app/main/catalog.js` 的响应加 `access-control-allow-origin/headers: *`。
  实测修复后 `fetch` 200、`decodeAudioData` 得 1.85 s、播放链路真的 `start()`。见 `M33-NOTES.md`。

### 变更

- 新增 `tests/unit/sound-protocol.test.js`（3 例：wav/mp3 的 content-type 与 CORS 头、未知 id/错误 host → 404，
  用假 fs/store 不碰真协议）；`tools/smoke.js` 加两条断言（privileges 含 `corsEnabled`、响应含 ACAO 头）
  防止以后被「清理」回去；`npm run check` 覆盖新测试文件。
- `package.json` 的 `build.files` 加 `!app/**/.dsh-ops-*.lock`：编辑器原子写留下的零字节临时锁文件不再打进
  asar（本次清掉工作区 130 个，asar 600 → 549 条）。

### 打包

- 便携版 `dist/DeskPet-0.6.14-portable.exe`（153,830,942 字节，SHA-256 `fcc661cc…7204b6`，未签名）；
  安装器仍受本机杀软限制（`docs/SELF-SIGNING.md` §9），最后可用安装器仍是 `0.6.11`。

## [0.6.13] - 2026-10-24

### 修复

- **应用图标与托盘图标去掉圆形徽章**：改成原图抠图后的「贴纸」——只有人物本身和透明底，不再有粉色圆环、
  渐变底盘与投影；`build/icon.ico` 同步重生成（16–256px 多尺寸）。`tools/make-assets.py` 新增 `--reicon`，
  可直接从 `assets/default.png` 重生成 `icon.png` / `icon.ico` / `tray.png` / `tray@2x.png`，且不再改写默认角色图。

### 打包

- 便携版 `dist/DeskPet-0.6.13-portable.exe`（153,834,291 字节，SHA-256 `d50851e1…c87161`，未签名）；安装器仍受本机杀软限制（`docs/SELF-SIGNING.md` §9）。
- 仓库转公开（MIT）前已用 `git filter-repo` 从全部历史移除原始照片素材，旧 commit 已不可访问；项目内只剩程序生成的合成测试图。

## [0.6.12] - 2026-10-24

### 新增

- **悬停菜单搬进 overlay 窗口（P2-4 阶段二收尾）**：菜单不再画在桌宠窗口里，改由覆盖在桌宠上方的透明窗口渲染——与气泡同一扇窗。
  桌宠渲染层只负责算锚点（桌宠头顶正中）并把「菜单开/关 + 锚点」交给主进程；窗口开多大、摆在哪由 `app/main/overlay-menu.js` 决定
  （上方优先，放不下翻到下方，并限制在屏幕工作区内）。点菜单项经 `overlay:menu-action` 转发回桌宠窗口，隐藏/退出等动作照旧。
- 菜单窗口自动标定窗框差：Win11 的透明无边框窗口，整窗比内容区宽 6px、高 7px（显示后高度差还会变 17px），先向渲染层要一次真实
  `innerWidth/innerHeight` 与 `screenX/Y`，再补正 `setBounds`；不补的话菜单底边会被窗口裁掉 1~5px。
- 菜单打开期间 overlay 窗口才可聚焦（`focusable` 动态切换），键盘可以 Tab 进菜单、Esc 退出；菜单关闭且没有气泡时整窗隐藏（`hasBubble || hasMenu`）。

### 变更

- **桌宠窗口不再被菜单撑大**：`app/main/window-layout.js` 的 `applyBubbleHeight` 恒返回 `{reserve: 0, side: 'above'}`，
  桌宠窗口恒等于「桌宠 + 左右 54px 留白」，打开/关闭菜单前后尺寸与位置不变，也不再重排命中区域。
- 新增 `app/main/overlay-ipc.js`：overlay 窗口的 IPC 面从 `ipc.js` 拆出（气泡渲染/收起、点击转发、菜单尺寸与动作）。
- `tools/smoke.js` 断言改为「菜单在 `overlay.html`」「桌宠窗口几何不因菜单改变」，unit 182 例。

### 修复

- 菜单失焦收起：焦点离开 overlay 窗口即收起（原来挂在桌宠窗口的 `blur` 上，菜单搬走以后那个事件不会再出现）。
- 关闭菜单与收起气泡互不踩状态：先收起气泡再开菜单，状态机只走 `bubble-hide → menu-open`，`pet:menu-closed` 只回给桌宠窗口。

### 打包

- 便携版 `dist/DeskPet-0.6.12-portable.exe`（153,930,573 B ≈ 146.8 MiB，未签名，SHA-256 `08a5af4a…332c11`）。
- 安装器 0.6.12 **未产出**：electron-builder 26.15.3 生成 NSIS 时要运行刚产出的 `setup.exe` 做卸载器，本机杀软（Lenovo/Huorong）直接把它杀掉，报 `ERR_ELECTRON_BUILDER_CANNOT_EXECUTE`（Exit code: null），只留 400 KB 残包（已删）；带签名与 `CSC_IDENTITY_AUTO_DISCOVERY=false` 重试均同样失败，与 `docs/SELF-SIGNING.md` §9 完全一致。最后可用安装器 = 0.6.11。
- 本机也无法启动校验打包后的二进制：便携版与 `dist/win-unpacked/DeskPet.exe` 启动后进程立即消失（未创建数据目录、不开调试端口）。改用 `@electron/asar` 校验 `app.asar`：599 文件、`package.json` 版本 0.6.12、含 `app/overlay-menu.js`、`app/main/overlay-menu.js`、`app/main/overlay-ipc.js`。开发实例（`node_modules/electron`）的运行时验收见 §5。

## [0.6.11] - 2026-10-24

### 修复

- **悬停菜单被窗口剪掉（0.6.10 回归）**：P2-4 阶段二把桌宠窗口收成“桌宠 + 左右留白”后，菜单仍画在这个窗口里、
  而菜单是从桌宠头顶向上展开的——超出窗口的部分被裁掉，看起来就是“菜单点不开”。现在菜单打开时窗口临时向上长高
  （最多长到工作区边缘，自动挑空间大的一侧；贴顶时菜单翻到桌宠下方），**桌宠本身不动**，关闭后窗口立刻收回。
- **气泡不随内容变大**：内容多时只会把字号一路压到 0.6 的下限，字越挤越小、按钮被挤出气泡形状甚至出窗口。
  现在字号降到下限还不够时，气泡窗口按 1.18 倍一档放大（最多 1.54 倍宽，且不超出所在显示器），再重新排版；
  放大是收敛的，不会越点越大。
- **喝水提醒点不动**：按钮被裁到气泡/窗口外是主因（上一项）；顺带验证了 overlay→桌宠窗口的动作转发链路
  (`overlay:action` → `bubble:action` → `drinkDone`)，现在点「喝完了」会真的记一杯。
- `app:status` 的 `window` 字段带上窗口真实矩形（`bounds`），以后这类“看不见/点不到”的 bug 报告可以自证。

### 已知问题

- **安装器可能在“DeskPet 无法关闭”上僵住**（electron-builder 26.15.3 自带模板）：模板的进程检查用 PowerShell 判断
  “有没有进程路径以 `$INSTDIR` 开头”，`$INSTDIR` 为空时它会把所有进程都算成命中，于是即使一个 DeskPet 都没跑、
  甚至安装目录不存在，也会弹出“DeskPet 无法关闭。请手动关闭它，然后单击重试”。已在 0.6.11 上复现（GUI 与静默两种模式）。
  临时绕法：直接用便携版（`DeskPet-<版本>-portable.exe`），或先手动删掉 `%LOCALAPPDATA%\Programs\desk-pet` 再装；
  修法（已记入 ROADMAP）是接管 `customCheckAppRunning`，用 `tasklist` 精确匹配镜像名，不再依赖 `$INSTDIR` 前缀比较。
- 升级安装时若旧版仍在运行，安装器会先尝试结束它；结束失败时请手动退出托盘里的桌宠再点“重试”。

### 试验（非正式发布）

- **自签名试用版**：用自造根证书给 `DeskPet.exe`、便携版、安装器签名，验证了完整链路（信任根证书后 `Get-AuthenticodeSignature` 三个产物都是 `Valid`）。
  这只是让朋友能看到发布者名字、把分发流程跑通，**不等于消除 SmartScreen 提示**；流程、实测与风险见 [`docs/SELF-SIGNING.md`](docs/SELF-SIGNING.md)。

## [0.6.10] - 2026-10-24

### 新增

- **主题包（P2-7，0.7.0）**：`themes/<id>/theme.json` 用 36 个白名单 CSS 变量换配色/字体/圆角/阴影；两个内置包（默认、像素），设置 → 外观 → 主题包即选即生效。校验器拒绝注入、白名单外 token、改尺寸的包；用户主题放在 `<数据目录>/themes/`，优先级高于内置。用户页面用 `app/theme-boot.js` 应用（主进程只算 CSS 字符串）。

- **主题包可导入导出**（P2-7）：`.zip` 里放一个 `theme.json` 即可分享；导入走校验器，坏包只报错不落盘；导出与导入对称，能原地往返。
- **桌宠窗口瘦身（ROADMAP P2-4 阶段二）**：气泡自 P2-4 阶段一起就在独立窗口里，桌宠窗口却还留着一条
  224px 的「气泡预留」——透明、不可见、但让窗口一直比桌宠大一圈，也让点击/拖拽的坐标计算绕了远路。
  这一版把预留彻底去掉：窗口恒等于「桌宠 + 左右 54px 留白」（默认尺寸下 328×220，原来 328×400），
  `pet:reserve` 通道保留但不再改窗口，气泡放不下时由 overlay 自己翻到桌宠下方。
- **多语言：日期与时间按语言习惯显示（ROADMAP P2-6 阶段五）**：语言包新增 `meta.timeStyle`（zh `24h` / en `12h`）
  与 `date.am`/`date.pm`；气泡里的时间、喝水记录的时间轴按它排版（`2:05 PM` / `14:05`），
  **存储与 CSV 导出仍是 24 小时制**——导出文件不该跟着界面语言变。
- **多语言：内联中文清零（ROADMAP P2-6 阶段三-P）**：`tools/check-i18n.js` 的基线从 880 一路降到 **0 处**。
  收尾段做了三件事：① 用户数据的默认值（名字「小芳」、城市标签「自动定位」、内置角色名「我」）不再写在
  `lib/store.js` 里，改成语言包的 `defaults.*`，首次启动时由主进程按当前语言种进设置（`seedDefaults()`，只补空值）；
  ② 内置的 24 条短语换成 `bubble.phrasesSeed`，`pet.js` 在用户没自定义时按语言取；
  ③ 剩下的开发者向文案（抠图模型失败、初始化日志）改成英文技术句——它们进日志不进界面，
  只对维护者有意义的字符串不该占用翻译预算。
- **多语言：气泡布置的数据与模块文案（ROADMAP P2-6 阶段三-G）**：`app/bubble-model.js` 的模块清单改成 `labelKey`/`sampleKey`，
  默认卡片、模块取值、日期/喝水/天气文案全部走语言包（`valueOf` 没拿到翻译器时返回键名，开发期能直接看出漏翻）。
  顺带修了 i18n 通道注册晚于窗口创建的启动顺序 bug——切 en-US 后桌宠窗口不再是中文。
  基线 **299 → 134**（剩下 store 默认短语、ipc/diagnostics/onboard/sound-model）；zh 11/11、en 9/9 运行时验证通过。
- **多语言：气泡布置窗口进语言包（ROADMAP P2-6 阶段三-F）**：`app/editor.js` 的 54 处文案（卡片/行的按钮、
  模块类型下拉、样式面板、预设名、状态提示、二次确认）与 `app/editor.html` 的 13 处静态文案全部改成键，
  窗口首次挂上 `i18n.js` 并在启动时翻译标记。基线 **299 → 245**；en 下标题/按钮/预设/提示/`aria-label` 全英文，
  预览区里剩的中文来自 `bubble-model.js` 的模块文案（阶段三-G 处理）。
- **多语言：抠图窗口进语言包（ROADMAP P2-6 阶段三-E）**：`app/cutout.html` 的 42 处静态文案改成 `data-i18n*`，
  `app/cutout.js` 的 52 处改成 `t()`（视图切换、模式标签、九种状态句、六种错误）；抠图窗口首次挂上 `i18n.js`，
  启动时按当前语言把标记翻一遍。状态句改用带占位符的模板（`{message}` / `{degree}` / `{name}`），
  不再靠字符串拼接。基线 **393 → 299**，en 下抠图窗口正文中文 **0** 处。
- **多语言：天气文案进语言包（ROADMAP P2-6 阶段三-D）**：`lib/weather.js` 的 54 处中文（WMO 码表、AQI 分级、
  三天标签、九种建议句）改走字典键；`describe/advice/aqiGrade/parseDays/fetchWeather/fetchAirQuality` 显式接收 `t`，
  不传时退回键名（开发期能一眼看出漏翻）。基线 **448 → 393**。
- **多语言：`settings.js` 清零（ROADMAP P2-6 阶段三-C）**：`app/settings.js` 的 151 处内联中文降到 **0**。
  搜索索引改成只写 `[面板, 控件 id]`（37 对），文案与关键词全从 `settings.find.<id>.*` 取；托盘/快捷键/更新/
  语言状态直接复用语言包里已有的 `other.*` 键；新增 14 条城市搜索与定位的键（`settings.status.*`）。
  真窗口复验：zh 下四段说明成句、en 下正文残留中文 **0**；基线 **599 → 448**。
- **多语言：设置页整页（ROADMAP P2-6 阶段三-B）**：`settings.html` 里最后 173 处中文全部变成 `data-i18n*` 标记，
  面板标题/说明、搜索框、恢复默认确认层、七个面板的字段与提示都走字典；设置页的搜索索引也本地化了——
  `FIND_INDEX` 仍是中文手写表（zh 兜底），加载后用 `settings.find.<id>.label/.desc/.keywords` 覆盖，
  于是 en 下输入 `city`/`volume` 能命中，zh 下「城市」「音量」照旧。真窗口复验：en 下正文残留中文 **0 处**、
  zh 下 194 处（还有 JS 侧 toast 待清）；`data-i18n` 节点 142 个全有值、`data-i18n-aria-label` 全落到 `aria-label`。
  基线 **859 → 599**；`smoke` 与 `check-a11y` 里写死中文的断言改成认 `data-i18n`，a11y 静态 95 项、审计 86/0。
- **多语言：桌宠窗口与窗口标题（ROADMAP P2-6 阶段二）**：`pet.html` 的 `<title>`、仿色图 `alt`、菜单按钮、
  菜单与按钮的 `aria-label` 全改成 `data-i18n*` 标记，**中文不再当兵补文案留在标记里**（否则“还剩多少处”永远数不准）；
  `pet.js` 启动时 `applyStatic()` 一次填完，喝水卡的「喝过了 / 稍后 10 分钟」和五句喝水小语、三条按小时
  分档的句子也都走字典（`water.done/later/tip1-5/late/start/good`）。四个窗口的标题（设置 / 气泡布置 / 抠图 /
  首次引导）改为 `createWindows({ i18n })` 里的 `title(key, fallback)`，主进程不再写死中文。
  角色图 `alt` 优先用用户起的名字，没名字才回落到字典。基线 **880 → 859**；真窗口复验 zh 8/8 + en 5/5
  （`.tmp/cdp-p26s2.js`），a11y 审计 86/0、键盘 6/6，smoke 63 → 64。
- **多语言骨架（ROADMAP P2-6 阶段一）**：文案搬进 `locales/zh-CN.json`（`locales/en-US.json` 结构同步就位），
  主进程、渲染层、纯 Node 各有一个 `t()`；设置 → 其他 多了语言下拉（跟随系统 / 中文 / English），
  **改完重开桌宠生效**。真正的地基是尺子：`tools/check-i18n.js` 剥掉注释后数出每个文件还剩多少处内联中文，
  基线 `tools/i18n-baseline.json` 只降不升，`npm test` 里跟着跑；渲染层文案改用 `data-i18n` 标记 +
  `applyStatic()` 填充，HTML 回到纯结构。本阶段收口 30 个文件、880 处待抽取（剩最多的是设置页与气泡模型），
  已知限制与分阶段计划见 [`M30-NOTES.md`](M30-NOTES.md)。
- **抠图评测链路（ROADMAP P2-5 的前置部分）**：模型选择从代码变成数据（`lib/cutout-model.js`：
  `DESKPET_CUTOUT_MODEL` 绝对路径 → 安装版 `resources/models` → 仓库 `assets/models`，小于 1MB 的文件视为没下载完）；
  新增评测 CLI `npm run cutout:eval`（IoU / 边缘锐度 / 耗时 / 覆盖率，逐图 + 汇总，`--json` 可机读）与
  10 张合成 golden set（`npm run cutout:golden`，真值蒙版随图生成）。基线：u2net-human 在合成集上
  IoU 均值 0.987、P50 349ms；真实照片请放 `.cutout-eval/` 跑自己的基线。
  ISNet / BiRefNet-lite 因体积（176/224MB）超预算、模型站当前不可达而**未随包**，换权重只需放文件 + 改 id，
  详见 [`M29-NOTES.md`](M29-NOTES.md)。
- **气泡独立窗口（ROADMAP P2-4 阶段一）**：气泡从桌宠窗口里搬出来，装进自己的透明小窗
  （`app/overlay.html` + `app/main/overlay.js`）——只有气泡那么大，跟着桌宠走，**不抢焦点**（`showInactive` +
  `focusable:false`），点一下收起，卡上的按钮（喝水卡「喝过了 / 稍后 10 分钟」）照旧转发回桌宠窗口处理。
  桌宠窗口不再画气泡、也不再因为气泡出现而长高：稿子（卡片内容）仍然在宠物窗口里算，气泡窗口只负责排版与点击。
  这样以后气泡可以比宠物大、可以贴边翻面，而道具/走路/菜单都不受气泡尺寸牵连（阶段二再做，见 `M28-NOTES.md`）。
- **更新提示（ROADMAP P2-3）**：启动后查一次 `update.json`、之后每 24 小时最多一次；有新版在气泡和设置里
  说一声，点「去下载」用浏览器打开发布页。**不静默安装**——那要等产物有签名。版本比较是纯函数
  （`lib/update-check.js`，支持 `v1.2.3`/预发布后缀），`openUpdate` 只放行 `https:`。
- **隐私透明（ROADMAP P2-8 的文档部分）**：设置 → 其他 → 「数据与隐私」能展开看到四类东西的真实体积（设置、照片、
  日志与抠图轨迹、浏览器缓存）和联网清单；「清理日志和缓存」两步确认后只删 `app.log`、`cutout-trace.jsonl`
  与 Chromium 缓存目录里的文件，**设置、角色图、照片、声音、喝水记录都不动**。数字来自磁盘实测
  （`app/main/privacy.js`），不是写死的文案。
- **更新开关**：设置 → 其他 → 「更新」新增「启动时自动看一眼」，关掉后启动不再检查（每 24 小时的节流仍在手动检查时生效）。
- 新增 [`docs/PRIVACY.md`](docs/PRIVACY.md)：存了什么、发到哪、怎么删、几个常见担心点的逐条回答；README 与
  USER-GUIDE 都链过去了。

### 文档
- **签名路线与阻塞点写清楚（ROADMAP P2-2 准备部分）**：`SIGNING.md` 重写成三条路线（SignPath Foundation 免费
  OSS / Azure Trusted Signing ≈$9.99 月 / OV 证书 ¥2000–5000 年）的对比与落地步骤，明确唯一阻塞是
  “申请或采购证书需要人工身份核验”，代码侧（workflow、验签脚本）已就绪。
- `sign-release.yml` 增加 **Azure Trusted Signing** 作业（`build-sign-azure`），与 SignPath 作业并存，
  各自用仓库 vars 开关，未配置时自动跳过；签完自动跑 `tools/verify-signature.ps1` 并生成 `SHA256SUMS.txt`。
- `tools/verify-signature.ps1` 默认改为验三个产物（`setup.exe` / `portable.exe` / `win-unpacked\DeskPet.exe`），
  缺哪个跳过哪个。

> 计划中的工作与现有不足的完整清单见 [`ROADMAP.md`](ROADMAP.md)（成熟度评分、P0–P3 方向、未来展望）；
  机制细节与踩坑记录见 [`HANDOFF.md`](HANDOFF.md)。

## [0.6.8] - 2026-10-23

第一个能“双击安装”的版本：0.6.7 及以前只有便携版（解压到临时目录、还会被安全软件拦）。

### 打包
- **NSIS 安装器（ROADMAP P2-1）**：`DeskPet-0.6.8-setup.exe`，一键安装、无需管理员，装到
  `%LOCALAPPDATA%\Programs\desk-pet`，带开始菜单/桌面快捷方式和卸载入口（设置 → 应用）；
  卸载保留用户数据（`deleteAppDataOnUninstall: false`）。
  踩坑与验证：§7 of [`M6-PACKAGING.md`](M6-PACKAGING.md)——尤其是**向导式安装器 + 静默安装是坏的**
  （`$INSTDIR` 为空 → `CHECK_APP_RUNNING` 把任何进程当成 DeskPet → 退出码 0 但什么都没装），
  所以改成 `oneClick: true`。新增 `npm run clean:dist`（`tools/clean-dist.js`）避免把上一次运行
  留下的启动日志打进安装包。
- **打包版启动日志不再写进安装目录**：`app/main/log.js` 的 breadcrumb 在打包版写到 `%TEMP%\desk-pet-boot.log`
  （开发版仍写在仓库根），安装目录保持干净。

## [0.6.7] - 2026-10-23

地基理顺的一版：主进程拆成 16 个模块（`main.js` 1451 → 226 行）、窗口状态机收口；顺手补上设置的可用性、喝水记录、天气细节和"主动说话"。

### 工程化
- **真窗口 e2e 入库（ROADMAP P1-9）**：把散在 `.tmp-verify/` 里的一次性 CDP 脚本整理成 `tools/e2e/`——
  `run.js` 用临时数据目录起一个干净的 Electron（不需要 xvfb），`cases/` 三条用例：`noresize`（连点 5 次 + 收起，
  窗口高度恒为 444）、`collapse`（气泡完整落在窗口内、收起后宠物重新可点）、`city`（找城市 → 点结果 → 存盘 → 进最近城市）。
  外网不可靠，`city` 走 `run.js` 起的本地地理编码桩（`DESKPET_GEOCODE_BASE`），整条 IPC 链路是真的，只有网络被换掉。
  `npm run test:e2e` 一键跑；`ci.yml` 新增 `e2e` job（Windows runner，失败变红，失败时上传 `.e2e-data/` 供排查）。见 [`M26-NOTES.md`](M26-NOTES.md)。

### 无障碍
- **真机 a11y（ROADMAP P1-8）**：把"只在代码里保证"的三件事搬到真窗口上验。200% 缩放（`--force-device-scale-factor=2`，
  `devicePixelRatio === 2`）下四个窗口横向溢出都是 0，截图进 `docs/a11y-shots/`；高对比度用 `--force-high-contrast` 起，
  媒体查询命中后钉住系统色——设置页当前分类改成 `outline: 2px Highlight`，四个 CSS 都补了 `forced-colors` 分支，
  云朵框显式 `forced-color-adjust: none` + `Canvas/CanvasText`，避免深色高对比主题下变成"黑底黑字"。
  本机没装 NVDA，于是新增 `tools/a11y-tree.js` 直接走 CDP `Accessibility.getFullAXTree`：四个窗口 83 个可交互节点、
  **没有名字的 0 个**，NVDA 的手工朗读清单写进 `A11Y-AUDIT.md` §7.3；另有 `tools/a11y-real.js` 一键重拍截图 + 量溢出。
  验证：check-a11y 84 → **95** 项（新增 forced-colors 分支与系统色断言）、audit 86/0、keyboard 6/6、a11y-tree 4/4、A11Y-AUDIT 新增 §7。见 [`M25-NOTES.md`](M25-NOTES.md)。

### 气泡时机
- **主动说话（ROADMAP P1-7）**：以前它只在被点/到点提醒时开口，电脑前坐一整天也不会主动说一句话。现在按三条本地规则
  自己冒泡：连续用满 50 分钟（且最近 1 分钟还在动）、23 点后还在用、两小时没有任何互动。决策在 `lib/nudges.js` 里是纯函数
  （`decide()` 接收时间与配置、返回要说的话），`app/main/nudge-pump.js` 每分钟喂一次；**前台是全屏应用时一律不说话**
  （`app/main/fullscreen.js` 用 PowerShell 读前景窗口矩形与任务栏，2 秒缓存，探测失败按「不是全屏」处理——宁可多说一句也不永远闭嘴）。
  说话走的是气泡同一个出口，点一下就收；安静模式、`snoozeUntil`、10 分钟限流都照旧生效。
  设置 → 提醒 多出「主动说话」开关与三个触发器（久坐/深夜/久未互动），都能单独关。
  验证：unit 100 例（`nudges` 11 例）、smoke 61 项、check-a11y 84 项、a11y-audit 86/0、keyboard 6/6，
  CDP 运行时 9/9（互动被记下、推进 51 分钟出久坐、推进 190 分钟出招呼、真冒泡、点一下收起、安静模式不开口、三个开关落盘）。见 [`M24-NOTES.md`](M24-NOTES.md)。

### 天气
- **天气增强（ROADMAP P1-6）**：天气卡多一行「空气 良（35）· 明天 6~15° 🌦️ · 后天 8~17° ☁️」，
  空气质量取自 Open-Meteo 的 air-quality 主机（欧洲 AQI 分级，免 key），未来三天逐日的最高/最低温、降水概率、
  日出日落都进了数据模型，模块库新增 `天气：未来两天`、`空气：好坏`、`空气：PM2.5`，编辑器「丰富预设」也带上它们。
  空气质量是**第二个主机、第二次请求**，任何失败都只让那一行变空，不会把整张天气卡拖下水；断网时继续走缓存并显示「离线缓存」。
  顺手修了一个老 bug：`advice()` 把 80–82（阵雨）也算进「下雪」，20℃ 的阵雨会提醒「外面在下雪」。
  验证：unit 85 例（`weather.aqiGrade/parseDays/fetchAirQuality` 与 `air.*` 模块）、smoke 60 项、check-a11y 84 项、
  a11y-audit 86/0、keyboard 6/6，CDP 运行时 8/8（真机取到 杭州 3 天预报 + AQI 61 较差，天气卡实际渲染出两行新内容）。
  见 [`M23-NOTES.md`](M23-NOTES.md)。

### 喝水
- **喝水记录（ROADMAP P1-5）**：气泡上的「待会儿」换成「稍后 10 分钟」，按下去这 10 分钟就不吵你，也不算喝了一杯
  （提醒里先判 `snoozeUntil`，再判间隔）。每点一次「喝过了」都会在本地记一条时间戳和当时的杯量，
  设置 → 提醒 里多出「喝水记录」：今天的每一杯按「几点」排成时间轴，最近七天的杯数按条展示（今天标 `aria-current`），
  一杯多少毫升可改（只影响之后那几杯，老记录保持原杯量），「导出喝水记录（CSV）」写到数据目录并自动定位文件。
  记录上限 500 条，手写 `settings.json` 里的坏数据/重复在读写时都会规整；0.6.x 的 `water.today.cups` 会被当作今天的一杯数继续统计。
  验证：unit 75 例（`lib/water-log.js` 15 例）、smoke 59 项、check-a11y 84 项、a11y-audit 86/0、keyboard 6/6，CDP 运行时 19/19。见 [`M22-NOTES.md`](M22-NOTES.md)。

### 设置
- **设置可用性（ROADMAP P1-4）**：侧边栏加了搜索框——按标题、同义词（「响度」「几杯」「别吵」）和面板名三档打分，
  回车/方向键可全程键盘操作；点结果直接切到对应面板、把那一行滚到视线里并闪一下，焦点落在控件上（减少动效时改为瞬时定位）。
  每个设置项都补了一句话说明；顶栏新增「恢复这页默认」，点开是带面板名的二次确认（`role="alertdialog"`，默认聚焦「恢复默认」，Esc 可退），
  只改当前这一页、不动角色图与气泡排版。天气页新增「最近用过的城市」，最多记 5 个、重复的提到最前，
  手写进 `settings.json` 的重复/空城市在读写时也会被规整。
  主进程新增只读通道 `settings:defaults`（`store.defaults()` 返回深拷贝），默认值只有一份来源。
  验证：smoke 58 项、check-a11y 76 项、a11y-audit 86/0、keyboard 6/6，CDP 运行时 17/17（搜索定位、键盘跳转、按页恢复、最近城市）。见 [`M21-NOTES.md`](M21-NOTES.md)。

### 测试
- **纯函数单测框架（ROADMAP P1-3）**：新增 `tests/unit/` 四个 `node:test` 文件、合计 **60 例**——
  `bubble-model.test.js`（19：样式夹取、非法输入回退、空行裁剪、缺天气占位）、`placement.test.js`（16：多显示器归属、夹取、贴边吸附、存档失效）、
  `weather.test.js`（10：WMO 码表、`advice()` 优先级、入参校验）、`cutout-math.test.js`（15：阈值、形态学、连通块、裁剪框）。
  `package.json` 新增 `npm run unit`（`node --test "tests/unit/*.test.js"`）与 `unit:watch`，`npm test` 改为 smoke + unit 两段；
  `npm run check` 把 4 个测试文件也纳入语法检查。零新依赖，见 [`M20-NOTES.md`](M20-NOTES.md)。

### 重构
- **主进程拆模块（阶段 4，收口）**（ROADMAP P1-1）：新增 `app/main/windows.js`（297 行，五个窗口的创建/单例/设置副效应）、
  `catalog.js`（106，角色与声音目录 + `pet-role://`/`pet-sound://` 协议 + 广播）、`boot.js`（81，选数据目录 + 单实例锁），
  `app/main.js` 564 → **226 行**，P1-1 的“单文件 ≤300 行”目标达成。
  `layout` 与窗口的循环依赖用 `onMirror: () => windows.sendMirror()` 晚绑定闭包断开；
  行为不变（57+57+86+6 全绿，运行时 stage3 17/17、stage4 12/12）。见 [`M18-NOTES.md`](M18-NOTES.md) §7。

- **主进程拆模块（阶段 1）**（ROADMAP P1-1 / L21）：新增 `app/main/log.js`、`geometry.js`、`tray.js`、`diagnostics.js`
  （合计 281 行），`app/main.js` 从 1451 行降到 **1284 行**，只做接线；行为与对外 API 不变
  （`app:status` 字段形状、托盘菜单项、诊断导出文件格式均同 0.6.6）。smoke 新增模块契约与几何纯函数断言（54 项）。
  细节与剩余阶段见 [`M18-NOTES.md`](M18-NOTES.md)。

- **主进程拆模块（阶段 2）**（ROADMAP P1-1）：新增 `app/main/window-layout.js`（250 行，零 Electron 依赖）——
  把 `hitRects/petInteractive/updateInteractive/getDisplays/resolveWindowPosition/applyBubbleHeight` 抽成
  `hitTest()` 纯函数 + `createWindowLayout()`，`app/main.js` 1284 → **1148 行**。顺带修掉一个真实竞态：
  窗口 resize 后的"重新量预留"会冒充 `bubble-show`，导致拖动中状态机非法转移、状态卡在 `bubble`；
  现在 `pet:bubble` 只管可见性、`pet:reserve` 只管预留（见 M18-NOTES §5）。

- **主进程拆模块（阶段 3）**（ROADMAP P1-1）：新增 `app/main/ipc.js`（404 行，全部 `ipcMain` 通道）、
  `weather-pump.js`（81）、`reminder.js`（67）、`cutout-service.js`（232），`app/main.js` 1148 → **564 行**。
  依赖全部注入（窗口用 thunk），所以天气泵与提醒的规则可以在 smoke 里用假时钟直接断言；
  行为不变（57+57+86+6 全绿，运行时 `cdp-p11-stage3` 17/17）。见 [`M18-NOTES.md`](M18-NOTES.md) §6。

- **显式窗口状态机**（ROADMAP P1-2 / L7）：新增 `app/window-state.js`（纯 Node，127 行）——
  `idle / bubble / menu / dragging / cutout` 五态 + 转移表 + 非法事件计数（不抛异常，留给诊断用），
  取代原来的 `petDragging` 散子与 `540ms/50ms` 时序约定；`app:status` 多了 `window: { state, illegal, lastIllegal }`。
  行为不变，但“气泡先隐藏再点设置”这类顺序错位现在会被状态机拦住。smoke 增全矩阵断言（55 项）。
  细节、实测数据与踩坑见 [`M19-NOTES.md`](M19-NOTES.md)。

- **只抠图抢焦点**（随 P1-2）：气泡与悬停菜单改用 `showInactive`；抠图窗口平时不抢焦点，
  只有点“开始”才 `focus()`。以前鼠标移到桌宠身上就会把焦点从编辑器/浏览器抢走。

### 打包
- 0.6.7 便携版：`dist/DeskPet-0.6.7-portable.exe`（153,885,681 B ≈ 146.8 MiB，未签名，`electron-builder` 26.15.3 / Electron 44.9.0）；
  SHA-256 `920284dde614ade2d5618d28cf5317542c3922f80f19e87a81d59687d54521df`。
- 出包后把 `win-unpacked` 复制到 `D:\DeskPetTest\app`，用 `DESKPET_DATA_DIR=D:\DeskPetTest\data` 启动实测 15/15：
  版本 0.6.7、托盘 `{ok:true}`（目录外启动通知区可见 `小芳 · 桌宠`）、快捷键 `registered:true`、状态机 `idle→bubble` 无非法转移、
  气泡不改变窗口高度（444）、喝水写入、诊断导出、设置页搜索命中「喝水」3 条。

## [0.6.6] - 2026-10-22

长文案不再糊成一团，托盘靠不住时也有后路，出问题能一键导出信息。

### 新增
- **快捷键兜底**（ROADMAP P0-3 / L8）：`Ctrl+Alt+P` 全局显示/隐藏桌宠；托盘创建失败或图标为空时不崩，只记下原因。
  设置 → 其他新增「托盘和快捷键」两行，写清托盘到底好不好用、快捷键有没有注册成功（被占用会写原因），
  并明确告诉用户桌宠身上的悬浮菜单始终能打开设置和退出。
- **诊断导出**（ROADMAP P0-5 / L13）：设置 → 其他 → 遇到问题 → 「导出诊断信息」，写出
  `diagnostics-年月日-时分秒.txt`（版本 / Electron / 系统 / 屏幕布局 / 托盘与快捷键状态 / app.log 末尾 200 行 /
  cutout-trace 末尾 60 行）。**脱敏**：城市与经纬度 → `[已脱敏]`，自定义短语与气泡布局不导出，不带任何照片；
  导出后自动打开所在文件夹。
- **用户手册**（ROADMAP P0-4 / L6）：新增 [`docs/USER-GUIDE.md`](docs/USER-GUIDE.md)——三分钟上手 + 9 个常见问题
  （托盘图标找不到、天气不对、气泡字太小、喝水提醒不弹、换自己的照片、数据在哪怎么备份、自启/穿透/大小位置、
  怎么反馈问题、怎么彻底卸载），README 首屏加了入口。

### 修复
- **长文案字号下限**（ROADMAP P0-2 / L10）：`fitBubbleText` 的收缩下限从 45% 提到 **60%**，仍放不下时按实际超出比例
  截断并加 `…`，完整文字留在 `title` 与 `aria-label`；每次排版都先从 `data-full` 还原再截断，换卡不叠加省略号。
  120 字文案实测字号 16px、不溢出；6 × 200 字极限卡片停在下限 9.6px 后截断，安全区不再被顶穿。
- 溢出判定改为量渲染矩形（居中安全区两端都会溢出），上一次「长文案从不截断」的排查结论作废——
  真正原因是 `bubble-model.js` 把单个模块截到 200 字，单模块 500 字测试其实只渲染了 200 字。

### 文档
- **托盘“不显示”结案**：裸 P/Invoke 探针实测，本机 `D:\project` 子树里的 exe 调 `Shell_NotifyIcon`
  一律返回 `ERROR_ACCESS_DENIED(5)`，同一 exe 换到 `D:\`、`%TEMP%`、`D:\DeskPetTest` 即成功；
  打包版在目录外启动后通知区可见 `[小芳 · 桌宠]` → **不是产品缺陷**，开发/验证需在项目目录外运行
  （细节见 `M17-NOTES.md` §8.1、`HANDOFF.md` §6.1 5.10）。

### 打包
- 重新出包 `DeskPet-0.6.6-portable.exe`（Electron 44.9.0 / x64，未签名，见 HANDOFF §6.2），
  并实测 `dist\win-unpacked\DeskPet.exe` 冷启动。
- 设置 → 其他 的托盘文案改为如实描述（不再写「托盘没问题」）：托盘图标交给系统后可能被折叠，
  `Ctrl+Alt+P` 与桌宠悬浮菜单始终可用。
- `Ctrl+Alt+P` 用系统级按键（`keybd_event`）实测：桌宠窗口 `vis=True → False → True`，
  把「只验了 `globalShortcut.isRegistered`」升级为「真按一下能显示/隐藏」。

## [0.6.5] - 2026-10-22

第一次打开不再迷路：新数据目录首次启动时弹一张三步欢迎卡，看完就记住，不再出现。

### 新增
- **首次欢迎卡**（ROADMAP P0-1 / L14）：新数据目录第一次启动时在屏幕中央弹出一张三步引导卡——① 点我一下出气泡、
  ② 去设置 → 天气选城市、③ 拖到顺手的位置 / 右上角小按钮。标题里的名字取自 `settings.name`，改过名字就对上了。
- **只出现一次**：关闭时把 `onboarded: true` 写进 settings（`lib/store.js` 默认值里就有这个字段）；三条关闭路径
  （「知道啦」、「先去选城市」、Esc）都会落盘，之后启动不再自动弹出。
- **想再看一遍**：设置 → 其他 → 「再看一次欢迎引导」（`#onboardBtn` → `onboard:open`，`force=true` 无视标记）。
- **调试入口**：`DESKPET_OPEN_ONBOARD=1` 启动即打开，方便截图与审计。

### 无障碍
- 卡片是真正的 `role="dialog" aria-modal="true"`：`aria-labelledby` 指标题、`aria-describedby` 指引导语，步骤序号
  `aria-hidden`，装饰头像 `alt=""`。
- 打开后焦点自动落在「知道啦」（`autofocus` + `focus({preventScroll:true})` 双保险）；Esc 关闭；
  「先去选城市」先关卡片再开设置，避免新窗口被卡片盖住。
- 卡片高度 580 起步（`Math.max(400, Math.min(580, workArea.height - 48))`）：默认字号下**没有滚动条**，
  320px 宽也不横向溢出。

### 验证
- `node tools/smoke.js` **50 项**（新增「欢迎引导：首启一次、可重看、键盘可关」）、`node tools/check-a11y.js` **52 项**、
  `tools/a11y-audit.js` **86/0**（新增 onboard 页 10 项）、`tools/a11y-keyboard.js` **6/6**。
- CDP 实测 24 项全过：首启自动弹出、DOM/ARIA/焦点/对比度、重载无报错、点「知道啦」关闭并落盘 `onboarded: true`、
  宠物 API 重开、Esc 关闭、设置「其他」面板按钮重开、重启后不再自动弹。

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