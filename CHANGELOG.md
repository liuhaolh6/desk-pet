# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 的组织方式，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

格式说明：`新增` / `修复` / `文档` / `打包`。每一条都对应仓库里的提交与 `*-NOTES.md` 记录。

## [Unreleased]

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