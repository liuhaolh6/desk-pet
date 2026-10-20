# M12 交接文档：照片抠图（0.5.0 → 0.5.1）

> 日期：2026-10-20 · 当前版本：0.5.0（未签名）
> 状态：**抠图“能用但不达预期”**。用户反馈“只是把背景变淡/半透明，而不是真正把人像 alpha 抠出”。
> 必读：`M12-PLAN.md`（优化计划）、`M11-NOTES.md`（原实现记录，质量结论被本文修正）。
>
> **2026-10-20 晚更新（0.5.1）**：P0-1~P0-8 已实施，本文 §3 的 alpha 合成/映射/回退缺陷已修复；实测指标、未覆盖项与回滚见 `M12-NOTES.md`。本文保留问题分析，作为回归背景。

## 1. 一句话现状

当前抠图链路能加载模型、能保存角色、能回退，但 **alpha 结果不可信**：

- 保存的 PNG 里保留了大片半透明背景（不是棋盘格视觉效果）；
- 部分照片会出现主体被删/边缘断裂；
- `NO_PERSON` 回退会把整图当角色保存，且角色库没有“未抠图”标记；
- 现有 31 项测试只测纯函数与模型存在性，**不会发现上述问题**。

## 2. 链路与文件

```text
app/cutout.html/css/js
  → preload.js (pickCutoutPhoto / runCutout / saveCutout)
  → app/main.js (cutout:pick / run / save IPC)
  → lib/cutout.js (nativeImage 解码、U2Net 推理、蒙版、裁切、610 合成)
  → lib/cutout-math.js (归一化、连通域、包围盒、适配)
  → store.addRole → roles/*.png → pet-role:// → app/pet.js
```

| 文件 | 关键函数/行 | 作用 |
|---|---|---|
| `lib/cutout.js` | `buildInput()` L49、`resizeAlpha()` L63、`applyAlpha()` L88、`composeCanvas()` L103、`cutoutImage()` L125 | 推理和合成主链路 |
| `lib/cutout.js` | `largestComponent(...0.45)` L139、`mask² + a<0.45` L146-149、`maskBounds(...0.5)` L150、`bustBottom` L158 | 蒙版后处理/胸像裁切 |
| `lib/cutout-math.js` | `normalizeMask()` L8、`largestComponent()` L32、`maskBounds()` L59、`fitRect()` L81 | 纯函数，可单测 |
| `app/main.js` | base64 30MB L486、`cutout:pick` L567、25MB L577、`cutout:run` L592、fallback L612/622、`cutout:save` L629 | IPC/回退/保存 |
| `app/cutout.js` | `useImage()` L69、`run()` L112、fallback L123-127、`save()` L147、`canvas.toDataURL` L153 | 预览/交互/导出 |
| `lib/store.js` | `addRole()` L144 | 角色落盘；当前无 `cutout` 标记 |
| `app/pet.css` | L54/65/243 `drop-shadow` | 只影响观感，不是 alpha 主因 |
| `assets/models/u2net_human_seg.onnx` | 44,253,573 B，sha256 `07ce2cee…24cfe` | 量化 U2Net |
| `package.json` | `extraResources`/`asarUnpack`/files 排除 | 模型与原生模块打包 |

## 3. 已确认缺陷（按影响排序）

### 3.1 alpha 合成/缩放契约（已验证）

- `applyAlpha()` 写 **straight alpha**，但 `nativeImage.createFromBitmap()` 按 **premultiplied alpha** 解释；半透明像素颜色会冲白：实测输入 RGBA `(200,100,50,128)` 落盘为 `(255,199,100,128)`。
- `composeCanvas()` 对含透明像素的 nativeImage 调 `resize()`；实测 100×100（边缘 alpha=0）→ 50×50 后 **alpha 范围 200–255、alpha=0 像素 0 个**。
- 结论：透明背景在合成阶段被“雾化”，这是“背景变淡”的直接来源之一。**修法不是调阈值，而是预乘或避免对透明图 resize。**

### 3.2 蒙版 → alpha 映射（代码事实）

- `normalizeMask()` 按图 min-max + `cut=0.32` + gamma 1.6；阈值随照片漂移。
- `mask²` 后 `<0.45→0`：最终 alpha 只可能是 0 或 ≥0.451；模型 0.68–1.0 的中等响应变成 45%–91% 半透明。
- `largestComponent` 只保留最大连通域，手臂/手/耳饰/分开发丝会被删；`keep=null` 时 `if (keep)` 静默跳过。
- 320→工作尺寸双线性后硬切，过渡带只有约 1px，边缘硬。

### 3.3 回退“假成功”（代码事实）

- `NO_PERSON`/`MODEL_*` → `app/main.js:612` 返回整图 `fallbackDataUrl`；`app/cutout.js:123-127` 自动切 fallback 并解禁保存。
- `addRole()` 无 `cutout` 标记；`roleList()` 不返回类型；角色库无法区分。
- 用户可能保存了一张“带背景的整图角色”，这也会被描述成“没抠出来”。

### 3.4 测试盲区（代码事实）

- `tools/smoke.js` 的 5 项抠图测试只覆盖 `normalizeMask` 端点、3×3 连通域、`maskBounds`、`fitRect`、模型文件大小；没有任何 alpha 输出断言。
- 因此“31 项全绿”不能证明抠图质量；交接/发布必须以 `M12-PLAN.md` 的 G1–G8 为准。

### 3.5 其他正确性/工程问题

- 选图上限 25MB（`main.js:577`），base64 解码上限 30MB（`main.js:486`）；22.5–25MB 文件会被误拒。
- 推理 + 解码 + 逐像素 JS 后处理在主进程；大图会阻塞托盘/动画。建议 `utilityProcess`。
- 保存链路 `canvas.toDataURL` → main `createFromBuffer` → `scaleOnly(610)`（610 时基本空转）→ `toPNG`，无 alpha 校验。
- `getBitmap()` 已废弃（日志有 DeprecationWarning），后续考虑 `toBitmap()`。
- EXIF 方向、premultiply 的跨平台行为未验证。

## 4. 预处理分歧（未定论）

有专家在单张 1080×1920 上测得：

- 强制 320×320：coverage 76.0%，成品 alpha=0 20.2%；
- 等比 letterbox：coverage 43.0%，成品 alpha=0 70.7%。

但桌面/代码审查成员认为模型 raw 蒙版本身可用，主因在映射/合成；两者并不矛盾：**预处理可能让蒙版膨胀，映射/合成再把它变成半透明**。当前不能把“非等比”写成唯一主因。

处理方式：

- 在 `tools/fixtures` + 10 张授权图上做 A/B；
- 若 letterbox 稳定降低背景残留，则采用 letterbox，并记录 `(iw,ih,ox,oy)` 做蒙版反变换；
- 若差异不显著，保留 squash，优先修 alpha/映射，避免无数据改预处理。

## 5. 与 dsh-whale-widget 的差异

**事实：whale-widget 没有 AI 抠图。**

- 角色是用户上传/预切的透明 PNG/GIF；出厂角色是人工切好的 610×610 RGBA。
- 上传弹窗做缩放/旋转/翻转/位移，导出 `toDataURL('image/png')`，注释明确“不铺底色，保留透明背景”。
- 渲染用 `<img>` + `object-fit: contain` + `drop-shadow`；命中用 alpha 逐行生成 `clip-path`，透明区不挡鼠标。
- 它没有 U2Net/分割/matting 实现，不能“照抄抠图算法”。

**值得借鉴**：

1. 610 透明导出纪律：预览/保存都不铺底色，alpha 是语义而不是装饰。
2. 裁剪弹窗（缩放/旋转/翻转/位移）比固定 66% 胸像更可控。
3. 失败态：图片读不出时退回矩形命中，不假装“已抠图”。
4. alpha 命中（P2）：桌宠矩形窗口在透明处仍会接鼠标，可参考 `clip-path` 思路。

**不能借鉴**：把“预切透明 PNG”当成“自动抠图”的替代；deskpet 的卖点是自动分割，必须自己保证质量门禁。

## 6. 复现与诊断（接手先做）

### 6.1 现有入口

```powershell
cd D:\project\deskpet
npm test                     # 31 项，注意不覆盖 alpha 质量
npm start                    # 设置 → 角色 → 从照片生成角色
```

- 拖入照片 → 开始抠图 → 保存；
- 打开保存的 `roles/*.png`，用支持 alpha 的查看器看棋盘格/白/黑底；
- 若“背景变淡”，检查 alpha 直方图，而不是只看预览。

### 6.2 像素级判定

```python
from PIL import Image
im = Image.open(r"path\to\role.png")
a = im.getchannel("A")
print(im.mode, im.size, a.getextrema())
print("0 alpha", sum(1 for v in a.getdata() if v == 0))
print("mid alpha", sum(1 for v in a.getdata() if 32 <= v <= 223))
```

判据：

- 背景区 alpha=0 占比高、无大片 32–223 → 正常；
- 背景 32–223 占比高、0 像素很少 → 命中“雾化/半透明”缺陷；
- 整图 alpha 全 255 → 可能是“仅缩放导入”回退，不是抠图。

### 6.3 建议新增（M12 P0）

- `tools/cutout-diag.js`：输入图片/输出 PNG，打印 alpha 分带、coverage、背景/主体区统计、耗时、模型形状；
- `tools/fixtures/`：只放可公开的合成图与生成脚本；个人照片本地放并 gitignore；
- CDP 脚本：拖入图 → 抠图 → `getImageData` 统计 alpha；再保存、读 `roles.json` 验证 `cutout` 标记。

### 6.4 当前测试脚本

- `.tmp-verify/test-cutout-backend.js`、`cdp-m11.js` 是开发期脚本，**被 `.gitignore` 忽略，不能作为交接验收**；
- 仓库中只有 `tools/smoke.js` 的 5 项抠图纯函数测试。

## 7. 已知坑（按踩坑概率）

1. **不要用“调 normalizeMask 的 cut/gain”当修复**：它是相对阈值，改一个值会整体漂移；先改绝对阈值/预乘/合成。
2. **不要对 straight-alpha 的 nativeImage 直接 resize**：先把 RGB 预乘，或分离 RGB/alpha 自写缩放；否则透明区会变半透明。
3. **`nativeImage.createFromBitmap` 的颜色会冲白**：半透明像素必须预乘，或改用独立 PNG 编码。
4. **`largestComponent` 会删分离部位**：手、耳饰、发梢；需要多连通域/滞回/填洞。
5. **`keep=null` 不能静默跳过**：否则整幅半透明继续流到保存。
6. **模型不能放 asar**：`extraResources/models`；`onnxruntime-node` 必须 `asarUnpack`。
7. **不要用动态量化**：当前 CPU EP 不支持 `ConvInteger`；静态量化只量化 Conv，且需校准/验证。
8. **参考目录的 56–58MB 模型是截断文件**：完整模型约 176MB；仓库里是 44MB 静态量化版。
9. **模型输出有 7 个头**：当前取 `outputNames[0]`；换模型/重新量化必须校验 `dims=[1,1,320,320]` 和输出语义。
10. **主进程阻塞**：推理、解码、逐像素 JS、toPNG 都在主进程；抠图时托盘/气泡可能卡。
11. **25MB/30MB 上限不一致**：按二进制字节统一。
12. **回退可直接保存整图**：当前无类型标记；修复前不要把它当“抠图成功”。
13. **`getBitmap()` 已废弃**：后续迁移 `toBitmap()`，但注意 BGRA/预乘语义。
14. **EXIF/高 DPI/多显示器未验证**：手机竖拍/4K 图需补测试。
15. **不要用“31 项全绿”当质量证明**：见 §3.4。

## 8. 已完成 / 未完成

### 已完成

- 离线 44MB 量化 U2Net 随包，`extraResources` + `asarUnpack` 打包；
- 独立抠图窗口、拖动/缩放、保存切角色、失败回退；
- 610×610 透明 PNG 落盘，角色图库通过 `roles:changed` 刷新；
- 31 项测试（纯函数/模型存在性）。

### 未完成（M12）

- ~~预乘 alpha / 避免透明 nativeImage resize~~（0.5.1 完成，见 `M12-NOTES.md` §3 P0-1）
- ~~绝对阈值/双阈值 + smoothstep、去平方硬切、羽化~~（0.5.1 完成）
- ~~8 邻接/多连通域/填洞/null 报错~~（0.5.1 完成）
- ~~覆盖率上限、输出契约校验、trace~~（0.5.1 完成）
- ~~回退 `mode`/`cutout` 标记 + 二次确认 + 角色徽标~~（0.5.1 完成）
- 预处理 squash vs letterbox A/B（未做，P1-1）
- 蒙版视图、手动擦除/恢复、旋转/翻转（未做，P1-2/P1-3）
- utilityProcess/token IPC（未做；25/30MB 已统一，P1-5）
- 真图 E2E/CI、10 张 golden set 的 alpha 指标（部分：41 项 + 合成/单张真人回归已完成，golden set 未凑齐）

## 9. 下一步（按顺序）

1. 在可启动 GUI 的普通桌面会话复跑：抠图窗口 → 抠图 → 拖动/缩放 → 保存；回退二次确认；角色库“未抠图”徽标；`cutout-trace.jsonl`。
2. 凑齐 ≥10 张授权人像 golden set，用 `tools/cutout-diag.js --assert` 跑 G1–G4；负例跑 `--expect no-person`。
3. P1-1 预处理 A/B（squash vs letterbox）；不要凭单张照片改 `buildInput`。
4. P1-2/P1-3 蒙版视图与手动擦除；P1-5 把推理移出主进程并补阻塞实测。
5. P2 仅在 >20% 样例不达标时评估 MODNet/RMBG/ISNet；换模型必须带 A/B 与许可/包体评估。
6. 签名仍按 `SIGNING.md` 走 SignPath，不阻塞 M12。

## 10. 回滚

- 代码回滚集中在 `lib/cutout.js`、`lib/cutout-math.js`、`lib/cutout-pixels.js`、`lib/png.js`、`app/cutout.*`、`app/main.js` 的 cutout IPC；`package.json`/模型/存储格式不需要动。
- 存储只新增可选 `cutout/mode` 字段，旧角色不受影响；610×610 PNG 契约不变。
- 没有实现 `DESKPET_CUTOUT_LEGACY` 环境开关：旧映射与旧预乘路径已被删除，留开关等于留一条会雾化的死路径；灰度用 Git 回滚到 `a1eb24b`。
- 发布前保留 0.5.0 portable 作为回退安装包。

## 11. 新对话开场白（直接粘贴）

> 继续 `D:\project\deskpet` 的 M12 抠图修复。先读 `M12-PLAN.md` 与 `M12-HANDOFF.md`。
> 已确认：`lib/cutout.js` 的 straight-alpha + `nativeImage` premultiply/resize 会把透明区雾化；`mask²+0.45` 会把背景压成半透明；回退可保存整图且无标记。
> P0 先修预乘/resize、绝对阈值/羽化、连通域、回退标记与诊断测试；预处理 squash vs letterbox 和换模型放后续 A/B。不要用 31 项测试全绿当质量证明。

## 12. 未覆盖/待补资料

- 用户触发问题的原图 + 保存后的角色 PNG（最关键）。
- 10 张有授权的人像 golden set 与人工 GT。
- 全精度 176MB 模型 A/B（用于判断量化损失）。
- 可启动 GUI/NVDA/真实高对比度主题的测试环境。
- 多显示器/高 DPI/EXIF/4K/低光/多人/透明 PNG 输入。
- 模型许可与供应链记录（MODNet/RMBG/ISNet 未评估）。

## 13. 专家意见覆盖与未纳入（避免误读为 8 份全文合并）

本文是**主理人综合稿**，覆盖了 8 位成员返回的核心结论，但以下细节被压缩/延后：

| 专家 | 已纳入 | 未纳入/待补 |
|---|---|---|
| 桌面应用 | alpha 预乘/resize、映射、worker、包体 | guided filter 细节、具体性能基线 |
| 代码审查 | 映射、回退、IPC/上限、测试盲区 | alpha 命中测试（P2）、完整安全评审 |
| Git 工作流 | “先锚点/回归再改代码”的顺序 | 0 tag、5 个未推送、无 CI 的具体修复；模型 LFS 决策 |
| 多智能体架构 | 预处理 A/B、预乘、trace、输出契约 | 20 张 golden set 与真实 GT |
| 无障碍 | 键盘/蒙版视图/自动关窗提示（P1-8） | WCAG 全量审计、NVDA/真实高对比度实测 |
| 高级项目经理 | 范围、优先级、排期、验收 | 具体人力/发布日期签字 |
| 编排/提示词 | 无产品代码改动 | 无（本次不涉及 LLM） |

**当前仓库状态（Git 专家实测，接手时复核）**：`main` 单分支、0 tag、无 push/PR CI；本地领先 `origin/main` 若干提交；抠图验收脚本仍在 `.tmp-verify/`（被 gitignore）。M12 的 P1-9 就是修这些。

**结论口径**：`M12-PLAN.md` 是决策稿，不是已执行结果；`M12-HANDOFF.md` 是交接稿。任何“已修复/已通过”必须对应实际提交、测试记录和 0.5.1 产物，不能只看文档。