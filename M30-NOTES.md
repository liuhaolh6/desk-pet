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
| 二 | 桌宠/气泡窗口 + 窗口标题 + 主进程对话框/通知 | 待填 |
| 三 | 设置页（`settings.js` 238 + `settings.html` 173，最大的一块） | 待填 |
| 四 | 抠图 + 气泡布置编辑器 | 待填 |
| 五 | 数据层（`bubble-model` / `sound-model` / `lib/weather` / `lib/store`）与示例内容 | 待填 |

阶段一结束时 `--list` 的前五名：

```
app/settings.js 238 · app/settings.html 173 · app/bubble-model.js 99 ·
app/editor.js 54 · lib/weather.js 54          共 30 个文件 / 880 处
```

**已归零的文件**（0 处）：`app/main.js`、`app/main/tray.js`、`app/main/reminder.js`、`app/main/nudge-pump.js`
（只剩 1 处日志文案）、`app/preload.js`、`lib/nudges.js`（还剩 3 处兜底文案）、`app/overlay.js`、`app/onboard.js`。

## 9. 已知限制与后续

1. **示例内容不翻译**：`bubble-model.js` 里「北京 / 晴 / 体感 11°」是编辑器预览的示例数据，
   `editor.js` 的「北京 / 记得喝口水呀～」同理。这些进语言包会让键爆炸，正确做法是给"示例城市"一个
   语言相关默认值（en 用 London / Sunny），留到阶段五一起处理。
2. **长文案要看排版**：英文普遍比中文长 40%–80%，卡片里的「明天 6~15° 多云」这类拼接句在 en 下可能
   溢出。`pet.js` 的 60% 字号下限 + 截断机制能兜住，但**必须在 en 界面下真窗口复验一遍**（§10 的 e2e）。
3. **运行时验证需要 danger-full-access**：`launch.js` 起 Electron 在本沙箱下会命中
   `mojo platform_channel.cc:108 Check failed: 拒绝访问 (0x5)`（HANDOFF §6.1 5.1），CDP 端口连不上。
   所以 `tools/e2e/cases/i18n.js` 写好了但**本机无法执行**，需要在放开沙箱的会话里跑一次
   `npm run test:e2e`。
4. **打包未验证**：`locales/*.json` 需要进 asar。electron-builder 默认打包整个仓库（`files` 未显式收窄），
   所以预期会自动进去，但**没有实机装包验证过**，出包时要用 `npx asar list` 或直接跑装好的 exe 确认。