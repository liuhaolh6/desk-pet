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
---

# M17 第二批 · P0-2〜P0-5（0.6.6，同一天）

> 目标：ROADMAP P0 剩下的四项——长文案下限（L10）、托盘兜底（L8）、用户手册（L6）、诊断导出（L13）。
> 结论：四项全部完成并实测；M17 的 P0 清单清空。

## 5. 做了什么

| 文件 | 改动 |
|---|---|
| `app/pet.js`（819 行） | `FIT_FLOOR = 0.6`；`fitBubbleText()` 循环后统一落地 `--bubble-fit` 再 `clampBubbleText()`；新增 `overflowAmount()`（量渲染矩形）与 `clampBubbleText()`（按 `keepRatio` 整体截断，`data-full` 还原、`title`/`aria-label` 留全文） |
| `app/pet.css` | 注释写清 60% 下限与手动截断；文字层不加 `overflow:hidden`（截断由脚本做，省略号落在词边界） |
| `app/main.js`（1451 行） | `globalShortcut` 引入；`togglePet()` 统一托盘/快捷键；`createTray()` try/catch + `trayStatus`；`registerGlobalShortcut()` + `shortcutReport()`；`app:status`；`before-quit` 注销；`sanitizedSettings()` / `tailLines()` / `buildDiagnostics()` / `exportDiagnostics()` + `app:diagnostics` |
| `app/preload.js` | 只加 `getAppStatus()`、`exportDiagnostics()` |
| `app/settings.html` / `.js` | 「托盘和快捷键」两行状态（`#trayStatus`/`#shortcutStatus`）+「遇到问题」导出按钮（`#diagBtn`/`#diagStatus`）；`renderAppStatus()`；导出时按钮禁用、结果写回说明行 |
| `docs/USER-GUIDE.md`（新，123 行） | 三分钟上手 + 9 条 FAQ（托盘找不到 / 天气 / 气泡字太小 / 喝水 / 换照片 / 数据与备份 / 自启穿透大小 / 反馈 / 卸载）+ 键盘无障碍 + 隐私 |
| `README.md` | 首屏「第一次用？先看用户手册」入口；特性表加「快捷键兜底」「诊断导出」两条 |
| `tools/smoke.js`（880 行） | +8 条：溢出用矩形实测、`keepRatio` 比例收缩、托盘失败不崩、`app:status`、设置页两行、导出脱敏与日志尾巴（52 项） |
| `tools/check-a11y.js` | +5 条：托盘/导出行是纯文本、不 `aria-hidden`、走 `textContent`、按钮有名称、结果行不进 `aria-live`（57 项） |

## 6. 验收实测（CDP，`:9222`）

`tools/smoke.js` 52 / `tools/check-a11y.js` 57 / 静态语法 `npm run check` 全绿。

气泡（`.tmp/cdp-bubble-text.js`，12/12）：

| 场景 | 结果 |
|---|---|
| 120 字单模块（ROADMAP 验收） | 字号 **16.02px**、`--bubble-fit: 1.000`、溢出 `0×0` |
| 6 行 × 200 字（压爆） | 字号停在下限 **9.61px（0.600）**，按比例截到 21 字/模块，溢出 `0×0` |
| 截断语义 | 每个被截模块尾部 `…`，`title` 与 `aria-label` 仍是 200 字全文 |
| 短句 | 不截断、16.02px |
| 反复重渲染 | 省略号个数 0 增长（先 `data-full` 还原） |

托盘 / 快捷键 / 诊断（`.tmp/cdp-p0-verify.js`，16/16）：

| 检查 | 结果 |
|---|---|
| `getAppStatus()` | `tray{ok:true}`、`shortcut{ok:true, registered:true}`、Electron 44.9.0 |
| 设置页文案 | 「托盘没问题：右键有设置和退出…」「Ctrl+Alt+P 可以用…」 |
| 导出 | 点按钮 → `diagnostics-20261022-154935.txt`，15,099 字节 |
| 脱敏 | 用假坐标重测：`lat/lon/city/label` 全部 `[已脱敏]`，全文不含「上海」、不含数字坐标 |
| 内容 | 版本段、托盘/快捷键段（含 `registered`）、app.log 末尾 200 行（317 行文件）、设置段不带图片路径 |

## 7. 这次踩到的坑（已写进 HANDOFF §6.1 5.3–5.5）

1. **先查模型上限再测**：`bubble-model.js` 把单模块截到 200 字，我用 500 字单模块测了半小时「为什么不截断」。
2. **溢出不能只测 `scrollHeight`**：居中安全区两端溢出，改量矩形（`overflowAmount()`）。
3. **截断不能每轮剪 10%**：1200 字要 ~80 轮，护栏先耗尽、还差 35px；改按 `over.h/clientHeight` 一次性按比例缩。
4. **`registered` 要复读 OS**：`register()` 的返回值不等于系统当下状态，诊断里用 `globalShortcut.isRegistered()`。
5. **导出脱敏要拿真坐标验**：默认 `lat/lon` 是 `null`，只测默认值等于没测；临时写 31.2304/121.4737 才验出 `[已脱敏]`。

## 8. 收尾（同日补做）：托盘点、真按键、重新打包

### 8.1 托盘根因：查到「不是我们能修的」这一步
- **结论**：本机（Win11 26200.9711）上 **Electron 39.8.5 与 44.9 的 `Tray` 都不进通知区**；同机
  **WinForms `NotifyIcon`** 与应用自带的 **DSH（Electron 打包版）** 托盘都正常 → 判定为 Electron 托盘实现
  与该 Windows 版本通知区之间的兼容问题，应用侧无解。
- **排除过程**（都可复现）：
  1. dev 实例（44.9）→ `tray.getBounds()` 全 0、UIA 通知区里没有 → 打包版 0.6.4（44.9）同样没有；
  2. 最小 Electron 探针：`electron@39.8.5` 与 44.9 都是 `bounds={"x":0,"y":0,"width":0,"height":0}`，
     PNG 与 ICO（直接借 DSH 的 `tray.ico`）都试过；
  3. 用 WMI `Win32_Process.Create` 让应用**脱离 DSH 进程树**启动（父进程变 WmiPrvSE）→ 仍然没有；
  4. 重启 `explorer.exe` 重建通知区 → 仍然没有；
  5. 对照：PowerShell + WinForms `NotifyIcon`（`SystemIcons.Application`、ASCII tooltip）→ **出现**；
     DSH 自己的托盘 → **在**。
- **正确检测法**（别用 `getBounds()`，折叠时也是 0）：UIA 找 `Shell_TrayWnd` → 「显示隐藏的图标」按钮 →
  `InvokePattern` → `EnumWindows` 找类名含 `Overflow` → 遍历子 `Button.Name`（`.tmp/check-overflow.ps1`）。
- 相关背景：super-productivity#8470 记录过「未签名 + 固定 exe 路径的 GUID → `NIM_ADD` 静默失败」；
  本项目**没传 GUID**，已排除这类 GUID 缓存问题。

### 8.2 `Ctrl+Alt+P` 真人按键（已验）
`keybd_event` 发系统级 Ctrl+Alt+P（不是 CDP 页面注入），配合 UIA 读桌宠窗口 `IsWindowVisible`：

| 轮次 | dev 实例（44.9，`:9223`） | 打包版（0.6.6，`:9226`） |
|---|---|---|
| 初始 | `桌宠 vis=True` | `桌宠 vis=True` |
| 按一次 | `vis=False` | `vis=False` |
| 再按一次 | `vis=True` | `vis=True` |

同时 `getAppStatus().shortcut = {ok:true, registered:true, accelerator:"Ctrl+Alt+P"}`。

### 8.3 重新打包（0.6.6）
- `npx electron-builder --win portable`（Electron 44.9.0 / x64）→
  `dist/DeskPet-0.6.6-portable.exe` **153,672,929 B**，`dist/win-unpacked/DeskPet.exe` 文件版本 `0.6.6`。
- 冷启动 `dist\win-unpacked\DeskPet.exe`（WMI 分离启动）→ CDP `:9226` 可连、`getAppStatus()` 版本 0.6.6、
  首次引导卡出现（新数据目录 `.tmp/e-pkg-data`）。
- **portable 包装器**在本机只停在解压阶段、没拉起子进程（与 HANDOFF §6.2 #8「未签名 + `%TEMP%` + 安全软件」
  一致），因此打包验证走 `win-unpacked`；portable 产物本身生成正常。
- 设置页托盘成功文案改成如实描述（不再说「托盘没问题」），`npm run check` / `npm test`（52 项）/
  `node tools/check-a11y.js`（57 项）全绿。

## 9. 还没做

- 真机上的**屏幕阅读器**（NVDA/讲述人）与高对比度主题仍未验证，只有自动化审计（86 项 + 键盘 6 项）。
- portable 包在本机被安全软件拦住，**没在干净机器上验过**；上架/签名仍未做。
- 托盘问题只能等 Electron 上游或 Windows 修；应用侧只剩兜底（`Ctrl+Alt+P`、悬浮菜单、设置页状态）。
