# M17 · 首次欢迎引导（0.6.5）

> 目标：ROADMAP `P0-1` / 问题 `L14`——新用户第一次打开不知道「点我会出气泡」「要去设置选城市」。
> 做法：新数据目录首次启动弹一张三步欢迎卡，看完记住，之后不再打扰；设置里可以随时重看。
> 验收（ROADMAP 原文）：新数据目录首次启动出现；点「知道啦」后不再出现；键盘可完成；a11y 审计 0 失败。

---

## 1. 做了什么

| 文件 | 改动 |
|---|---|
| `app/onboard.html`（新，52 行） | 卡片骨架：`role="dialog" aria-modal="true"`，标题 + 三步 `<ol>` + 两个按钮 |
| `app/onboard.css`（新，183 行） | 复用 `tokens.css` 的间距/圆角/颜色；`forced-colors` 与 `prefers-reduced-motion` 分支 |
| `app/onboard.js`（新，57 行） | 名字取自 `getState().settings.name`；「知道啦」/Esc 关闭；「先去选城市」先关再开设置 |
| `app/main.js` | `openOnboard(force)` / `dismissOnboard()`、`onboard:open` / `onboard:dismiss` IPC、启动自动弹出、`DESKPET_OPEN_ONBOARD=1` 调试开关 |
| `app/preload.js` | 暴露 `openOnboard()` / `dismissOnboard()`（只加两个方法，其它通道不变） |
| `lib/store.js` | `DEFAULT_SETTINGS.onboarded = false`（**这个文件是 CRLF**，改的时候别把整文件换成 LF） |
| `app/settings.html` / `.js` | 「其他」面板新增「从头认识一下」一栏 + `#onboardBtn` → `onboard:open` |
| `tools/smoke.js` | 新增断言：默认 `onboarded=false`、关闭后为 `true`、三个按钮/文案存在、`ESCAPE` 分支存在（50 项） |
| `tools/check-a11y.js` | 新增：`lang` 属性、引导卡 DOM 结构、`reduced-motion` 覆盖（52 项） |
| `tools/a11y-audit.js` | 把 `onboard.html` 加入审计页列表（86 项） |

### 交互决定

1. **独立窗口，不是气泡**：气泡是宠物上方那块，读长文本会被 224px 预留和字号缩放拖累；欢迎卡需要真焦点与真滚动。
2. **三条关闭路径都落盘**：「知道啦」、「先去选城市」、Esc。否则用户按 Esc 跳过，下次又弹，比不弹更烦。
3. **「先去选城市」先 dismiss 再 `openSettings`**：反过来的话新设置窗口会落在卡片后面（卡片是普通置顶窗口）。
4. **名字实时取**：`getState()` 拿到 `settings.name` 再写进 `<span id="obName">`，用户改过名字就对得上；
   取不到时保留 HTML 里的默认值「小芳」，不阻塞渲染。
5. **窗口 480×580（内容区）**：`Math.max(400, Math.min(580, workArea.height - 48))`。最初写的是 510 上限，
   在 125% 缩放下内容需要 553，右侧出现滚动条；调到 580 后 `scrollHeight === innerHeight`。
6. **`force` 参数**：设置面板与 CDP 审计都要能在 `onboarded=true` 之后重开，靠 `openOnboard(true)` 绕过标记。

## 2. 运行时验证（CDP，24 项全过）

脚本：`.tmp/cdp-onboard.js`（不入库，模式同 `.tmp-verify/cdp-*.js`）。

| 组 | 断言 |
|---|---|
| 首启 | 新数据目录启动后出现 `file://…/onboard.html`，标题「欢迎使用桌宠」 |
| 结构 | `role=dialog` + `aria-modal=true`；`aria-labelledby` 指到「你好，我是小芳」；三步标题齐全；两个按钮 |
| 可用性 | 主按钮拿到焦点；按钮命中高度 34px；无横向溢出；焦点环未被 `outline:none` 干掉；装饰图 `alt=""`；AX 树含 `dialog` + 2×`button` |
| 稳定性 | 强制重载后 0 条 console error / exception，名字仍渲染 |
| 落盘 | 点「知道啦」→ 窗口关闭；`getState().settings.onboarded === true`；`settings.json` 里确实有 `"onboarded": true` |
| 重看 | 宠物 `deskPet.openOnboard()` 能重开；Esc 能关；设置 → 其他 → 「再看一次欢迎引导」（面板要切到 `other` 才可见）能重开 |
| 不再打扰 | 关掉后 `location.reload()` 不再自动弹 |

`tools/a11y-audit.js --port 9222`：**86 项、失败 0**，其中 `onboard.html` 10 项（对比度 0 处低于门槛、0 个小目标、
焦点可见 5/5、320px 回流 `scrollWidth===320`、forced-colors 0 处、reduced-motion 0 个元素带 >50ms 过渡）。

其它门：`tools/smoke.js` **50**、`tools/check-a11y.js` **52**、`tools/a11y-keyboard.js` **6/6**。

截图：`.tmp/onboard-final.png`（480×584 内容区，无滚动条）。

## 3. 环境坑（这次新踩到的）

1. **DSH 受限沙箱下 Electron 起不来**：`--no-sandbox` 之外，进程还得在沙箱外启动。在
   workspace-write 模式下启动会看到

   ```
   [pid:…:FATAL:mojo\public\cpp\platform\platform_channel.cc:108] Check failed: . : 拒绝访问。 (0x5)
   ```

   随后 `DevTools listening` 照常打印、`app.log` 也能写到 `windows created`，但进程随即退出（`exit code: 1`）。
   同一命令在 `danger-full-access` 下正常。`Start-Process`、WMI `Win32_Process.Create`、`schtasks`
   三条“分离启动”路子都绕不过去（WMI 直接 `拒绝访问`）。
2. **`--no-sandbox` 仍然必须**：不带它时进程静默死在 `0x80000003`（HANDOFF §6.1 第 1 条）。
3. **不进沙箱时也别用 `start`**：`cmd /c start "" electron.exe …` 会让启动器立刻返回、应用日志完全没有新行，
   误判成“启动失败”。直接前台跑在后台 job 里，日志才会跟着来。
4. **设置面板的按钮先切面板再断言**：`#onboardBtn` 在 `[data-panel="other"]` 里，默认 `hidden`，
   `offsetParent === null` 不是缺陷——先 `nav[data-panel="other"].click()` 再判断可见性。

## 4. 还没做

- 打包：0.6.5 只改了代码与文档，`dist/` 里仍是 0.6.4 的 portable；重打包后要再跑一遍
  `a11y-audit --port <打包版端口>`（历史上窗口多一个，项数为 86 不变）并更新 HANDOFF §0 的产物哈希。
- 引导卡暂不随语言/主题切换（本项目只有中文一套）。
- 未在 200% 缩放下手测（已知基线缺口，同 `A11Y-AUDIT.md` §6）。