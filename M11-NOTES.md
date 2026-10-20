# M11 照片抠图（0.5.0）

> 日期：2026-10-20 · 版本：`0.5.0`
> 产物：`dist/DeskPet-0.5.0-portable.exe`（153,052,737 字节，gitignore）
> SHA-256：`54b96b0a2faf2a833f52e3615122c02e8437a5d90cbf0659c4ed9da29eb6d83d`
> 模型：`assets/models/u2net_human_seg.onnx`（44,253,573 字节）
> 模型 SHA-256：`07ce2ceeebb2f2d9f2a2df2c504d1769c0c04567356a17de4571359b41f24cfe`
>
> ⚠ 2026-10-20 复盘：本文“复杂背景可能有少量残留”**低估了实际问题**——保存的 PNG 存在大片半透明背景，且回退可保存整图。根因、证据与修复计划见 `M12-PLAN.md` / `M12-HANDOFF.md`；不要把本文的“31 项测试通过”当成抠图质量已通过。

## 1. 做了什么

- **离线人像抠图**：U2Net human segmentation，输入 320×320，输出蒙版经归一化、最大连通域过滤、alpha 阈值/压缩、双线性放大、底部胸像裁切，合成 610×610 透明 PNG。
- **独立抠图窗口**：选择照片 / 拖入照片 → “开始抠图” → 棋盘格预览 → 拖动、滚轮缩放、缩放滑杆 → 保存为角色。
- **设置入口**：设置 → 角色 → “从照片生成角色”；保存后自动切换角色，角色图库通过 `roles:changed` 刷新。
- **失败回退**：未检测到人像、模型缺失/加载失败、抠图异常时自动切到“仅缩放导入”，仍可保存；也可手动点“仅缩放导入”。
- **离线打包**：模型放 `extraResources/models`；`onnxruntime-node` 原生模块 `asarUnpack`，只保留 win32 x64 二进制。

## 2. 模型说明

原参考目录里的 `u2net_human_seg.onnx` 只有 58MB，但 protobuf 的 graph 长度字段约 176MB，是**截断文件**，ONNX Runtime 报 `Protobuf parsing failed`。

处理过程：

1. 从 rembg release 下载完整 `u2net_human_seg.onnx`（175,997,641 字节），用 `onnxruntime-node` 验证可加载；
2. 用 onnxruntime Python 做 **QOperator 静态量化**（只量化 Conv，QInt8 权重 / QUInt8 激活，6 张校准图），输出 **44,253,573 字节**；
3. 用 onnxruntime-node 验证输入 `input.1`、输出 `[1,1,320,320]`，单次推理约 265ms（开发机）；
4. 在真实人像上验证 alpha 蒙版、胸像裁切和透明 PNG。

推理链路在 `lib/cutout.js`（Electron/nativeImage/onnxruntime）与 `lib/cutout-math.js`（纯函数，可 Node 测试）里；`tools/smoke.js` 新增 5 项抠图数学/模型检查，共 **31 项**。

## 3. 验证结果

- `npm test`：31 项全绿。
- 开发版 + 打包版 CDP：
  - 设置入口打开 `cutout.html`，拖入照片 → `runBtn` 可用；
  - 点“开始抠图” → 状态“抠图完成”、mode“已抠图”、`saveBtn` 可用；
  - 保存后 `roles.json` 出现新角色并切换到它；
  - 无人像图片 → 自动回退“仅缩放”，`saveBtn` 可用；
  - 打包版从 `resources/models` 加载模型，`app.asar.unpacked` 的 `onnxruntime.dll`/binding 正常；
  - 控制台无 error。
- 抠图后端单测：1080×1920 输入、610×610 输出、透明 alpha 正确。

## 4. 已知限制

- 复杂背景、多人、头发边缘可能有少量背景残留或毛边；当前是自动蒙版 + 胸像裁切，没有手动画笔/橡皮擦。
- 默认裁成胸像（约图片高度 66%），不是全身；桌宠舞台更适合胸像。
- 第一次抠图要加载 44MB 模型，约 1s 左右；之后会话复用。
- `onnxruntime-node` 是原生依赖，目前只打包 Windows x64；换平台需要重新配目标。
- 签名仍在 SignPath 审核流程中，0.5.0 产物未签名。

## 5. 文件

- 新增：`lib/cutout.js`、`lib/cutout-math.js`、`app/cutout.html/css/js`、`assets/models/u2net_human_seg.onnx`
- 修改：`app/main.js`、`app/preload.js`、`app/settings.html/js`、`package.json`、`package-lock.json`
- 打包：`build.extraResources` 模型、`build.asarUnpack` onnxruntime、排除非 win32 x64 二进制
- 测试：`tools/smoke.js` 31 项
