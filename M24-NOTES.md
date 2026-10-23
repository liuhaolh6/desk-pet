# M24 · 主动说话（P1-7）

> 2026-10-23 · 对应提交：`feat(P1-7): 主动说话——久坐/深夜/久未互动，全屏时闭嘴`
> 前置：[`M23-NOTES.md`](M23-NOTES.md)（P1-6 天气增强）、[`ROADMAP.md`](ROADMAP.md) P1-7。

## 1. 做了什么

| 维度 | 之前 | 现在 |
|---|---|---|
| 开口时机 | 只有被点、喝水提醒、天气到点 | 另加三条本地规则：连续用满 50 分钟、23 点后还在用、两小时没互动 |
| 打扰边界 | — | 前台全屏（游戏/视频/演示）一律不说；安静模式/`snoozeUntil`/10 分钟限流照旧 |
| 可配置 | — | 设置 → 提醒 多出「主动说话」总开关 + 三个触发器，都能单独关 |
| 提示语 | 固定 24 条温馨语句 | 每条规则有自己的候选句（久坐 4 / 深夜 3 / 招呼 5），随机取一条 |

## 2. 设计决定

**决策与调度分开。** `lib/nudges.js` 是纯函数：`decide({ now, cfg, quiet, sessionStart, lastInteraction, lastNudgeAt })`
返回 `{kind, text}` 或 `null`。所有"该不该说、说什么"都在这里，能直接 `node:test`；`app/main/nudge-pump.js` 只负责
每分钟喂一次时间、`sendToPet()`、写日志。这样 P1-7 的验收（三个触发器可单独关）可以只用单测证明，不用起窗口。

**"久坐"和"离开"共用 `lastInteraction`。** 语义钉死：`sessionStart` = 本次启动后第一次互动（进程启动时也置为 now，
避免开机挂机被当成"连续使用"），`lastInteraction` = 任何动作（点角色、开菜单、开设置、气泡交互、拖动）。
于是"久坐"= `now - sessionStart ≥ 50min` **且** `now - lastInteraction ≤ 50min`（还在动），
"离开"= `now - lastInteraction ≥ 120min`。两个条件互斥，不会同一分钟两条都触发。

**全屏检测用 PowerShell，不用 Electron API。** `BrowserWindow.isFullScreen()` 只对自己的窗口有意义；
要判断"前台是别人的全屏应用"，`app/main/fullscreen.js` 用 `execFile` 调一次 PowerShell（读前景窗口矩形、
与 `SystemInformation` 的工作区比对、再看任务栏是否可见），结果缓存 2 秒并存"进行中"状态避免并发重复调用。
**探测失败一律按"不是全屏"处理**——宁可多冒一句，也不能因为脚本在某些机器上不可用就永远不说话。
这是有意的偏置，写在代码注释里。

**说话复用气泡出口。** `sendToPet()` 发 `pet:nudge`，渲染层 `showNudge()` 走的就是普通气泡（`showBubble()` 同一套
几何与"点一下收起"），没有另开窗口或通知，避免又一套焦点/命中逻辑。

**探针可注入。** `nudges.probe(now, opts)` 允许覆盖 `sessionStart/lastInteraction/lastNudgeAt/cfg/quiet`，
只读、不改状态，给设置页与 CDP 验证复现"用了 51 分钟""离开两小时"用。
这条是给测试用的口子，不属于用户功能，所以没有暴露按钮。

## 3. 验证

| 层面 | 手段 | 结果 |
|---|---|---|
| 纯决策 | `tests/unit/nudges.test.js`（11 例） | 三触发器、优先级（久坐 > 离开）、全屏/安静/限流/`snooze` 全绿 |
| 静态门禁 | `npm run check` / `npm test` / `check-a11y` | smoke **61** 项、unit **100** 例、check-a11y **84** 项 |
| 运行时无障碍 | `a11y-audit` / `a11y-keyboard`（端口 9229） | 86/0、6/6 |
| 运行时功能 | `D:\project\.tmp\cdp-p17.js` | **9/9**：互动被记下 → 推进 51 分钟出久坐 → 推进 190 分钟出招呼 → 真冒泡 → 点一下收起 → 安静模式不开口 → 设置四个开关在 → 关掉落盘 → 再打开恢复 |

## 4. 踩坑

**推进时钟同时推进了 `lastInteraction`。** 第一版 CDP 用例只把 `now` 加 51 分钟，`sinceTouch` 也跟着变成 51 分钟，
`sinceTouch <= 50min` 不成立，于是"久坐"永远测不出来（返回 null）。真实场景里人一直在动、`lastInteraction` 是新的，
所以要么让探针支持注入状态，要么只能等 50 分钟。这就是 `probe(now, opts)` 的来源；单测里同样用固定 `now` 手算期望值。

**`probe()` 的签名一改，IPC 必须跟着改。** `ipcMain.handle('nudge:probe', (ev, opts) => nudges.probe(opts && opts.now, opts || {}))`——
只传 `now` 的话，`opts` 里的覆盖值会被静默丢掉，现象和没改一样。

**设置窗口不常驻。** 运行时要测开关落盘得先 `deskPet.openSettings()` 再把 CDP 目标重新列一遍
（`/json/list` 里才有设置页），不能复用宠物页的连接。

## 5. 没做 / 边界

- 不看窗口标题猜"在写代码还是在看视频"——误报代价太高，规则只用到时间。
- 不接系统勿扰（Win11 焦点助手）状态；只看应用自己的安静模式与安静时段。
- 不学习用户习惯（没有"你通常这个点休息"）；`decide()` 的输入就那五个，行为可预测、可复现。
- 全屏检测是 2 秒缓存 + 每分钟一次，进入/退出全屏的最坏延迟约 1 分钟；对这个功能足够。