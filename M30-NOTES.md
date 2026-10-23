# M30 · 多语言（i18n）抽取（P2-6）

> 2026-10-23 起 · 对应提交：`feat(P2-6): i18n 骨架——语言包 + 主进程/渲染层 t() + 设置页语言开关`
> 前置：[`ROADMAP.md`](ROADMAP.md) P2-6、[`HANDOFF.md`](HANDOFF.md) §3.2/§5/§6。

## 1. 目标与验收

ROADMAP P2-6 的验收是两条：**文案零硬编码**、**切换语言重启生效**。加上一条结构要求：en 目录就位即可，
不要求真的翻译好（先有骨架，后补译文）。

这条验收线决定了整体做法：不能"先把新文案写进语言包、旧文案留着"，那样检查器无法判断"零硬编码"，
只能靠人眼。所以真正的地基不是 `t()`，而是**一把能数出"还有多少处中文写死在代码里"的尺子**——
`tools/check-i18n.js` + `tools/i18n-baseline.json`。基线只降不升，每个阶段都要把它往下推。

## 2. 分层结构

三层各有一份 `i18n`，因为它们的加载方式完全不同：

```
locales/zh-CN.json     单一事实来源（嵌套 JSON，点号键 = 层级）
locales/en-US.json     键名与 zh-CN 完全一致（检查器强制）
        │
        ├── lib/i18n.js        纯 Node：flatten / interpolate / createI18n / keyDiff / matchLocale
        ├── app/main/i18n.js   主进程：读语言包目录 + createMainI18n + registerI18nIpc
        └── app/i18n.js        渲染层：create(dict, locale) + applyStatic(document, bridge)
```

**`lib/i18n.js` 不知道文件系统，`app/main/i18n.js` 不知道 Electron 之外的东西**，两者都可以在
`node:test` 里直接 require——这是本项目一贯的可测性约定（见 `lib/nudges.js` / `lib/update-check.js`）。

`app/i18n.js` 是 UMD：有 `module.exports` 就导出，否则挂 `globalThis.deskPetI18n`。渲染层每个页面
用同样的 `<script src="i18n.js"></script>` 引入，不新增打包步骤。

## 3. 渲染层怎么拿到字典（关键决定）

**用同步 IPC 拿整包字典，而不是异步。** `preload.js` 里 `readBoot()` 调
`ipcRenderer.sendSync('i18n:boot')`，把合并后的字典（当前语言 + zh-CN 兜底）一次性塞进
`window.deskPet.i18n = { locale, available, t(key, vars), has(key), keys }`。

选同步的三个理由：

1. **`t()` 必须是同步的。** 渲染层大量文案是在函数里现拼的（状态行、toast、拼接句），如果 `t()` 返回
   Promise，每一处都要改成 `await` 或者"先渲染后填坑"，改动面远大于 i18n 本身。而 `applyStatic()` 在
   DOMContentLoaded 时就要把 HTML 静态文案填好，也等不起。
2. **字典很小。** 两份语言包合起来几 KB 的 JSON，`sendSync` 的开销（一次进程往返）远小于它带来的设计简化。
   这不是热路径——每个窗口只在加载时拿一次。
3. **不需要随语言热切换。** 验收明确是"重启生效"，所以拿到一次就够，没有"语言变了要重新同步"的问题。

**顺序不变量**：`app/main.js` 里 `registerI18nIpc({ ipcMain, i18n })`（第 215 行）必须留在
`windows.createPet()`（第 247 行）之前——`sendSync` 没有超时兜底，handler 没注册时页面会卡住等回包。
新增窗口一律走 `windows.js`，而 `createWindows()` 在 173 行、更早，所以这个顺序天然成立；
但**如果有人把 `registerI18nIpc` 挪到 `createPet` 之后，第一个窗口就会挂**——写进 HANDOFF §4 的不变量里。

**preload 里的 `t()` 必须自包含。** `webPreferences` 没开 `sandbox: false`，preload 跑在沙箱里，
`require('../lib/i18n.js')` 会失败。所以 `preload.js` 里另写了一份 20 行的 `hasOwnProperty` + `{name}`
替换逻辑，和 `lib/i18n.js` 的 `interpolate` 语义保持一致（缺键返回键名、未知占位符原样）。

## 4. HTML 静态文案：`data-i18n` 而非 innerHTML 拼接

`app/i18n.js` 的 `applyStatic(root, bridge)` 扫四类标记：

| 标记 | 写入位置 |
|---|---|
| `data-i18n="key"` | `textContent` |
| `data-i18n-html="key"` | `innerHTML`（语言包里允许带标签时才用） |
| `data-i18n-title` / `data-i18n-aria-label` / `data-i18n-placeholder` / `data-i18n-alt` | 对应属性 |

顺手把 `documentElement.lang` 设成当前 locale（无障碍要求，见 `check-a11y.js` 的 `lang` 断言）。

**为什么不在 HTML 里直接写中文再让 JS 覆盖**：那样"零硬编码"的检查会一直报这些文件，且英文环境下
有一帧中文闪烁。标记化之后检查器只看语言包，HTML 变成纯结构。

## 5. 检查器：`tools/check-i18n.js`

三件事，任何一条不通过就退出码非 0：

1. **语言包键名必须完全一致**（`keyDiff`）：en-US 多一个键或少一个键都报，并打印具体键名。
2. **不许有空串**：空值是"忘了填"的典型表现，英文可以先不翻，但不能是 `""`。
3. **每个文件的内联中文数不得高于基线**（`tools/i18n-baseline.json`）：这是"只降不升"的棘轮。

计数之前先**剥注释**——注释里的中文不是文案，`stripJsComments` 用一个小状态机处理
`code / line / block / '…' / "…" / \`…\``，注释替换成空格但保留换行（行号不漂）；
HTML 走 `stripMarkupComments`（`<!-- -->`），CSS 走 `stripCssComments`。

**HTML 的文案有两处**：文本节点（`>…<`）和属性值（`="…"`）。第一版只数了属性值，所以
`settings.html` 只报 28 处——而它实际有 173 处。修好之后 HTML 的文件数字一次性大涨，这不是新增文案，
是尺子变准了。**这一点要记住：基线数字跨版本比较时，HTML 类文件只能和后一版比。**

`collectKeys` 收集代码里真正用到的键，用来找"语言包里没人用的键"（只提示不失败，因为有动态拼的键，
如 `tray.status.` + `status`）；也用来找"用了但语言包里没有的键"（这个失败）。

工具开关：

```
node tools/check-i18n.js            # 主检查（npm test 里会跑）
node tools/check-i18n.js --list     # 逐文件打印计数，看还欠哪儿
node tools/check-i18n.js --update   # 重写基线（只在"已抽取完"后跑）
```

## 6. 语言包与语言匹配

`locales/zh-CN.json` 是嵌套结构（`tray.menu.settings` 在 JSON 里是 `{tray: {menu: {settings}}}`），
加载后 `flatten()` 成点号键。`matchLocale(tag, available)` 的匹配顺序：精确匹配 → 小写匹配 →
同语言前缀（`en-GB` → `en-US`）→ `DEFAULT_LOCALE`（zh-CN）。

`settings.locale` 默认是空串，语义是"跟随系统"（`app.getLocale()`）；用户在下拉里选了具体值才写死。

**en-US.json 现在只有结构**：键齐全、值先填的英文占位译文（不是空的，空串过不了检查）。
真正要发布英文界面时，需要的是译文校对 + 长文案的截断复查（见 §9）。

## 7. 设置页开关

设置 → 其他 面板底部：`#localeSelect`（跟随系统 / 中文 / English）+ `#localeHint`（当前生效语言与
"重启后生效"的提示）+ `#localeNow`。改完立刻写盘，但界面仍用当前语言——所以在旁边用文字说明
"改完要重开桌宠才会换语言；现在的语言：xxx"。

不做热切换是刻意的：窗口文案分布在 6 个页面、主进程还有托盘菜单和系统通知，热切换要保证"所有窗口
都重渲染 + 托盘重建 + 系统通知模板重取"，是另一个量级的改动，而收益对单用户桌面工具几乎为零。

## 8. 分阶段推进与基线

抽取按"一次一个窗口/一份数据"推进，每阶段一条提交、基线降一次：

| 阶段 | 范围 | 基线（该阶段结束时） |
|---|---|---|
| 一 | 骨架 + 主进程首批（托盘/提醒/主动说话）+ 设置页语言开关 | 880 |
| 二 | 桌宠窗口（标题 / 菜单 / alt / 喝水卡文案）+ 四个窗口标题 | 859 |
| 三 | 设置页（`settings.js` 238 + `settings.html` 173，最大的一块） | 待填 |
| 四 | 抠图 + 气泡布置编辑器 | 待填 |
| 五 | 数据层（`bubble-model` / `sound-model` / `lib/weather` / `lib/store`）与示例内容 | 待填 |

阶段一结束时 `--list` 的前五名：

```
app/settings.js 238 · app/settings.html 173 · app/bubble-model.js 99 ·
app/editor.js 54 · lib/weather.js 54          共 30 个文件 / 880 处
```

**已归零的文件**（0 处）：`app/main.js`、`app/main/tray.js`、`app/main/reminder.js`、`app/main/nudge-pump.js`
（只剩 1 处日志文案）、`app/preload.js`、`lib/nudges.js`（还剩 3 处兜底文案）、`app/overlay.js`、`app/onboard.js`、
`app/pet.html`（阶段二）、`app/main/windows.js`（阶段二；只剩文件头注释）。

### 8.1 阶段二：桌宠窗口与窗口标题（880 → 859）

这一阶段的真正教训是：**HTML 里不能留“备用中文”**。写 `data-i18n="pet.menu.quit"` 的同时把
“先退出啦”当文本子节点留着，看起来无副作用（反正启动就被盖掉），但基线永远数不降——
而且它给后来人一个错觉：“这里的中文是必要的”。所以阶段二把 `pet.html` 的中文全删了：
元素内容为空，`applyStatic()` 在 `pet.js` 开头一次填完；字典缺键时显示的是 key 本身（不是空白），
问题依然可见，只是从“看起来正常”变成“明显不对”。

三处具体决定：

1. **`alt` 优先用名字**：用户给桌宠起了名字（默认“小芳”）就不该翻译成 “Desk pet”。
   `pet.alt` 只是没名字时的兜底。
2. **喝水小语是“键数组”不是“文本数组”**：`WATER_TIPS = ['water.tip1'…]`，用的时候才 `t()`。
   这样按小时分档的三句（`water.late/start/good`）与五句循环句都在字典里，且避免在模块加载时
   就把语言钉死（语言要重启才生效，但测试与工具会换字典）。
3. **窗口标题在 `createWindows` 里解一次**：`title(key, fallback)` 小助手，`main.js` 只多传一个 `i18n`。
   不把 i18n 泄到每个 `openXxx()` 里，是因为标题只在建窗时定一次，改语言本来就要重启。

验证：`tools/e2e/cases/i18n.js`（`node tools/e2e/run.js i18n`）——真窗口里看 `document.title`、
`.nav-*` 与菜单项文本、`#pet` 的 `alt`、字典里的 `water.later`；切 `locale` 后重启再看一遍。
阶段二那次是先用一次性探针脚本量的（zh 8/8、en 5/5），探针没入库，**能复现的证据只有这条 e2e 用例**。

## 9. 已知限制与后续

1. **示例内容不翻译**：`bubble-model.js` 里「北京 / 晴 / 体感 11°」是编辑器预览的示例数据，
   `editor.js` 的「北京 / 记得喝口水呀～」同理。这些进语言包会让键爆炸，正确做法是给"示例城市"一个
   语言相关默认值（en 用 London / Sunny），留到阶段五一起处理。
2. **长文案要看排版**：英文普遍比中文长 40%–80%，卡片里的「明天 6~15° 多云」这类拼接句在 en 下可能
   溢出。`pet.js` 的 60% 字号下限 + 截断机制能兜住，但**必须在 en 界面下真窗口复验一遍**（§10 的 e2e）。
3. **运行时验证需要放开沙箱**：`launch.js` 起 Electron 在受限沙箱下会命中
   `mojo platform_channel.cc:108 Check failed: 拒绝访问 (0x5)`（HANDOFF §6.1 5.1），CDP 端口连不上。
   放开文件策略（danger-full-access）后实测可跑：`node tools/e2e/run.js` 4/4 通过（i18n 用例 4.4s）。
4. **打包未验证**：`locales/*.json` 需要进 asar。electron-builder 默认打包整个仓库（`files` 未显式收窄），
   所以预期会自动进去，但**没有实机装包验证过**，出包时要用 `npx asar list` 或直接跑装好的 exe 确认。
## 10. 阶段三-B：设置页整页改造（本次接手重做）

上一个会话把设置页批量换成了 `data-i18n`，但只改了一半：HTML 全换了、JS 只换了一部分，
语言包里预先塞了 400+ 条 `settings.*` / `finder` 键却没人引用，`smoke` 与 `check-a11y`
里写死中文的断言全红，`check-i18n` 报缺 470 个键。这轮的处理：

1. **先回退**（commit `ad3a0c2`）：把 `cutout.*` / `editor.*` / `diagnostics.*` 那批只改了代码、
   没写词典的改动退回 `113b60e` 之前，保证 `check` / `smoke` / `unit` 全绿，再往前推。
2. **接受设置页那部分**（HTML + `settings.js` 已改完的部分 + 两个语言包），它自洽：
   `data-i18n` 节点 142 个全部有值、`data-i18n-aria-label` 全部落到 `aria-label`。
3. **把搜索索引也本地化**：`FIND_INDEX` 仍是中文手写表（供 zh 兜底），加载后用
   `settings.find.<id>.label/.desc/.keywords` 覆盖 —— 这正是那 400+ 条闲置键的用途。
   en 下输入 `city` / `volume` 能命中；zh 下输入「城市」「音量」照旧命中。
4. **静态断言改成认 `data-i18n`**：`tools/smoke.js` 里两处、`tools/check-a11y.js` 里五处
   （搜索框名字、结果列表名字、最近城市行、确认按钮文案、导出按钮、空结果提示）。
   判断依据从“HTML 里有这串中文”改成“这个控件有可访问名称（`aria-label` 或 `data-i18n-aria-label`）”。
   运行时那侧靠 `tools/a11y-audit.js`（86 项 0 失败）兜底，比静态匹配更可信。

真窗口验证（`--remote-debugging-port=9270`，数据目录 `.dev-p26s3`）：

| 语言 | `data-i18n` 节点 | 空文案 | 缺 aria-label | 正文残留中文 | 搜索 |
|---|---|---|---|---|---|
| zh-CN | 142 | 0 | 0 | 194 处（JS 侧还没改完） | 「城市」1、「音量」1、「zzzz」0 且有中文提示 |
| en-US | 142 | 0 | 0 | **0** | `city` 1（"Which city · Weather"） |

（en 的 0 处残留说明设置页这一步真的整页通了；zh 的 194 处来自 `settings.js` 还没换的 toast /
状态文案，下一步接着清。）

剩余的活（阶段三-C 起）：`app/settings.js` 151 处、`app/bubble-model.js` 99 处、
`app/editor.js` 54 处、`lib/weather.js` 54 处、`app/cutout.js` 52 处。

## 11. 阶段三-C：`settings.js` 的清零

这一批只动一个文件：`app/settings.js` 从 **151 处**内联中文降到 **0**。

1. **索引彻底键驱动**：`FIND_SLOTS` 只留 `[面板, 控件 id]` 37 对，`label/hint/keys` 全部来自
   `settings.find.<id>.label/.desc/.keywords`。中文不再当“兜底”留在代码里——留着就永远数不清还剩多少。
   代价是 `smoke` 里“索引项必须对得上页面 id”的那条断言改了抓取格式（`['panel','id']`）。
2. **状态/提示走已有键**：托盘与快捷键的四段说明、更新状态、语言状态、恢复默认失败、设置读取失败，
   语言包里本来就有对应键（`other.trayOk`、`other.shortcutFailedWithReason`、`other.updateStatus`…），
   这次只是把代码接上去，少写 14 条重复文案。
3. **新加的 14 条键**：城市搜索与定位那组（`settings.status.cityEmpty/searching/searchError/searchNone/
   searchFound/searchFailed/citySaved/geoUnavailable/locating/located/geoFailed`）以及
   `settings.geoCityName`、`settings.geoCityLabel`、`settings.weatherAutoLabel`。
   “我找到的位置”这个哨兵值也走字典（`geoCityName()`），不再在代码里硬编码中文。

真窗口复验（同一数据目录，切换 `locale` 后重启）：

| 语言 | 状态行 | 托盘说明 | 更新行 | 空城市提示 | 正文中文 |
|---|---|---|---|---|---|
| zh-CN | 不用点保存就行 | 托盘图标已经交给系统了…（长句完整） | 当前 0.6.9 · 上次检查：还没查过… | 先写下城市名呀 | 178（就是这些中文本身） |
| en-US | No save button needed | The tray icon is with the system… | Current 0.6.9 · last checked: Never checked… | Type a city name first | **0** |

基线 **599 → 448**（`tools/i18n-baseline.json` 已更新）。剩下最大三块：
`app/bubble-model.js` 99、`app/editor.js` 54、`lib/weather.js` 54、`app/cutout.js` 52（+ `cutout.html` 42）。

## 12. 阶段三-D：`lib/weather.js` 也搬进语言包

`lib/weather.js` 是纯 Node 的取数与文案模块（主进程、单测、烟测都用它）。它原来把
WMO 码表、AQI 分级、三天标签、建议句都写成中文字面量，共 **54 处**。

做法是**显式注入翻译器**，不做模块级全局状态：

1. `WMO` 从 `[文案, 图标]` 变成 `WMO_ICON`（只剩图标），文案走 `weather.code.<码>` /
   `weather.code.unknown`；`describe(code, t)`。
2. `AQI_LEVELS` 从 `{max, text, tip}` 变成 `{max, key}`，文案走
   `weather.aqi.<key>.name/.tip`；`aqiGrade(value, t)`。
3. `parseDays(daily, t)` 的三天标签走 `weather.day.today|tomorrow|dayAfter`（标点/语序交给语言包）。
4. `advice(weather, t)` 的九种情况一律 `weather.advice.*`（雪/雨/冷/凉/晒/热/风/舒服/兜底）。
5. `fetchWeather({…, t})` / `fetchAirQuality(lat, lon, t)` 把 `t` 透传下去；`weather.error.missingCoords`
   接替“缺少经纬度”的硬编码。
6. **没传 `t` 时退回键名**（`weather.code.61`），开发期一眼看出漏翻，不静默退化成中文。

调用链只改了三处：`createWeatherPump` 多收一个 `t`（`main.js` 把现成的 `t` 传进去），
`tests/unit/weather.test.js` 与 `tools/smoke.js` 各自用 `createI18n({ dict: zh-CN })` 造一个翻译器。
单测里注意 **`node:test` 的回调第一个参数就叫 `t`（TestContext）**，所以测试里的翻译器命名为 `tr`，
否则会被 TestContext 遮住（这个坑花了一轮才发现）。

双语文案抽查（`describe` / `advice` / `aqiGrade` / `parseDays`）：

| 语言 | 天气码 | 建议 | AQI | 三天 |
|---|---|---|---|---|
| zh-CN | 小雨 / 雷阵雨 / 未知天气 | 热热的，多喝水、少在太阳下站着 | 良 - 空气不错，出去走走正好 | 今天 晴 / 明天 阴 / 后天 小雨 |
| en-US | Light rain / Thunderstorm / Unknown weather | Hot out — drink water, stay out of the sun | Good - Nice air — a good time for a walk | Today Clear / Tomorrow Overcast / The day after Light rain |

基线 **448 → 393**。还没搬的：`app/bubble-model.js` 99、`app/editor.js` 54、`app/cutout.js` 52、
`app/cutout.html` 42、`lib/store.js` 29（默认聊天气泡的设置项文案）。

### 阶段三-E：抠图窗口（已完成）

- `app/cutout.html`：42 处静态文案 → `data-i18n*`；`<title>`、`h1`、按钮、`aria-label`、`placeholder` 都走键。
- `app/cutout.js`：`VIEW_LABEL` 常量删除，改用 `viewLabel(view)`（`cutout.view.*`）；模式标签用 `cutout.mode.<state>`
  （状态值 `none/original/cutout/fallback/failed` 与键名一一对应，不必再写 switch）；状态句用 `t(key, vars)`。
- 新增一个语言包键：`cutout.status.dropHint`（拖错文件时的提示）。
- 抠图窗口原本没引 `app/i18n.js`，这次补上 `<script src="i18n.js">` 并在 boot 时 `applyStatic`，
  这样静态文案不再需要 JS 二次赋值。
- 验证：同一数据目录切换 `locale` 重启，zh 下 155 个汉字、en 下 0 个汉字；标题/按钮/`aria-label` 全部跟着变。


### 阶段三-F：气泡布置窗口（已完成）

- `app/editor.js` 的 54 处文案改 `tr()`：卡片标签/上下移、行操作按钮、模块类型下拉、样式面板（大小/加粗/斜体/颜色/底色）、
  预设切换、状态提示、两次 `confirm`。预览用的示例数据（城市、天气、喝水句）也走键，这样 en 下预览不会中英混排。
- `app/editor.html` 13 处 → `data-i18n` / `data-i18n-aria-label`；补上 `<script src="i18n.js">`。
- 顺手修了 `tools/check-a11y.js` 的“按钮要有可访问名称”规则：文案搬进语言包后按钮可能只剩 `data-i18n*`，
  现在把它也算作名字（静态检查 16 个假失败归零）。
- 坑：`editor.js` 是 CRLF，用 `\n` 写的锚点字符串匹配不到，第一次注入静默失败 → 页面全中文。
  改为先找锚点、再按现有换行拼接，并加 `node --check` 兜底。
- 验证：同一数据目录 zh/en 重启后，en 下标题、三个按钮、预设组 aria-label、五个预设名、提示语、预览标签、加号按钮全英文；
  预览区剩余中文来自 `bubble-model.js`（阶段三-G）。a11y-audit 86/0。

### 阶段三-G：气泡布置的数据与模块文案（已完成）

- `app/bubble-model.js`：`TYPES` 里的 `label`/`sample` 换成 `labelKey`/`sampleKey`（`bubble.type.*` / `bubble.sample.*`），
  模块清单不再内联中文；`valueOf(type, ctx)` 从 `ctx.t` 取翻译器，**没传翻译器时返回键名**（开发期能一眼看出漏翻，
  而不是悄悄显示英文或空白）；`defaultLayout(translate)` / `normalizeLayout(raw, translate)` 接受翻译器，
  默认卡片的名字/文案/日期/喝水句/天气句全部来自语言包。
- `app/pet.js`、`app/editor.js`：把渲染层的 `t` / `tr` 传进 `normalizeLayout`，否则没有 `bubble.layout` 的新用户会看到键名。
- 顺手修了一个**启动顺序 bug**：`registerI18nIpc` 原本在 `createWindows` 之后才注册，而 preload 用
  `sendSync('i18n:boot')` 同步取字典——桌宠窗口先加载，拿到的是兜底 `zh-CN`，切 en 后只有后开的窗口是英文。
  现在 i18n 通道紧跟在 `createMainI18n` 之后注册（`app/main.js:170` 附近）。
- 验证：zh 一轮 11/11（气泡 2 行中文、无漏翻键名；布置页标题/预设中文）；en 一轮 9/9（页面 `lang=en-US`、
  菜单/预设/布置页全英文、无 `editor.*`/`bubble.*` 键泄漏）。a11y-audit 86/0。
- 已知未完成：`settings.bubble.phrases` 的默认短语存在 `lib/store.js`（中文），所以 en 下气泡里那句"想你了…"仍是中文。
  这是**用户可编辑的内容**，下一步要么按语言给不同的初始短语，要么把默认值改成键名。

基线 **299 → 134**（`lib/store.js` 29 · `app/main/ipc.js` 19 · `app/main/diagnostics.js` 16 · `app/onboard.html` 13 ·
`app/sound-model.js` 11 是剩下的大头）。

### 阶段三-H：首次引导卡（已完成）

- `app/onboard.html` 13 处静态文案 → `data-i18n*`，引入 `i18n.js`；`app/onboard.js` 启动时 `applyStatic`。
- 语言包新增 `onboard.*` 12 条（标题/招呼/导语/三步文案/脚注/两个按钮）；两种语言都写全。
- HTML 里只保留默认名字「小芳」两个字（它来自用户设置，`greet()` 会用真实名字覆盖）。
- `tools/check-a11y.js` 的「按钮要有可访问名称」规则补上 `data-i18n`（和之前 editor/settings 一致），否则清空文案的按钮会被判无名。
- 验证：全新数据目录 zh 161 个汉字、按「知道啦」；切 en-US 重启后 `Welcome to Desk Pet` / `Got it`、正文汉字 0。

基线 **134 → 122**。

### 阶段三-I：主进程的对话框与错误（已完成）

- `app/main/ipc.js` 19 处 → 0：对话框标题/过滤器名（挑角色图、挑人像、添加音频）、
  返回给渲染层的 `error`（图片打不开、文件找不到、超 25MB、没拿到照片、音频超 8MB…）、
  新增角色图时的默认名字「照片角色」。
- `registerIpc(deps)` 增加 `deps.i18n`，内部 `const tr = (key, vars) => i18n ? i18n.t(key, vars) : key`；
  缺翻译器时退键名，和 3-G 的 `valueOf` 一致，开发期一眼看得出来。
- `cutout-service.decodeImageDataUrl` 抛的错误带 `err.code = 'NO_DATA'`，IPC 层用 `decodeError()`
  映射成 `error.noData` 再返回——错误码不该把中文文案当协议用。
- 验证：en 数据目录重启后 `loadCutoutPhoto` 返回 `Didn't receive the image data`；zh 目录返回原文。

基线 **122 → 103**。

### 阶段三-J：音效名与"当前选择"（已完成）

- `app/sound-model.js` 11 处 → 0：5 个内置音色（叮/啵/水滴/三音/轻提示）、3 个触发点
  （点击角色/气泡出现/喝水提醒）、3 个占位语（未选择/未知音色/文件已删除）。
- 模式与 3-G 一致：`PRESETS[].label` → `labelKey`（`sound.preset.*`），`EVENTS[].label` → `labelKey`
  （`sound.event.*`）；`fragmentLabel(fragment, files, t)` 多收一个翻译器，缺省退键名。
- `app/settings.js` 改用 `t(meta.labelKey)` / `t(p.labelKey)`，并加了 `fragmentLabelT` 适配层，
  这样调用点不用各自传 `t`。
- **踩到一个真坑**：语言包里三段的键一开始被写成了扁平的 `sound["preset.ding"]`（拆分只按第一个点），
  于是界面上直接把键名当文案显示。修为嵌套对象，并补了 en 面板实测（`Clicking the character` / `Water drop`）。

基线 **103 → 92**。

### 阶段三-K：诊断导出（已完成）

- `app/main/diagnostics.js` 16 处 → 0：标题、分节名（应用/托盘与快捷键/屏幕/天气缓存/设置/两个日志尾巴）、
  字段名与冒号分隔符都进字典（`diag.*`）；英文用 `: `，中文用全角`：`。
- `createDiagnostics` 收 `t`，内部 `tr(key) = t('diag.' + key)`，缺翻译器退短键名。
- 脱敏标记从 `[已脱敏]` 改成固定英文 `[redacted]`——它是数据契约的一部分，不该随语言变。
- 验证：en 数据目录 `exportDiagnostics()` 产物头部 = `# Desk Pet diagnostics` / `Generated:` / `## App` / `Version: 0.6.9`。

基线 **92 → 76**。

### 阶段三-L：隐私面板的网络清单（已完成）

- `app/main/privacy.js` 10 处 → 0：五个域名的「做什么 / 什么时候连」改成 `privacy.net.<id>.what|when`，
  只在 `summary()` 生成时翻译（`tr()` 缺翻译器退键名）。
- 同时把数据里的 `id` 留下来：渲染/排序用 id，翻译按 id 查，不让展示文案当主键。
- 单测原来断言 `entry.what && entry.when`，现在断言「每行有 id 且能拼成 `privacy.net.<id>`」——
  翻译是否齐全由 `check-i18n` 保证，单测不需要重复。
- 验证：en 数据目录 `privacySummary().endpoints[0]` = `turns a city name into coordinates`。

基线 **76 → 66**。

### 阶段三-M：内置短语搬进语言包（已完成）

- `lib/store.js` 里 24 条内置短语文案 → `locales/*.json` 的 `bubble.phrasesSeed`（数组，zh/en 各 24 条）；
  `DEFAULT_PHRASES` 变成 `[]`。用户自己的短语仍存在 `settings.bubble.phrases`，为空就用种子。
- **数组走不了 `flatten`**（那里只收字符串），所以给 `createMainI18n` 加了 `seedOf(key)`：按点路径取值、
  优先当前语言、退 zh-CN、再退 `[]`。IPC `state:get` 带出 `phrasesSeed`，`pet.js` 在首次快照里存一份。
- 设置页短语输入框空着时显示占位提示「留空就用我内置的那几句话」，让"空 = 用内置"可发现。
- 验证：en 数据目录点一下宠物 → 气泡正文 `Cold hands? Go get a mug of hot water.`（种子第 12 条），
  `getState().phrasesSeed.length === 24`。

基线 **66 → 42**。

踩坑：把 `phrasesSeed` 直接挂到 `state` 上时引用了不存在的 `payload` 变量，渲染层 `boot()` 抛 `ReferenceError`，
表现是"点宠物没反应"。教训：渲染层启动失败不会弹窗，只能看 `app.log` 里的 `pet-console` 行。

### 阶段三-N：窗口标题 / 星期 / 抠图报错（已完成）

- `app/main/windows.js` 4 处：窗口标题的兜底中文去掉，`title(key)` 缺翻译器时**退键名**而不是中文。
- `lib/water-log.js` 7 处：`WEEK_NAMES` 数组删掉，`summarize(log, now, fallback, t)` 多收翻译器，
  星期用 `date.weekday.<0-6>`；调用方 `app/main/water-ipc.js` 从 `ipc.js` 拿 `t`。
- `app/main/cutout-service.js` 8 处 → 2：模型没准备好 / 没结果 / 没找到人像 / 占太满 / 格式 / 空图
  / 超 25MB 全部进 `cutout.err.*`；`createCutoutService` 收 `deps.t`。
- **只留 2 处**在 `decodeImageDataUrl`：它是模块级函数、拿不到 `t`，保留中文并在 IPC 层按 `NO_DATA`
  错误码翻译。教训：给模块函数塞翻译器前先确认它有没有实例上下文。
- 验证：en 数据目录 `loadCutoutPhoto` 报 `Didn't receive the image data`；`getWaterStats().week` 末两天 =
  `Friday` / `Saturday`；窗口标题 `Desk pet`；zh 同一份代码按 locale 转身。

基线 **42 → 24**。
