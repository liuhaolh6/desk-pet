# M20：纯函数单测框架（ROADMAP P1-3）

> 目标：把「纯函数」从 smoke 的文本断言里解耦出来，用 `node:test` 做真正的单元测试——零依赖、可单独跑、失败定位到用例。
> 日期：2026-10-23 · 分支 `main` · 未发版（0.6.7 候选）

## 1. 做了什么

新增 `tests/unit/`，四个文件共 **60 例**：

| 文件 | 用例 | 覆盖 |
|---|---|---|
| `bubble-model.test.js` | 19 | `newModule`/`normalizeStyle`/`normalizeModule`/`normalizeRow`/`normalizeCard`/`normalizeLayout`/`resolveCard`/`valueOf`/`styleToString` |
| `placement.test.js` | 16 | `clamp`/`normalizeDisplays`/`petRectOf`/`winFromPet`/`contains`/`intersectionArea`/`displayForRect`/`displayAt`/`clampPet`/`snapPet`/`defaultPet`/`resolveSaved`/`ensureVisible` |
| `weather.test.js` | 10 | `describe()` 码表、`advice()` 优先级（雪 → 雨 → 冷 → 紫外线 → 热 → 风 → 舒适）、`fetchWeather()` 入参校验 |
| `cutout-math.test.js` | 15 | `clamp01`/`normalizeMask`/`hysteresisMask`/`erode`/`dilate`/`open`/`close`/`fillHoles`/`components`/`retainComponents`/`largestComponent`/`maskBounds`/`fitRect`/`alphaCoverage`/`smoothstep` |

命令：

```
npm run unit         # node --test "tests/unit/*.test.js"
npm run unit:watch   # 改文件自动重跑
npm test             # smoke 57 项 + unit 60 例（CI 用的就是这条）
```

`npm run check` 也把 4 个测试文件加进了 `node --check` 名单（现在共 32 个 JS 文件）。

## 2. 设计决定

1. **文件放在 `tests/unit/`，不进 `tools/`。** `tools/` 是「给维护者手动跑的一次性脚本」（CDP、审计、造数据），`tests/` 是要长期被 CI 跑、会被删改的用例。
2. **一个模块一个文件，`node:test` 的 `test()` 名字写成「行为：期望」。** 失败时输出的就是一句中文结论，不用回去读代码。
3. **`npm test` 串两段（smoke → unit）而不是替换 smoke。** smoke 里有几百条「文件里必须有这行」的结构断言（模块拆分、IPC 通道、CSS 契约），这些不是纯函数测试能替代的；反过来 unit 覆盖的是输入→输出，smoke 覆盖的是「接线还在不在」。两者职责不同，都留着。
4. **测试里不 mock 时间。** `valueOf('water.next')` 这类用 `Date.now()` 的，用例只断言「格式对」和「过去 = 该喝啦」，不锁死具体分钟数——锁死只会变成每天挂一次。
5. **不加 `--experimental-*`、不加依赖。** Node 24 自带 `node:test` + `assert/strict`；`node --test tests/unit` 这种「传目录」在 Node 24 已不支持（会被当模块解析），必须传 glob。

## 3. 写用例时踩到的坑（都能省下下一次的十分钟）

- `node --test tests/unit` → `MODULE_NOT_FOUND`：Node 24 不再接受目录参数，要 `"tests/unit/*.test.js"` 且**加引号**（否则 git-bash 会自己展开，Windows 下 cmd 展开结果不同）。
- `normalizeModule({ type: 'nope' })` **不返回 null**，未知类型会回退成 `text`；只有 `null`/非对象才丢。用例一开始写错，是拿实际行为改的。
- `erode()` 对贴边的 1px 边框不侵蚀（「画面外不算背景」），所以「3x3 实心块腐蚀成一点」不成立；要测腐蚀必须把块放在画面中间。
- `components()` 是 **8 连通**：`(2,2)` 与 `(1,1)` 斜着也算同一块，第一版「孤立噪点」其实连着主块，换到 `(3,3)` 才孤立。
- `retainComponents()` 的默认下限 `minPixels = 16`：4 像素的主块也会被「整块保留」逻辑救回来，所以测碎屑要直接看碎屑位。

## 4. 验证

- `npm run check`：32 文件语法 ✅
- `npm run unit`：60 例全绿（~0.18s）
- `npm test`：smoke 57 项 + unit 60 例 ✅
- `node tools/check-a11y.js`：57 项 ✅（本轮没动 UI）
- a11y-audit 86 / keyboard 6：本轮不涉及渲染层，沿用上次基线

## 5. 后续（P1-3 之外，顺手记下）

- smoke 里与 unit 重复的断言（`advice` 文案、天气码、放置函数）可以逐步删掉，让 smoke 只留「结构/接线」断言；这一步不急，等下次动 smoke 时顺手做。
- `ipc.js`（404 行）/`windows.js`（297 行）仍偏大；如果继续拆，先把它们的纯逻辑部分（通道参数校验、窗口矩形计算）挪出来加单测。