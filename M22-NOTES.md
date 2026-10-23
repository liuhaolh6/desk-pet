# M22：喝水记录（ROADMAP P1-5）

> 目标：把「提醒喝水」从一句话变成能回看的东西——`稍后 10 分钟`、今日时间轴、本周杯数、导出 CSV，全部只存在本机。
> 日期：2026-10-23 · 分支 `main` · 未发版（0.7.0 候选）

## 1. 做了什么

| 位置 | 改动 |
|---|---|
| `app/main/water-ipc.js`（新，75 行） | 四个通道：`pet:water-done`（记一杯、清 snooze）、`pet:water-snooze`（1–120 分钟）、`water:stats`、`water:export` |
| `lib/water-log.js`（新，109 行） | 纯函数：`dayKey`/`startOfDay`/`clockOf`/`cleanLog`/`summarize`/`toCsv`。本地时区、七天窗口、老 `today.cups` 升级路径 |
| `lib/store.js` | `water.cupMl`（默认 200）、`water.snoozeUntil`、`water.log`（+`WATER_LOG_MAX=500`）；`normalizeWater()` 在读/写两处排序、去坏数据、截断 |
| `app/main/reminder.js` | `tick()` 在隔间判定之前先判 `snoozeUntil`，返回 `'snoozed'` |
| `app/main/ipc.js` | 接上 `registerWaterIpc(...)`；喝水逻辑不再堆在 `ipc.js` 里（403 行） |
| `app/preload.js` | `waterSnooze` / `getWaterStats` / `exportWaterCsv` 三个方法 |
| `app/pet.js` | 气泡按钮「待会儿」→「稍后 10 分钟」，按下写 10 分钟 snooze 并收起 |
| `app/settings.html` / `.css` / `.js` | 提醒页新增「喝水记录」卡：今日时间轴（`ol` + `aria-labelledby`）、最近七天（`ul`，今天 `aria-current="true"`）、杯量输入（50–1000ml）、导出按钮；切到提醒页自动刷新 |
| `tools/smoke.js` | 新增「P1-5 喝水记录」块；模块名单加 `water-ipc.js` |
| `tools/check-a11y.js` | 新增 8 条（时间轴/本周/杯量/导出按钮/文字反馈/不只靠颜色） |

## 2. 设计决定

1. **`snoozeUntil` 与 `lastDrinkAt` 分开。** 「稍后 10 分钟」是明确的「别现在」，不是「喝过了」——混进 `lastDrinkAt` 会把提醒推迟一整个间隔（默认 60 分钟），而且会污染「今天几杯」。
2. **判定顺序：勿扰模式 → 勿扰时段 → snooze → 间隔 → 10 分钟限流。** snooze 必须早于间隔：用户刚点完「稍后」时 `now - lastDrinkAt` 一定还小于间隔，先判间隔就永远看不到 snooze。
3. **每杯记录当时的杯量。** `log` 里每项是 `{at, ml}`，改「一杯多少毫升」只影响之后那几杯，老记录保持原值——历史不该被新设置改写（CDP 验证里 200/200/250 三行就是这个意思）。
4. **记录放 `settings.json`、上限 500 条。** 单独开一个 `water.json` 会让备份/迁移多一个文件；500 条大约是一年多的量，超过后丢最老的。手写文件里的坏数据在读和写两处都清（`normalizeWater`）。
5. **统计与 CSV 都是纯函数（`lib/water-log.js`）。** 主进程只负责取 `store` 和时间戳；这样 `node --test` 能覆盖九成逻辑，CDP 只验「UI 是否接对」。
6. **本周窗口是「今天往前数 7 天」而不是自然周。** 自然周会让周一的柱子突然全空，回看体验差；滚动 7 天每天都有意义。
7. **CSV 不用系统保存对话框。** 与「导出诊断信息」保持一致：写到数据目录 + `showItemInFolder`。好处是脚本能直接验证（对话框在自动化里会卡住），也永远不会因为对话框挡住而让设置窗口假死。
8. **导出反馈写在说明行里，不只靠状态栏。** 状态栏 2.2 秒就恢复默认文案，路径会丢；`#waterExportHint` 留着「已导出 <路径>（N 行）」。

## 3. 验证

| 手段 | 结果 |
|---|---|
| `npm run check` | 35 个 JS 文件语法通过（新增 `water-ipc.js`、`lib/water-log.js`、`tests/unit/water-log.test.js`） |
| `npm test` | smoke **59 项** + unit **75 例**（新增 `water-log.test.js` 15 例） |
| `node tools/check-a11y.js` | **84 项** 全通过 |
| `node tools/a11y-audit.js --port 9229` | **86 项 / 0 失败** |
| `node tools/a11y-keyboard.js --port 9229` | **6/6** |
| CDP 运行时（`.tmp/cdp-p15.js`） | **19/19**：`waterSnooze(10)` 写入且不加杯 → 连喝两杯写两条 log、清 snooze → `water:stats` 时间轴 `HH:mm`、七天且今天在最后 → 设置页「今天第 2 杯，共约 400 毫升」、两条时间轴、今天 `aria-current` + 柱宽 100% → 改 250ml 后新一杯记 250 → 导出提示「（3 行）」→ CSV 表头 `date,time,ml`、三行、老记录仍是 200 |

## 4. 踩到的坑

1. **`ipc.js` 撞到 smoke 的 430 行上限。** 加完喝水通道 450 行，第一条断言就红。没有调高上限，而是按既有做法抽成 `water-ipc.js`（和 `weather-pump.js` 同样的理由）；`ipc.js` 回到 403 行。
2. **给设置项加一行标签，会让「每个设置项都有一句话说明」失败。** smoke 的规则是「`.field-label` 必须有 `.field-hint` 兄弟」，「最近七天」只有列表没有说明 → 补一句「从今天往前数七天，杯数最多的一天最满」。
3. **生成脚本里的正则转义会双写。** 写 `.tmp/cdp-p15.js` 时把 `/^\d{2}:\d{2}$/` 写成了 `/^\\d{2}:\\d{2}$/`（匹配字面反斜杠），两条断言假失败。用 Python 改测试脚本时一律按「文件里最终要几个反斜杠」核对。
4. **CDP 脚本会污染数据目录。** 第一遍跑挂掉时已经喝了两杯，第二遍从 2 开始数，期望值全错。运行时验证一律「先杀进程 + 删 `.dev-p15` 再启动」，用例里也不写死绝对值以外的假设。
5. **`git add` 前要 `touch` 手改过的文件。** 仓库 `core.autocrlf=true`，`ops_edit_file` 保持 mtime，git 会认为没变。

## 5. 没做的

- 没有「撤销上一杯」：误点一次只能改 CSV 或手写 `settings.json`（记录上限 500，影响很小）。
- 没有跨设备同步、没有云备份（产品定位就是本机数据）。
- 「本周」不做自然周切换、不做月视图、不做柱状图坐标轴（桌面宠物上没人会看）。
- 提醒投递仍沿用原逻辑（气泡优先、隐藏时系统通知），没有加「点通知就直接记一杯」。

## 6. 下一步

ROADMAP P1 还剩 P1-6（天气增强：空气质量、三天、日出日落）、P1-7（气泡时机三触发器）、P1-8（真机 a11y）、P1-9（CDP 三脚本入库 + CI）。