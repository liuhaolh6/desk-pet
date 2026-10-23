# 贡献指南

感谢你愿意改进 DeskPet。这是一个 Windows 桌面小工具，单人维护，走“可复现、可回滚、有记录”的路子。

## 开始之前

- 先读 [`HANDOFF.md`](HANDOFF.md)：现状、设计决策、已知坑和待办都在里面。
- 改动前先看 [`PLAN.md`](PLAN.md) 与 [`M12-PLAN.md`](M12-PLAN.md)，避免和进行中的阶段冲突。
- 提 Issue 请用仓库自带模板；安全相关问题请走 [`SECURITY.md`](SECURITY.md)。

## 开发环境

- Windows x64（目前唯一支持的目标平台）
- Node.js 18+（CI 使用 22）

```bash
npm install
npm start            # 启动桌宠（开发模式）
```

国内网络可以用镜像：

```powershell
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
npm install --registry=https://registry.npmmirror.com
```

## 提交前必须跑

```bash
npm run check        # 14 个文件的语法自检
npm test             # 无界面测试（工具/存储/天气/抠图纯函数/静态回归）
node tools/check-a11y.js   # 无障碍结构回归
```

改动涉及抠图时再加：

```bash
node tools/cutout-diag.js --fake tools/fixtures/synthetic-portrait.png --mask tools/fixtures/synthetic-portrait-mask.png --assert
node tools/cutout-diag.js --input tools/fixtures/negative-landscape.png --expect no-person
```

改动涉及界面时，用 CDP 起真机验证（见 [`HANDOFF.md`](HANDOFF.md) §6）：

```powershell
& node_modules\electron\dist\electron.exe . --no-sandbox --remote-debugging-port=9229
node tools/a11y-audit.js --port 9229     # 86 项无障碍检查
node tools/a11y-keyboard.js --port 9229  # 6 项键盘-only 流程
```

## 代码约定

- **主进程 / 渲染进程边界**：渲染进程不直连第三方、不碰文件路径；网络与磁盘都在 `lib/` 与 `app/main.js`。
- **纯逻辑放 `lib/`**：能脱离 Electron 测试的（存储、天气码、抠图数学、PNG 编解码）都放这里，`tools/smoke.js` 覆盖。
- **610 PNG 契约**：角色图与抠图结果固定 610×610 直通 alpha，不要引入会雾化的 `nativeImage.resize`。
- **透明窗口**：不要动画 `filter`，不要在气泡可见期间反复 `setBounds`（会闪，见 [`HANDOFF.md`](HANDOFF.md) §5.41）。
- **无障碍基线**：不要回退对比度令牌、≥24×24 目标、`prefers-reduced-motion` 与键盘可达性（见 §5.42）。

## 文档

- 每个里程碑在根目录留一份 `*-NOTES.md`：现象、证据、修复、验证、未覆盖项、回滚。
- 用户可见的行为变化写进 [`CHANGELOG.md`](CHANGELOG.md)。
- 跨对话接手的上下文写进 [`HANDOFF.md`](HANDOFF.md)。

## 提交与 PR

- 提交信息用中文，格式 `type(scope): 摘要`（`feat` / `fix` / `docs` / `chore` / `test` / `refactor`），版本变化写在 `chore` 或对应 `feat/fix` 里。
- 一个 PR 只做一件事；带上“跑了什么测试、结果如何”。
- **不要提交个人照片**：仓库只放 `tools/fixtures/` 下的合成图与界面截图；`*.log`、`.m*-*/`、`dist/` 已在 `.gitignore`。

## 发布流程（维护者）

1. 更新 `package.json` 版本号与 [`CHANGELOG.md`](CHANGELOG.md)；
2. 跑完上面的检查，构建 `npm run dist` 并真机验证 portable；
3. `git tag -a vX.Y.Z -m "..."` 并推送 tag —— tag 会触发 `.github/workflows/release.yml` 自动构建并创建 GitHub Release；
   - **一次最多推 3 个 tag**：GitHub 在单次 push 超过 3 个 tag 时不会触发任何 workflow。分批推，或逐个 `git push origin vX.Y.Z`。
   - 需要重跑某个 tag 的发布：删除远端 tag 再单独推一次（或手动触发 `Release` workflow，传入 `tag` 输入）。
   - 工作流失败时会自动开一个带构建日志的 Issue；CI 的构建走 64 位 NSIS 绕坑，见 [`M6-PACKAGING.md`](M6-PACKAGING.md) §3.2。
4. 签名流程见 [`SIGNING.md`](SIGNING.md)（SignPath Foundation 审核中，当前产物未签名）。