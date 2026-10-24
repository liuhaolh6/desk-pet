# M29 · 抠图模型评测链路（P2-5）

> ROADMAP P2-5 的原话是「评测 BiRefNet-lite / ISNet（体积、CPU 时延、发丝），保留 U2Net 兜底；
> 可选 DirectML」，验收写的是「在 10 张 golden set 上 IoU/边缘优于现状；包体 ≤+30MB」。
>
> 本次把**评测链路**做完并跑出基线；**替代权重没有随包**，原因在 §4，不是「没做」，是「现在做不了」。

## 1. 交付

| 文件 | 作用 |
|---|---|
| `lib/cutout-model.js`（新） | 模型注册表 + 解析顺序：`DESKPET_CUTOUT_MODEL`（绝对路径）→ `resources/models/<file>`（安装版）→ `assets/models/<file>`（仓库）。小于 1MB 的文件视为不存在（LFS 指针/下载中断） |
| `lib/cutout-eval.js`（新） | 纯函数指标：`iou` / `boundaryLength` / `edgeSharpness` / `greyChannel` / `maskFromImage` / `percentile` / `summarize` |
| `tools/cutout-eval.js`（新） | 评测 CLI：逐图跑真实管线（ONNX CPU），输出 IoU / edge / ms / coverage；`--json` 给机器读 |
| `tools/make-cutout-golden.js`（新） | 生成 10 张**合成**人像 + 对应真值蒙版（SDF 轮廓 + 渐变背景 + 噪点），写到 `tests/fixtures/cutout-golden/` |
| `lib/cutout.js` | `modelPath()` 改为走注册表；支持 `DESKPET_CUTOUT_MODEL_ID` 选可选模型 |
| `tests/unit/cutout-model.test.js` / `cutout-eval.test.js` | 10 + 13 例，覆盖解析顺序、体积门槛、指标边界 |

`npm run cutout:golden` 重新生成固定集（确定性，无随机数种子问题）；`npm run cutout:eval` 跑评测。

## 2. 基线（2026-10-23，u2net-human 42.2MB，CPU）

10 张合成人像，480×600 → 900×1125：

| 指标 | 值 |
|---|---|
| IoU 均值 / 最低 | **0.987** / 0.984 |
| 耗时 P50 / P95 | **349ms** / 669ms |
| edge 均值（0–255） | 255（合成图边缘本来就是硬边） |

一张真实绘制稿（610×610，已随公开前的历史清理于 2026-10-24 移出仓库）作对照：745ms、coverage 55.7%、edge 255。
合成图之所以 IoU 能到 0.987，是因为轮廓是规则椭圆、背景是干净渐变——**这只证明链路正确，不证明真实照片上的质量**。

## 3. 一个真实的发现：`person-09` 会被判 `NO_PERSON`

9 号图（暖红背景 `#963C28 → #DC825A`）跑出 `NO_PERSON`，其余 9 张都正常。原因是管线里的两条保护：
`coverage < COVERAGE_MIN` 与 `retainComponents` 的 `minRatio/minPixels`。
暖红背景 + 皮肤色主体时，模型的蒙版把背景吃掉一块，主体连通域被切碎，于是被判「没有清晰人像」。

这不是把阈值调低就能解决的——那两条保护正是为了防止「把背景当成主体」。
它说明：**P2-5 想真正验收，需要 10 张真实照片（不同发色/背景/光照），而不是合成图**。
照片放 `.cutout-eval/`（已 gitignore），命名 `<name>.png` + 可选 `<name>.mask.png`，跑
`node tools/cutout-eval.js --dir=.cutout-eval`。

## 4. 为什么没有随包换权重

| 候选 | 体积 | 结论 |
|---|---|---|
| `u2netp-human` | 4.7MB | 体积达标，但官方定位是「轻量、精度换速度」，发丝明显更糊；作为可选 id 留着，等真实照片基线再比 |
| `isnet-general` | 176MB | 超 +30MB 预算 5 倍，直接排除 |
| `birefnet-lite` | 224MB | 同上，且 CPU 每张 ~1.5s |

另外，本机到 `huggingface.co` / `raw.githubusercontent.com` 都是超时（只有 `github.com` 首页与
`registry.npmmirror.com` 可达），拿不到权重文件本身。所以本次做的是「让换权重变成一次配置」，
而不是「假装换过了」。

拿到权重之后的操作（不需要改代码）：

```bash
# 1) 把 onnx 放进 assets/models/，文件名与注册表一致
# 2) 跑评测
npm run cutout:eval -- --model=u2netp-human
# 3) 满意就把 DESKPET_CUTOUT_MODEL_ID 设成它（安装版可用环境变量或设置里的高级项）
```

## 5. 未做

- **DirectML**：Electron 里 `onnxruntime-node` 的 DML EP 需要单独的 `onnxruntime-node-directml` 包与驱动，
  且与 `asarUnpack` 的路径规则冲突；等有真实照片基线、确认 CPU 600ms 是瓶颈再评估。
- **真实照片 golden set**：需要用户提供或从公开许可数据集中挑（涉及肖像权，不进仓库）。
- **CI 里的 eval**：合成集跑一次约 4s、需要 42MB 模型，放 CI 会让缓存体积翻倍；留在本地 `npm run cutout:eval`。