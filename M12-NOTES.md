# M12 照片抠图质量修复（0.5.1）

> 日期：2026-10-20 · 版本：`0.5.1`（未签名）
> 范围：P0-1 ~ P0-8（alpha 合成、蒙版映射、形态学、羽化、输出契约、回退语义、诊断、大小上限）
> 不改：模型、610 PNG 契约、抠图窗口既有交互、签名流程
> 相关：`M12-PLAN.md`（计划）、`M12-HANDOFF.md`（接手交接）、`M11-NOTES.md`（原实现，质量结论已被本文修正）

## 1. 结论

用户反馈的“只是把背景变淡/半透明，不是真正把人像 alpha 抠出”是**保存 PNG 里的真实 alpha 缺陷**，不是棋盘格预览的视觉效果。P0 修复后：

- 透明背景保持 alpha=0，不再经过会雾化的 `nativeImage.resize`；
- 半透明像素的颜色不再冲白（预乘/反预乘在自有像素管线里完成，最终 PNG 由我们编码）；
- 背景 alpha 从“大面积 45%–91%”变为绝对透明，主体保持不透明，边缘 2–4px 软过渡；
- 回退“仅缩放导入”不再能静默保存成角色：需要二次确认，角色库显示“未抠图”徽标；
- 每次抠图写 `cutout-trace.jsonl`，新增 10 项 alpha/像素断言，`npm test` 从 31 → **41 项**。

## 2. 基线 vs 修复后（同一张本机授权人像，未入库）

**基线**：M11 保存下来的角色 PNG `rmvga63aq.png`（610×610，`dist/win-unpacked/desk-pet-data/roles/`，本地文件，未提交）。

| 指标 | 基线（0.5.0） | 修复后（0.5.1） | 验收 |
|---|---:|---:|---|
| alpha=0 占比 | 19.94% | 44.56% | — |
| 非边缘/整体 32–223 | 24.33% | 2.59% | ≤3%（非边缘另计为 0%） |
| alpha≥250 主体占比 | 51.85% | 52.85% | — |
| 远背景平均 alpha | **23.07** | **0.00** | ≤2 |
| 远背景 P95 alpha | **99** | **0** | ≤8 |
| 主体核心 alpha≥250 | **96.44%** | **100%** | ≥98% |
| 非边缘 32–223 | **8.25%** | **0.00%** | ≤3% |
| 边缘过渡宽度 | **7.67px** | **2.23px** | 2–4px |
| 覆盖率 coverage | 0.598（成品） | 0.77（蒙版） | 0.02–0.90 |

**修复后运行**（同一张照片经 Electron 解码为 675×1200 PNG，再由纯 Node 跑完整模型链路）：

```
time       800 ms  {"resizeMs":0,"preprocessMs":24,"inferenceMs":577,"maskMs":26,"composeMs":46,"encodeMs":49}
coverage   0.77
bands      zero=44.56% faint=0.69% soft=0.69% medium=0.68% strong=0.53% solid=52.85%
farBg      mean=0 p95=0 zero=100%
core       ≥250=100%  mid=0%  edge=2.23px
```

> 说明：基线 PNG 是 0.5.0 的成品；修复后是同一原图重新解码后跑 0.5.1 链路。两者构图/裁切略有差异，但背景雾气与半透明带的量级差异（23→0、8.25%→0%）不是构图造成的。

合成图（`tools/fixtures/synthetic-portrait.png` + 人工 GT，640×960，含一只分离的手）走假蒙版合成：

```
coverage   0.39
gt/bg      mean=0 p95=0 zero=100%
gt/core    ≥250=100%  mid=0%  edge=2.11px
PASS coverage / 背景 / 主体 / 非边缘 / 边缘
```

负例 `tools/fixtures/negative-landscape.png`：`NO_PERSON`（不会静默出图）。

## 3. 根因与修复

### P0-1 alpha 合成契约（`lib/cutout.js`、`lib/cutout-pixels.js`、`lib/png.js`）

已确认的两条事实（本机 Electron 44.9/Windows 复验）：

1. `nativeImage.getBitmap()` / `createFromBitmap()` 使用**预乘 BGRA**：straight `(200,100,50,128)` 读回是 `(25,50,100,128)`；把它再交给 `toPNG()` 会反预乘成 `(199,100,50,128)`。
2. 对带透明像素的 `nativeImage` 调 `resize()` 会把 alpha=0 的区域插值成半透明（M11 实测 alpha 0→200）。

修复方式：**不再让透明图像进入 `nativeImage`**。

- 解码：`getBitmap()` → `bgraToRGBA(..., premultiplied=true)` 得到 straight RGBA；
- 工作图缩放：自有 `resizeAreaRGBA()`（面积平均、预乘累加，透明像素不贡献颜色）；
- 合成：`composeMaskedCanvas()` 在预乘域双线性采样，输出 straight RGBA；
- 落盘：`lib/png.js` 自写 8-bit RGBA PNG（zlib），完全绕开 Skia 的预乘/反预乘往返；
- 预览/保存：直传 PNG buffer，渲染层 canvas 负责用户拖动/缩放（浏览器 alpha 语义正确）。

验证：`tools/smoke.js` 断言 `(200,100,50,128)` 经合成后仍是同色同 alpha，在白底合成得 `(227,177,152)`、黑底 `(100,50,25)`，透明区恒为 0；透明区 2× 缩放的角像素仍是 `(0,0,0,0)`。

### P0-2 蒙版映射（`lib/cutout-math.js`）

删除 `min-max + gamma`、`mask²`、`a<0.45→0`。改为：

- `normalizeMask()` 只做 `clamp(0,1)`（U2Net 输出是 sigmoid，绝对值有意义）；
- `hysteresisMask()`：`high=0.55` 作种子，沿 8 邻接在 `low=0.22` 以上生长；孤立的中等响应不成为前景；
- 蒙版保持 0/1，软边在输出分辨率生成（P0-4）；
- 阈值不再随照片漂移，也不再制造 0.45 直方图尖峰。

### P0-3 形态学与连通域

`openMask` → `closeMask` → `fillHoles`（只填 ≤1% 前景面积的内部洞）→ `retainComponents`：

- 8 邻接；
- 保留最大主体，以及面积 ≥ `max(16px, 主主体 1%)` 的副连通域（手/耳/分开发丝）；
- `keep=null` 直接抛 `NO_PERSON`，不再静默继续。

### P0-4 边缘羽化

在 610 输出分辨率对 alpha 做两次 `[1,2,1]/4` 可分离模糊（2px 过渡），再 `alpha≤2/255→0`。实测边缘平均宽度 2.2–2.5px，无 1px 硬边；主体内部仍 100% ≥250。

羽化会向主体外扩散约 2px，这些像素必须带**真实图像颜色**。第一版为了省 1–2ms 跳过了 mask=0 的颜色采样，实测出现纯黑半透明边（合成测试图边缘 2902 个 `rgb<20` 像素）；已改为对整个 fit 区域采样颜色并由 `featherAlpha` 只混 alpha，smoke 增加“过渡带不能是黑色”断言。

### P0-5 输出契约与 coverage 门禁

- 校验 `result.dims === [1,1,320,320]` 与 `data.length === 102400`，异常 → `BAD_OUTPUT_SHAPE`；
- coverage = 保留蒙版前景占比（320 网格）：`<0.02 → NO_PERSON`，`>0.90 → OVER_SEGMENTED`；
- 越界时 `cutout:run` 返回 `mode:'fallback'` + 错误码，**不自动放开保存**。

### P0-6 回退语义

- `cutout:run` 成功返回 `mode:'cutout'`；失败返回 `mode:'fallback'` + `code` + `fallbackDataUrl`；
- 渲染层：模式标签显示 **“未抠图（整图）”** 并加警示色，保存按钮第一次点击变成“确认保存未抠图角色”，10s 内不点第二次自动复位；
- 主进程二次校验：`mode:'fallback'` 且没有 `confirmFallback:true` → `FALLBACK_UNCONFIRMED`；
- `store.addRole(name, bytes, { cutout, mode })` 落盘标记；`roles:list` 返回 `cutout/mode`；设置角色图库对 `cutout:false` 显示“未抠图”文字徽标。

### P0-7 诊断、trace 与 alpha 回归

- 新增 `lib/png.js`（PNG 编解码）、`lib/cutout-pixels.js`（预乘采样/缩放/合成/分带）；
- 新增 `tools/cutout-diag.js`：
  - `--png <role.png>`：纯 Node 分析 alpha 分带、自指背景/主体、边缘宽度；
  - `--fake <img> --mask <gt>`：不跑模型，合成 + GT 指标 + 断言；
  - `--input <png>`：纯 Node 跑完整模型链路（需要已解码的 PNG）；
  - `--decode`：Electron 辅助，把 JPEG/WebP 转成 straight RGBA PNG；
  - `--expect no-person`、`--assert`、`--json`、`--out`；
- 新增 `tools/make-cutout-fixtures.js` 与 `tools/fixtures/`（合成人像+GT、负例、alpha 色块），全部可公开，个人照片不入库；
- `cutout:run` 每次写 `<data>/cutout-trace.jsonl`（输入尺寸、工作尺寸、输出形状、coverage、alpha 分带、分段耗时、错误码），>256KB 轮转为 `.1`；
- `tools/smoke.js` 新增 10 项：绝对映射、滞回、8 邻接、开/闭、填洞、多连通域、预乘互转、PNG 直通、50% alpha 三底、透明缩放、610 合成软边、角色标记。

### P0-8 大小上限

`MAX_IMAGE_BYTES = 25MB` 同时用于选图 `stat.size` 与 dataURL 解码后的二进制长度；删掉 30MB base64 上限。22.5–25MB 的 JPEG 不再被解码侧误拒。

## 4. 代码地图（0.5.1）

| 文件 | 变化 |
|---|---|
| `lib/cutout.js` | 拆出纯 Node 核心 `cutoutImageRGBA()`；Electron 包装只负责 `getBitmap()` 解码；输出 `png` buffer、分带、分段耗时 |
| `lib/cutout-pixels.js` | 新增：BGRA↔RGBA、预乘采样、面积缩放、掩膜合成、羽化、alpha 分带 |
| `lib/png.js` | 新增：8-bit RGB/RGBA PNG 编解码（zlib） |
| `lib/cutout-math.js` | 重写映射；新增滞回、开闭、填洞、连通域、保留副连通域 |
| `app/main.js` | `cutout:run` 用 `result.png`、返回 mode/bands/ms、trace；`cutout:save` 二次确认与角色标记；25MB 统一 |
| `app/cutout.js` | “未抠图（整图）”状态、保存二次确认、is-fallback 视觉 |
| `app/cutout.css` / `app/settings.js` / `app/settings.css` | 警示 pill / 角色库“未抠图”徽标 |
| `lib/store.js` | `addRole` 接受 `cutout/mode` 元数据 |
| `tools/smoke.js` | 31 → 41 项 |
| `tools/cutout-diag.js`、`tools/make-cutout-fixtures.js`、`tools/fixtures/` | 新增诊断与合成基准 |

## 5. 验证记录

| 项 | 命令 | 结果 |
|---|---|---|
| 纯函数/alpha 回归 | `node tools/smoke.js` | **41 checks passed** |
| 合成 GT 合成链路 | `node tools/cutout-diag.js --fake tools/fixtures/synthetic-portrait.png --mask tools/fixtures/synthetic-portrait-mask.png --assert` | 全部 PASS（背景 0/0，主体 100%，边缘 2.11px） |
| 真机照片（本机授权，未入库） | `node tools/cutout-diag.js --input .tmp-verify/photo-1080.png --assert` | 全部 PASS（背景 0/0，主体 100%，边缘 2.23px，800ms） |
| 负例 | `node tools/cutout-diag.js --input tools/fixtures/negative-landscape.png --expect no-person` | `NO_PERSON` PASS |
| 旧 PNG 基线 | `node tools/cutout-diag.js --png <M11 保存的角色>` | 背景 mean 23.07 / P95 99 / 边缘 7.67px（复现缺陷） |
| 语法 | `node --check`（改动文件） | 通过 |
| 打包 | `electron-builder --win portable --x64` | 成功：`dist/DeskPet-0.5.1-portable.exe` 153,065,030 B（比 0.5.0 +12KB） |
| 打包版模型 | 设 `process.resourcesPath=dist/win-unpacked/resources` 跑核心 | `modelPath` 命中 `resources/models/...`；同图推理 coverage 0.771、754ms、分带一致 |
| asar 内容 | `asar.listPackage` | `lib/cutout.js`、`lib/cutout-pixels.js`、`lib/png.js`、`lib/cutout-math.js` 均在；`onnxruntime-node` 在 `app.asar.unpacked` |
| 开发版 GUI（CDP） | 拖入合成人像 → 抠图 → 保存 | `mode=已抠图`；canvas alpha zero 56.01% / mid 1.39% / solid 41.43%；保存后 `roles.json` 为 `cutout:true, mode:'cutout'` |
| 开发版 GUI 回退（CDP） | 拖入负例 → 抠图 | `mode=未抠图（整图）`，pill 带 `warn`、stage 带 `is-fallback`；第一次点保存**不落盘**，按钮变“确认保存未抠图角色”；第二次落盘为 `cutout:false, mode:'fallback'` |
| 角色图库徽标 | 设置窗口 CDP | 回退角色显示“未抠图”；已抠图角色无徽标 |
| 保存的 PNG 复核 | `node tools/cutout-diag.js --png .m12-test/roles/<id>.png` | 背景 mean 0 / P95 0、主体 100%、边缘 2.51px（canvas → 主进程 → PNG 后仍是 straight alpha） |
| 打包版 GUI（CDP） | `dist/win-unpacked/DeskPet.exe --no-sandbox` | `packaged=true`、托盘创建成功、抠图成功（coverage 0.384、822ms）、renderer error 0，证明模型从 `resources/models` 加载 |
| portable exe（CDP） | `dist/DeskPet-0.5.1-portable.exe --no-sandbox`（TEMP 指到可写目录） | NSIS 自解压到 TEMP 后启动正常、`packaged=true`、抠图成功（coverage 0.384、975ms）、renderer error 0 |
| 主进程同步段（Electron 实测） | `cutout-diag` 在 Electron 下跑本机照片 | decode 20ms、preprocess 24ms、mask 25ms、compose 42ms、encode 29ms；推理 645–720ms 为异步；热抠图 0.9–1.0s |

截图（均为可公开的合成图/界面，不含个人照片）：[抠图窗口](docs/m12/cutout-window.png)、[回退态](docs/m12/cutout-fallback.png)、[合成图抠图结果](docs/m12/synthetic-cutout-checker.png)。

### 未验证 / 仍缺

- **10 张 golden set** 未凑齐：本轮只有 1 张本地授权真人照片 + 2 张合成图。G5（手/耳/发梢 10 张人工核验）未做。
- **未签名 exe 的 SmartScreen 首次双击**未复验：本机通过 `--no-sandbox` + 可写 TEMP 启动 portable 并完成抠图；普通桌面双击仍会被 SmartScreen/安全软件拦（见 HANDOFF §5.10）。
- 高 DPI / EXIF 旋转 / 4K / 多人 / 低光 / 透明 PNG 输入未覆盖。
- 主进程同步段最大 42ms（compose），离 50ms 门槛 8ms；慢机器/大图可能越界，P1-5 应移入 worker。

## 6. 已知限制与风险

- 修掉“半透明雾”后，真实边缘/背景残留会更显眼；需要 P1-3 手动擦除兜底。
- 发丝/复杂背景仍可能残留，属模型能力（P2 才评估 MODNet/RMBG/ISNet）。
- 输入仍是 squash 到 320（P1-1 才做 squash vs letterbox A/B）；本轮没有把预处理当主因。
- Electron 路径对不透明照片仍用 Skia resize（C++，快），纯 Node/透明输入用 `resizeAreaRGBA`；两条路径的模型输入未做严格 A/B，同图 coverage 0.77 与 M11 的 0.76 接近。
- coverage 下限 0.02 对“极小人物”可能误放行；合成负例返回 NO_PERSON，但真实空景需多张负例再验。
- 角色库只能标记 0.5.1 之后保存的回退角色；0.5.0 旧角色没有 `cutout` 字段，显示为无标记（不谎报已抠图）。

## 7. 产物与打包

- `package.json` / `package-lock.json` → `0.5.1`；
- 打包命令（本机 64 位 NSIS，见 `M6-PACKAGING.md` §3.1）：

```powershell
$env:ELECTRON_BUILDER_CACHE='D:\project\deskpet\.builder-cache'
$env:ELECTRON_BUILDER_BINARIES_MIRROR='https://npmmirror.com/mirrors/electron-builder-binaries/'
$env:ELECTRON_BUILDER_NSIS_DIR='D:\project\deskpet\.tools\nsis-custom'
$env:ELECTRON_BUILDER_NSIS_RESOURCES_DIR='D:\project\deskpet\.builder-cache\nsis@1.2.1\nsis-bundle-3.12-1qor4'
node node_modules\electron-builder\cli.js --win portable --x64
```

- 产物（gitignore）：
  - `dist/DeskPet-0.5.1-portable.exe`：153,065,030 字节，SHA-256 `8dfdbda8bd05f7a11755b615b8f5c5bc6801e7dbeefa88ee16ecf9de0b871c5e`；
  - 解包版 `dist/win-unpacked/DeskPet.exe`：版本资源 `FileVersion 0.5.1 / ProductVersion 0.5.1.0`；已用 `--no-sandbox` 启动并通过 CDP 完成一次真实抠图（packaged=true、模型从 `resources/models` 加载）；
  - 模型仍在 `resources/models/u2net_human_seg.onnx`（44,253,573 B），`onnxruntime-node` 仍 `asarUnpack`；
  - 包体 146MB（`du`），比 0.5.0 的 153,052,737 字节只多 12KB，P0 未增加模型/资源。
- 打包日志确认：`using custom unpacked Electron distribution`、`resolved ELECTRON_BUILDER_NSIS_DIR`、`building target=portable file=dist/DeskPet-0.5.1-portable.exe`、`signing with signtool.exe`（未配置证书，属于 electron-builder 的空签名步骤，**产物仍未签名**）。
- 当前仍未签名：`Get-AuthenticodeSignature` 对 portable 与解包版均返回 `NotSigned`；签名按 `SIGNING.md` 走 SignPath，本轮未动。

## 8. 回滚

- 代码回滚集中在 `lib/cutout.js`、`lib/cutout-math.js`、`lib/cutout-pixels.js`、`lib/png.js`、`app/cutout.*`、`app/main.js` 的 cutout IPC；
- 存储只新增可选字段 `cutout/mode`，旧角色不受影响；610×610 PNG 契约不变；
- 保留 0.5.0 portable 作为回退安装包；
- 没有实现 `DESKPET_CUTOUT_LEGACY` 环境开关（旧映射与旧预乘路径已被删除，留开关等于留一条会雾化的死路径）；需要灰度时用 Git 回滚到 `a1eb24b`。

## 9. 下一步（P1/P2）

1. P1-1：golden set（≥10 张）上跑 squash vs letterbox，记录 `(iw,ih,ox,oy)` 并做蒙版反变换；
2. P1-2/P1-3：蒙版三态视图 + 手动擦除/恢复；
3. P1-5：`utilityProcess`/worker + token IPC，补主进程阻塞实测；
4. P1-8/P1-9：无障碍与 CI（`npm test` + `cutout-diag --assert`）；
5. P2：仅在 P0/P1 后仍有 >20% 样例不达标时评估换模型。