# 模型与二进制资产决策记录

> 日期：2026-10-21 · 关联：P1-9、`HANDOFF.md` §5.25–5.27、`M11-NOTES.md` §2

## 现状

| 资产 | 位置 | 大小 | 说明 |
|---|---|---|---|
| U2Net human seg（静态量化） | `assets/models/u2net_human_seg.onnx` | 44,253,573 B | QOperator 静态量化，只量化 Conv，QInt8 权重 / QUInt8 激活，6 张校准图 |
| 默认角色/图标 | `assets/*.png`、`build/icon.ico` | 小 | `tools/make-assets.py` 生成 |
| 字体子集 | `assets/fonts/*.woff2` | ~2.1MB | `tools/make-font.py` 生成（OFL） |

## 决策

1. **不使用 Git LFS**：仓库是单人项目、public、当前 44MB 模型以普通 blob 存在；引入 LFS 会改变所有协作者的 clone 流程，并要求 GitHub LFS 配额。收益不足，决定**不迁移**（与 `M12-PLAN` §6.2 一致）。
2. **不重写历史**：模型已进入历史；重写会破坏所有已发布 commit 的 SHA，也没必要。
3. **只加二进制标记**：`.gitattributes` 明确 `*.onnx`、`*.png`、`*.woff2`、`*.node`、`*.dll` 等为 binary，避免 Git 做文本换行转换。**不加 `text=auto`**，否则会引发全仓库换行重写。
4. **模型永不进 asar**：`onnxruntime-node` 需要真实文件路径；模型走 `extraResources/models`（打包后 `resources/models/u2net_human_seg.onnx`）。
5. **只保留 win32 x64 原生二进制**：`files` 排除 darwin/linux/win32-arm64，`asarUnpack` 只展开 `onnxruntime-node`、`onnxruntime-common` 与 `lib/**`（P1-5 的 worker 需要真实路径），否则 portable 会多出 ~180MB。
6. **不要用动态量化**：动态量化会生成 `ConvInteger`，当前 CPU EP 无实现（`HANDOFF.md` §5.26）。要改量化必须：只量化 Conv、用真实照片校准、先用 `InferenceSession.create` 验证再打包。
7. **参考目录的 56–58MB 模型是截断文件**：graph 长度字段约 176MB；完整模型 175,997,641 B，本仓库是量化后的 44MB 版本。

## 重新生成模型（需要时）

1. 从 rembg release 取完整 `u2net_human_seg.onnx`（175,997,641 B），用 `onnxruntime-node` 验证可加载；
2. 用 onnxruntime Python 做 QOperator 静态量化（只量化 Conv，QInt8 权重 / QUInt8 激活，6 张校准图）；
3. 用 `onnxruntime-node` 验证输入 `input.1`、输出 `[1,1,320,320]`，单次推理约 265ms（开发机）；
4. 替换 `assets/models/u2net_human_seg.onnx`，跑 `npm test` + `node tools/cutout-diag.js --input tools/fixtures/synthetic-portrait.png --assert`；
5. 记录新的 SHA-256 与字节数（当前 `07ce2cee…24cfe` / 44,253,573 B）。

## 校验

- `npm test` 里有“离线抠图模型存在且非占位”（>10MB）。
- CI 会跑一次真实模型推理（合成人像 + 负例），模型放错/损坏会直接失败。