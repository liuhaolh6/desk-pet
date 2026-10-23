# M26 · 真窗口 e2e 入库（P1-9）

> 2026-10-23 · 对应提交：`test(P1-9): 真窗口 e2e 入库——noresize / collapse / city + CI headless` 起的
> 前置：[`ROADMAP.md`](ROADMAP.md) P1-9、[`HANDOFF.md`](HANDOFF.md) §6（环境坑）。

## 1. 做了什么

散在 `D:\project\.tmp-verify\` 里的一次性 CDP 脚本（`cdp-noresize.js` / `cdp-collapse.js` / `cdp-city.js`），
每次改动都要人肉复制粘贴、人肉判断输出。现在变成三个可重复执行的用例：

```
tools/e2e/
├── cdp.js        极简 CDP 客户端（Node 22 全局 WebSocket，零依赖）
├── launch.js     起一个干净实例：临时数据目录 + 固定端口 + 收尾清理
├── run.js        入口：起本地桩 → 起应用 → 依次跑用例 → 汇总退出码
└── cases/
    ├── noresize.js   连点 5 次 + 点气泡收起，窗口高度必须恒定
    ├── collapse.js   气泡完整落在窗口内；收起后宠物重新可点
    └── city.js       找城市 → 点结果 → 存盘 → 进「最近城市」
```

`npm run test:e2e`；`--list` 看用例，`--port` 换端口，`node tools/e2e/run.js city` 只跑一个。

## 2. 设计决定

**用临时数据目录起"全新用户"的实例。** `launch.js` 在仓库内建 `.e2e-data/<pid>/`（已 gitignore），
写一份 `onboarded: true`、`mode: 'quiet'` 的 `settings.json`：不弹首次引导、不弹提醒、不碰真实用户配置。
放在仓库里而不是 `%TEMP%`，是因为子进程写 `%TEMP%` 在受限环境/开着杀软的机器上会被 `EPERM` 拦（实测踩到，
`settings:set` 直接失败，用例里表现为"刚才没记下来，再试一次好吗"）。

**网络必须可替换。** 城市用例要验的是"输入 → IPC → 主进程抓取 → 渲染 → 点选 → 存盘 → 最近城市"整条链路，
但 Open-Meteo 在 CI/离线环境不可达。于是给 `lib/weather.js` 的 geocode 加了一个 `DESKPET_GEOCODE_BASE`
（和已有的 `DESKPET_DATA_DIR`、`DESKPET_TRACE_HIT` 一个路数）：`run.js` 起一个本地 HTTP 桩返回固定的一条结果，
真实代码路径一行不改，只有 host 被换掉。

**用例断言"看得见的东西"，不断言像素。** 窗口高度、气泡矩形是否落在窗口内、`elementFromPoint` 命中谁、
`getState()` 里的城市和经纬度——这些是回归时最先坏、也最能说明问题的量。

**用例之间互相清理。** 每个用例跑完关掉气泡、等一下；失败不中断后续用例（一次跑完看到全部问题）。

## 3. 验证

| 环境 | 结果 |
|---|---|
| 本机（`node tools/e2e/run.js`） | 3/3 通过：noresize 4.4s、collapse 2.0s、city 3.4s |
| 本机（故意改坏） | 把 `collapse` 的窗口高度断言改成不可能满足 → 退出码 1，`FAIL collapse` + 具体数字 |
| CI | `ci.yml` 新增 `e2e` job（windows-latest，不设 `ELECTRON_SKIP_BINARY_DOWNLOAD`），失败时上传 `.e2e-data/` |

## 4. 踩坑

**`collapse` 的语义变了，断言要跟着改。** 旧脚本断言"气泡打开窗口变高、收起变矮"；0.6.7 起窗口尺寸由
`reserve` 决定、和可见性解耦（P1-1 阶段 2），打开/收起窗口高度恒为 444。硬套旧断言会直接失败——
这轮把它改成"气泡必须完整落在窗口内 + 收起后宠物重新可点"，守的是真正会退化的东西。

**城市输入框不会自动存盘。** 设置页里 `#city` 只有"搜到了点结果"才 `save()`；只输入不点搜索是故意不落盘的
（半截城市名没有意义）。用例因此必须点结果行，不能只 dispatch `input` 事件。

**`Runtime.evaluate` 里不能写 `await`。** `JSON.stringify(await window.deskPet.getState())` 是语法错误，
要写成 `window.deskPet.getState().then((s) => JSON.stringify(s))`（`awaitPromise: true` 会自动等这个 Promise）。

**别在用例里读 `%TEMP%`。** 见 §2；`os.tmpdir()` 在这个环境里会 `EPERM`。

## 5. 没做 / 边界

- 没接 `check-a11y` 与 e2e 的串联（a11y 仍需手动起带端口的实例）；
- 没测多显示器、贴边吸附、托盘（托盘在本机 `D:\project` 下必然 `ERROR_ACCESS_DENIED`，见 `M17-NOTES.md` §8.1）；
- 用例时长约 10s，没有并行化——够快，先别复杂化。