# M21：设置可用性（ROADMAP P1-4）

> 目标：让设置页「找得到、看得懂、改得回来」——面板搜索、每项一句话说明、按面板恢复默认、最近用过的城市。
> 日期：2026-10-23 · 分支 `main` · 未发版（0.6.7 候选）

## 1. 做了什么

| 位置 | 改动 |
|---|---|
| `app/settings.html` | 侧边栏顶部加搜索框（`#settingSearch`，`type="search"` + `aria-label` + `aria-describedby`）、结果容器 `#searchResults`、提示 `#searchHint`；顶栏加「恢复这页默认」按钮 `#resetPanelBtn` 与确认层 `#resetConfirm`（`role="alertdialog"`）；天气页加 `#recentCities`；声音页「什么时候响」补一句说明 |
| `app/settings.css` | 搜索框/结果行、确认层、`.chip-city`、`.ghost-small`、`.field-flash`（定位时闪一下），共 +155 行 |
| `app/settings.js` | `FIND_INDEX`（28 条）+ 三档打分 `findMatches()`；`renderFindResults()` / `revealSetting()` / `wireFind()`；`panelResetPatch()` + `wireReset()`；`renderRecentCities()` / `noteRecentCity()`。+278 行，总 790 行 |
| `app/main/ipc.js` | 新增只读通道 `settings:defaults`（3 行） |
| `app/preload.js` | `getDefaults()`（1 行） |
| `lib/store.js` | `DEFAULT_SETTINGS.weather.recent`、`defaults()` 深拷贝、`normalizeRecent()` 在 `readSettings()`/`writeSettings()` 两处规整（+28 行，总 332 行） |
| `tools/smoke.js` | 新增「P1-4 设置可用性」块（58 项总数不变是因为计数按分组 `ok()`） |
| `tools/check-a11y.js` | 新增 19 条静态断言（76 项） |

## 2. 设计决定

1. **搜索索引写在 JS 里，不扫 DOM。** DOM 里能读到的只有标签文字，读不到「响度」「几杯」「别吵」这些用户真正会敲的词。代价是索引可能和 HTML 脱节——smoke 用 `id="…"` 反查：索引里每个 `id` 都必须在 `settings.html` 里存在，且七个面板都要有覆盖，漏了直接红。
2. **三档打分：标题 3 > 同义词 2 > 面板名/说明 1。** 只按 `includes` 排，稳定且可解释；最多 8 条，避免「搜一个词刷一屏」。不做模糊匹配与拼音——`geocode` 那条拼音提示是城市搜索的事，设置项不需要。
3. **跳转三件事：切面板 → `scrollIntoView({ block: 'center' })` → 闪一下 + 焦点落到控件。** `prefers-reduced-motion` 时把 `behavior` 从 `smooth` 换成 `auto`；闪一下是 1.2s 的一次性动画（reduced-motion 下由全局规则压到 0.01ms）。
4. **恢复默认的默认值只有一个来源：`store.defaults()`。** 前端不再抄一份默认值；`panelResetPatch()` 只负责「这一页包含哪些键」，值全部来自主进程的深拷贝。角色页没有默认值（它是图片），按钮点下去明确提示「这一页没有可以恢复的默认值」，而不是禁用得让人猜。
5. **确认层是 `role="alertdialog"` + 面板名 + 默认聚焦确认键**，Esc 与点外部都能退。只改当前页，`bubble.layout`（用户排的版）不在任何一页的恢复范围里。
6. **最近城市在 store 里规整，不在 UI 里规整。** 手写 `settings.json` 塞进重复/空城市也必须收敛，所以 `normalizeRecent()` 挂在读和写两处：去空白、去空串、去重（保留首次出现）、最多 5 条。UI 只负责「选中后提到最前」。
7. **`settings:defaults` 是只读的**，不写盘、不带用户数据；`preload` 只加一个方法，不扩大 contextBridge 面积。

## 3. 验证

| 手段 | 结果 |
|---|---|
| `npm run check` | 32 个 JS 文件语法通过 |
| `npm test` | smoke **58 项** + unit **60 例** 全绿 |
| `node tools/check-a11y.js` | **76 项** 全通过（搜索框名称/描述、结果区非伪列表、`aria-expanded` 双向、真按钮、键盘可达、空结果文字提示、确认层 `alertdialog` 名称/说明/Esc、最近城市 `aria-pressed`、每项一句说明） |
| `node tools/a11y-audit.js --port 9229` | **86 项 / 0 失败**（真实 DOM，含 320px 回流、forced-colors、reduced-motion） |
| `node tools/a11y-keyboard.js --port 9229` | **6/6** |
| CDP 运行时（`.tmp/cdp-p14.js`） | **17/17**：搜「音量」→ 1 条结果（`声音 · 响度`）；点结果 → 面板切到 `sound`、焦点落 `soundVolume`、列表收起、状态栏「找到了：音量」；搜 `zzzz` → 文字提示；改 `name`/`size` 后点「恢复这页默认」→ 确认层弹出且焦点在 `resetOk`、面板名「外观」→ 确认后 `小芳`/220 回来、没动过的 `alwaysOnTop` 保持；`weather.recent=['深圳','杭州','深圳']` → 2 个 chip、当前城市 `aria-pressed="true"`、点 chip 回填输入框 |

## 4. 踩到的坑

1. **`python - <<'PY'` 的长脚本会被截断。** 9 KB 以上的 heredoc 在 DSH bash 里报 `here-document at line 1 delimited by end-of-file`，改用「写 `.py` 文件再 `python 文件`」。
2. **同一天重复打补丁会重复插段。** 两次运行同一个 CHANGELOG 脚本把「### 设置」插了两遍；改文档的脚本要幂等（先断言目标段落只出现一次），出错后先用 `grep -c` 确认再修。
3. **`npm test` 里的 `node --test "tests/unit/*.test.js"` 在 git-bash 下会被 MSYS 展开**，直接写路径列表最稳；`package.json` 里用引号包住 glob 就不会被 bash 提前展开。
4. **`git diff` 只报 611 插入/3 删除**不代表行尾没问题：本仓库 `core.autocrlf=true`、`.gitattributes` 没有 `text=auto`，工作树里的 LF 会被正常归一。真正要 `touch` 的是 `ops_edit_file` 改过、mtime 没变的文件，否则 `git add` 会静默跳过。

## 5. 没做的

- 搜索没有做输入防抖（28 条索引全内存过滤，一次 `input` 事件的开销小于一帧，防抖反而让键盘操作变钝）。
- 索引没有自动从 HTML 生成；靠 smoke 的 id 反查兜底，加字段时记得同步 `FIND_INDEX`。
- 恢复默认只覆盖五个有默认值的面板；「角色」页按设计不给。
- 没有给搜索加「最近搜索」或快捷键唤起（`Ctrl+Alt+P` 是桌宠显示/隐藏，不抢）。

## 6. 下一步

P1-5（暂定）之前先把 P1 的收尾做掉：`ROADMAP` 里 P1-4 之后的项按顺序推进，每项都保持「代码 → 静态门禁 → 运行时验证 → 文档 → 单独提交」的节奏。