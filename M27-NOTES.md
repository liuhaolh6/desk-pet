# M27 · 更新提示 + 数据与隐私（P2-3 / P2-8 文档部分）

> 2026-10-23 · 对应提交：`feat(P2-3/P2-8): 更新提示 + 数据与隐私，0.6.9`
> 前置：[`ROADMAP.md`](ROADMAP.md) P2-3、P2-8；[`SIGNING.md`](SIGNING.md)（为什么不做静默安装）

## 1. 为什么这两件事一起做

P2-3（自动更新）本来写的是 `electron-updater` + 静默安装。读了一遍它的实现后发现：**静默安装等于运行一个
没有签名的安装包并替换正在运行的 exe** —— 0.6.9 的产物还没有签名（P2-2 卡在证书），所以这一步现在既做不对、
也不该做。

于是 P2-3 拆成两半，先做能对的那一半：**知道有新版本、说一声、把发布页打开**。真正的“下载并安装”等 P2-2
落地后再接 `electron-updater`，那时 `installUpdates` 才允许打开。

P2-8（开源决策）里唯一能先做、且不涉及“公开”这个决定的，是 `PRIVACY.md`。顺手把它做成可验证的：设置页里
的“数据与隐私”数字来自磁盘实测，而不是文档里写死一段话——**文档和 UI 读同一份代码**，这样它们不会互相撒谎。

## 2. 更新提示（P2-3）

```
lib/update-check.js      纯函数：compareVersions / isNewer / validUrl / decideUpdate
app/main/updater.js      createUpdater({ getSettings, windows, log })：fetch feed、24h 节流、提示
app/main/ipc.js          update:check（force）/ update:status / update:open
app/preload.js           checkUpdate(force) / getUpdateStatus() / openUpdate(url)
app/settings.js          设置 → 其他 → 更新：检查 + “去下载”
```

- **feed**：`settings.update.feedUrl`，留空时用 `app/main/updater.js` 里的
  `https://raw.githubusercontent.com/liuhaolh6/desk-pet/main/update.json`；`DESKPET_UPDATE_URL` 可覆盖（测试用）。
- **节流**：`CHECK_INTERVAL_MS = 24h`。`check(false)` 在 24 小时内直接返回 `{kind:'none', reason:'throttled'}`，
  所以“启动时看一眼”不会变成轮询。
- **`openUpdate` 只放行 `https:`**——`feed` 里的 `url` 是外部数据，不能让它变成 `file://` 或 `cmd:` 的跳板。
- **提示文案**在气泡里（`pet:nudge` 通道）和设置页各出现一次；不会弹系统通知，不打断。

### 验证（CDP，15/15）

本地起一个桩服务发 `{"version":"0.7.0","url":"https://github.com/..."}`，`DESKPET_UPDATE_URL` 指过去：

| 检查 | 结果 |
|---|---|
| `getUpdateStatus()` 带版本号 | `0.6.9` |
| 手动检查拿到新版本 | `kind=available, version=0.7.0` |
| 带 https 下载地址 | ✔ |
| 重复检查不崩 | 仍是 `available`（force 绕过节流） |
| `lastCheckAt` / `lastVersion` 落盘 | ✔ |
| `openUpdate('http://…')` | `false`（拒绝） |
| `openUpdate('https://…')` | `true` |
| 启动 12s 后气泡出现更新提示 | ✔（`pet:nudge`，不是 `pet:bubble`） |

单测 `tests/unit/update-check.test.js` 13 例：版本比较的边界（`v` 前缀、预发布、位数不齐）、`decideUpdate`
的五个分支、节流、`openDownload` 的协议白名单。

## 3. 数据与隐私（P2-8 文档部分）

```
app/main/privacy.js       summary()：真实体积；cleanup()：只删日志/轨迹/缓存
app/settings.html        其他 → 数据与隐私（<details>，整行宽）
app/settings.js          填数字、两步确认清理、更新开关
docs/PRIVACY.md          给人看的清单 + 四个常见担心点
tests/unit/privacy.test.js  5 例：真建目录、真删文件，断言设置/照片还在
```

- **数字来自磁盘**：`summary()` 每次现算 `settings.json`、`photos/`、`app.log`、`cutout-trace.jsonl`、
  Chromium 各缓存目录的体积；文件不存在就是 0，不抛错。
- **清理边界**写死在代码里并且有测试兜着：只删 `app.log`、`cutout-trace.jsonl` 和 `CACHE_DIRS` 里的**内容**
  （目录本身留着，省得 Chromium 下次启动重建时撞上占用）。`settings.json`、`roles/`、`photos/` 一律不碰。
- **异步清理**：一开始写成同步 `rmSync`，10 MB / 30+ 个缓存条目会把渲染进程卡住，按钮一直显示“正在清理…”。
  改成 `fs.promises.rm` 后 UI 立刻有反馈（这也是运行时验证里唯一一次失败 → 修复的来回）。
- **文档与实现对齐**：初稿的联网清单写了 `wttr.in`，但代码其实早就换成了 Open-Meteo（geocoding + forecast +
  air-quality）。这条是写文档时被 `grep 'https://' lib/weather.js` 抓出来的——**别凭记忆写清单**。

## 4. 顺手修的一个 a11y 回归

加上“数据与隐私”后跑 `tools/a11y-audit.js`，冒出一条：`input#soundVolume 7x24`。原因是设置窗口默认
520px 宽时，`音量` 标签 + 百分比把滑杆挤到 7px。给了 `min-width: 96px` 并让 `.control-line` 允许换行，
审计回到 86/0。

> 教训：审计失败不一定是新代码的锅，但**先假设是自己**——用 `git stash` 跑一遍基线，能立刻分清
> “原来就坏”还是“我刚弄坏”。这次是后者（宽窗下一直存在，只是没人量过）。

## 5. 没做的

- **静默更新**：等签名（P2-2）。
- **公开仓库**：这是人的决定，不是代码的事。`PRIVACY.md`、`LICENSE`（MIT）已经就位。
- **删除照片/角色的入口**：清理按钮故意不碰用户数据；要删请自己在数据目录里删。如果后面收到“找不到怎么删”的反馈，
  再加一个逐项删除。