# 安全策略

## 支持的版本

只有最新的 0.5.x 版本会收到修复。旧版本请先升级到 [Releases](https://github.com/liuhaolh6/desk-pet/releases) 里的最新版。

| 版本 | 支持 |
|---|---|
| 0.5.x | ✅ |
| ≤ 0.4.x | ❌ |

## 报告漏洞

请**不要**用公开 Issue 报告安全问题。用 GitHub 的私密渠道：

- [Private vulnerability reporting](https://github.com/liuhaolh6/desk-pet/security/advisories/new)（推荐），或
- 在 Issue 里只写“需要私下沟通”，不要贴利用细节。

请在报告里尽量包含：受影响版本、复现步骤、影响（数据泄露 / 权限 / 崩溃）、以及你希望的披露时间。单人维护，通常会在 7 天内给出第一次回复。

## 本项目的攻击面（帮助判断问题是否属于本项目）

DeskPet 是本地 Electron 应用，设计上：

- **不登录、不上传**：没有账号体系，不收集遥测；只向 [Open-Meteo](https://open-meteo.com/) 请求天气与城市搜索。
- **照片与角色只在本机**：抠图模型随包离线运行，图片不离开设备。
- **渲染进程最小权限**：`contextBridge` 白名单 API，渲染进程拿不到文件路径，角色图走自定义 `pet-role://` 协议。
- **数据目录**：`%APPDATA%\desk-pet\`（便携版在 exe 同级 `desk-pet-data\`），可用 `DESKPET_DATA_DIR` 覆盖。

值得报告的方向：IPC 越权、自定义协议路径穿越、天气响应解析导致的崩溃/内存问题、模型文件被替换后的加载行为、启动参数注入。

## 已知的非安全事项

- 产物**未签名**：Windows SmartScreen 会提示，这是预期行为，不是漏洞；签名进展见 [`SIGNING.md`](SIGNING.md)。
- 运行需要 `--no-sandbox`（快捷方式脚本已带）：这是为了绕开部分加固环境下 Electron 沙箱初始化失败的问题，已在 README 说明。

## 依赖

依赖漏洞会通过 Dependabot 提醒（`.github/dependabot.yml`，每周一次）。涉及 `electron`、`onnxruntime-node` 的升级会先跑 `npm test`、抠图诊断与真机验证再合并。