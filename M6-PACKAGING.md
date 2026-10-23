# M6 打包记录（portable exe）

> 记录时间：2026-10-19 · 版本 `0.2.0`
> 产物：`dist/DeskPet-0.2.0-portable.exe`（gitignore，不随仓库提交）
>
> 历史记录。当前 `0.5.0` 的便携包沿用同一 build 配置与 64 位 NSIS 绕坑，
> 产物与 M10/M10.1/M10.2/M11 验证见对应 NOTES。

## 1. 产物与版本信息

| 项 | 值 |
|---|---|
| 文件 | `dist\DeskPet-0.2.0-portable.exe` |
| 大小 | 100,513,136 字节（约 96 MB） |
| 类型 | `electron-builder` `portable`（NSIS 自解压，单文件，无需安装） |
| 架构 | x64（Electron 44.9.0） |
| ProductName | `DeskPet` |
| CompanyName | `liuhaolh6` |
| FileDescription | `package.json` 的 description |
| FileVersion / ProductVersion | `0.2.0` / `0.2.0` |
| 图标 | `build/icon.ico`，16/24/32/48/64/128/256 多尺寸；从 exe 提取确认正常 |

图标由 `tools/make-assets.py` 生成（同时生成 `assets/icon.png`、`assets/tray.png`、`assets/tray@2x.png`）。

## 2. 构建配置

`package.json` 的 `build` 字段：

- `appId: com.deskpet.app`（与 `app.setAppUserModelId` 一致）
- `productName: DeskPet`、`executableName: DeskPet`
- `win.target: portable`、`arch: x64`
- `artifactName: DeskPet-${version}-portable.${ext}`
- `asar: true`，`npmRebuild: false`
- `electronDist: node_modules/electron/dist`（直接用本机已下载的 Electron，避免再下 zip）
- `toolsets.nsis: "1.2.1"`（新版 NSIS 工具集；旧 3.0.4.1 在本机有大包问题）
- `files`: `app/**`、`lib/**`、`assets/**`、`package.json`
- `portable.requestExecutionLevel: "user"`

> 注意：最终 exe 由提交 `9227115`（M8 音效库已提交）的干净工作树于 23:25 重新打包，版本信息仍为 0.2.0；`npm test` 19 项全绿。构建日志确认 exit=0，asar 内包含 `bubble-model.js`、`editor.*`、`sound-model.js`。

## 3. 构建命令

普通桌面环境（期望路径）：

```powershell
cd D:\project\deskpet
npm run dist
# 输出：dist\DeskPet-0.2.0-portable.exe
```

本机（Windows 11 26200 + Lenovo Anti-Virus 火绒引擎）需要绕过 32 位 NSIS 的 mmap 问题：

```powershell
$env:ELECTRON_BUILDER_CACHE='D:\project\deskpet\.builder-cache'
$env:ELECTRON_BUILDER_BINARIES_MIRROR='https://npmmirror.com/mirrors/electron-builder-binaries/'
$env:ELECTRON_BUILDER_NSIS_DIR='D:\project\deskpet\.tools\nsis-custom'
$env:ELECTRON_BUILDER_NSIS_RESOURCES_DIR='D:\project\deskpet\.builder-cache\nsis@1.2.1\nsis-bundle-3.12-1qor4'
node node_modules\electron-builder\cli.js --win portable --x64
```

必须从 **PowerShell（原生 Windows PATH）** 执行，不要从 Git Bash 执行：bash 下 `which npm` 找不到 `npm.cmd`，electron-builder 的依赖收集会退化并报 `No JSON content found in output`。

### 3.1 64 位 NSIS 绕坑（仅本机）

32 位 `makensis.exe` 在数据块超过约 16 MB 时失败：

```
Internal compiler error #12345: error creating mmap the size of 116831394.
```

3.0.4.1 与 1.2.1（3.12）的 32 位编译器都会失败；64 位编译器正常。本机做法：

1. 下载 `negrutiu/nsis` 的 amd64 构建（例如 `nsis-3.13.7507.353-negrutiu-amd64.exe`），用 7-Zip 解包到 `.tools\nsis-amd64`。
2. 在 `.tools\nsis-amd64\nsisconf.nsh` 末尾加 `Target x86-unicode`（electron-builder 的插件目录是 x86-unicode）。
3. 建 `.tools\nsis-custom\makensis.cmd`，设置 `NSISDIR=D:\project\deskpet\.tools\nsis-amd64`，然后调用 `Bin\makensis.exe %*`。
4. 把 1.2.1 bundle 根目录的 `elevate.exe` 复制到 `.tools\nsis-custom\elevate.exe`。
5. 设置上面的 `ELECTRON_BUILDER_NSIS_DIR` / `ELECTRON_BUILDER_NSIS_RESOURCES_DIR` 再构建。

`.tools/`、`.builder-cache/`、`.npm-cache/` 均已 gitignore，是可重建的本地工具缓存。

### 3.2 同样的问题在 CI（已修复）

`.github/workflows/release.yml` 里默认的 electron-builder 会下载 32 位 NSIS，在 GitHub 托管 runner 上会稳定复现同一个 mmap 错误（本地用干净缓存 + 默认工具链也复现过）。现在 release 工作流自己准备 64 位编译器：

1. `actions/cache` 缓存 `%RUNNER_TEMP%\nsis64`（key 带 NSIS 版本，命中就不重复下载）；
2. 从 `negrutiu/nsis` 的**固定版本** release 下载 amd64 安装包，用 7-Zip 解包（解包后是 `Bin\makensis.exe` 的 legacy 布局）；
3. 从 `electron-userland/electron-builder-binaries` 的 `nsis@1.2.1` bundle 取 `elevate.exe` 放到同一目录（`getNsisElevatePath()` 会优先从 `ELECTRON_BUILDER_NSIS_DIR` 找它）；
4. 在 `nsisconf.nsh` 末尾追加 `Target x86-unicode`；
5. 导出 `ELECTRON_BUILDER_NSIS_DIR` 指向该目录；`nsis-bundle`（插件）由 electron-builder 自己下载。

首次运行会把安装包的 SHA-256 打进 workflow 日志（日志需要登录才能看）；bundle（`nsis-bundle-3.12.tar.gz`）已按官方发布的校验值在 CI 里强制核对。稳定后可把安装包也改成固定校验值。

CI 排查提示：Actions 的 **step 级别**结果不需要登录即可通过 API 读取（`/actions/runs/{id}/jobs`），但**日志需要登录**。所以 release 工作流在失败时会用 `GITHUB_TOKEN` 自动开一个带构建日志尾部的 Issue（标题 `[CI] Release build failed for <tag>`），发布成功后自动关闭；这样失败原因对维护者和你都是公开可见的。

## 4. 验证结果

### 4.1 启动与便携数据目录

用「普通用户令牌 + 可写 TEMP + 清空 `ELECTRON_RUN_AS_NODE`」的计划任务启动 exe（避开 DSH 子进程限制和 SmartScreen），日志 `/dist/desk-pet-data/app.log`：

```
boot electron=44.9.0 packaged=true argv=...\DeskPet.exe --no-sandbox
trying data dir D:\project\deskpet\dist\desk-pet-data
using data dir D:\project\deskpet\dist\desk-pet-data
portableDir=D:\project\deskpet\dist portableExe=D:\project\deskpet\dist\DeskPet-0.2.0-portable.exe
userData=D:\project\deskpet\dist\desk-pet-data
store=D:\project\deskpet\dist\desk-pet-data
tray created empty=false icon=...\app.asar\assets\tray.png menu=显示 / 隐藏|设置…|编辑气泡…|刷新天气|separator|退出
tray bounds={"x":0,"y":0,"width":0,"height":0}
windows created pet=yes tray=yes
pet-loaded bounds={"x":1196,"y":642,"width":330,"height":222}
pet-show ... visible=true
pet-visible=true onTop=true
```

结论：

- portable stub 正确设置了 `PORTABLE_EXECUTABLE_DIR` / `PORTABLE_EXECUTABLE_FILE`。
- 不设 `DESKPET_DATA_DIR` 时，数据自动落在 exe 同级 `desk-pet-data\`；整个文件夹可搬走。
- 宠物窗口可见、置顶；M7 的「编辑气泡…」菜单项已在打包版中出现。
- 开机自启代码使用 `PORTABLE_EXECUTABLE_FILE`，不会指向临时解压目录。

### 4.2 截图

本地临时截图（未提交）：

- `.tmp-verify/running.png`：宠物 + 天气气泡渲染正常。
- `.tmp-verify/overflow-open.png`：Windows 11 托盘溢出区。
- `.tmp-verify/exe-icon-new.png`：从 exe 提取的图标。

## 5. 本机限制与未完成验证

1. **双击被 SmartScreen 拦截**：exe 未签名，Explorer 启动时出现「Windows 已保护你的电脑」。需点「更多信息 → 仍要运行」，或对 exe 做代码签名。计划任务/直接 CreateProcess 可绕过，但那不是严格意义的双击验证。
2. **Lenovo Anti-Virus（火绒引擎）拦截未签名进程写 `%LOCALAPPDATA%\Temp`**：`CreateFileW` 返回 `ACCESS_DENIED(5)`，NSIS portable 报
   `NSIS Error: Error writing temporary file. Make sure your temp folder is valid.`。
   把 `TEMP`/`TMP` 指到可写目录（如 `D:\project\deskpet\.tmp-runtime`）后可正常启动；正式分发建议签名或让用户加白名单。
3. **托盘图标未显示**：`Tray` 对象创建成功（`empty=false`，菜单齐全），但 Windows 通知区和「显示隐藏的图标」溢出区都没有看到桌宠图标，`tray.getBounds()` 为 `0,0,0,0`；宠物窗口、右键菜单、设置窗口正常。因此「托盘可用」只验证到**对象/菜单创建**，尚未完成可视化点击验证。疑似与本机 Windows 11 26200 + 安全软件有关，建议在干净机器或签名后复验。
4. **`ELECTRON_RUN_AS_NODE=1`**：DSH 会话环境自带；直接启动打包/开发 Electron 会变成 Node 模式（`bad option: --no-sandbox`）。测试前清掉该变量。
5. **DSH 工具会等待 GUI 进程树**：前台启动桌宠会让工具调用一直挂起；应使用计划任务、WMI 或 Explorer 分离启动。
6. `--no-sandbox`：从受限环境启动需要；正常桌面双击不需要。

## 6. 复验命令（本机）

```powershell
# 1) 准备可写 TEMP，避免火绒拦截
New-Item -ItemType Directory -Force 'D:\project\deskpet\.tmp-runtime' | Out-Null

# 2) 普通用户令牌启动（计划任务示例；也可用 Explorer 双击后点「仍要运行」）
$cmd = 'D:\project\deskpet\.tmp-verify\run-portable-auto.cmd'
schtasks /create /tn 'DeskPetM6Auto' /tr $cmd /sc once /st 00:00 /it /f
schtasks /run /tn 'DeskPetM6Auto'

# 3) 看日志
Get-Content 'D:\project\deskpet\dist\desk-pet-data\app.log' -Tail 30

# 4) 清理
Get-Process | Where-Object { $_.Path -like '*\.tmp-runtime\*' } | Stop-Process -Force
schtasks /delete /tn 'DeskPetM6Auto' /f
```

`run-portable-auto.cmd` 内容：

```bat
@echo off
set "TEMP=D:\project\deskpet\.tmp-runtime"
set "TMP=%TEMP%"
set "ELECTRON_RUN_AS_NODE="
"D:\project\deskpet\dist\DeskPet-0.2.0-portable.exe" --no-sandbox
```

## 7. NSIS 安装器（0.6.7 起，ROADMAP P2-1）

### 7.1 产物与形态

| 项 | 值 |
|---|---|
| 文件 | `dist\DeskPet-<version>-setup.exe`（0.6.7：165,559,500 B，未签名） |
| 形态 | **一键安装**（`oneClick: true`）：双击 → 几秒装完 → 自动启动，不需要管理员 |
| 安装位置 | `%LOCALAPPDATA%\Programs\desk-pet`（per-user；目录名来自 `package.json` 的 `name`，**不是** `executableName`/`productName`） |
| 快捷方式 | 开始菜单「桌宠」+ 桌面「桌宠」 |
| 卸载入口 | 设置 → 应用 → 已安装的应用「桌宠 DeskPet 0.6.7」；或 `"%LOCALAPPDATA%\Programs\desk-pet\Uninstall DeskPet.exe"` |
| 用户数据 | 安装版默认 `%APPDATA%\desk-pet`；`deleteAppDataOnUninstall: false`，卸载**不删**数据 |
| 静默安装 | `DeskPet-0.6.7-setup.exe /S` |
| 静默卸载 | `"%LOCALAPPDATA%\Programs\desk-pet\Uninstall DeskPet.exe" /S /currentuser` |

### 7.2 构建

```powershell
# 火绒引擎会拦未签名进程写 %LOCALAPPDATA%\Temp，构建前把 TEMP 指到可写目录
$env:TEMP = 'D:\project\deskpet\.tmp-runtime'
$env:TMP  = $env:TEMP
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
npm run dist:installer      # 内含 predist:installer → npm run clean:dist
```

`clean:dist`（`tools/clean-dist.js`）先删 `dist/win-unpacked`：electron-builder 只覆盖拷贝，
上一次“在 win-unpacked 里跑过应用”留下的 `desk-pet-boot.log` 会被打进安装包。

### 7.3 验证结果（2026-10-23，本机 Win11 26200）

| 步骤 | 结果 |
|---|---|
| 静默安装 `/S` | 15s，退出码 0；`%LOCALAPPDATA%\Programs\desk-pet\DeskPet.exe` 版本 **0.6.7**（247,297,536 B） |
| 快捷方式 | 开始菜单 ✓、桌面 ✓ |
| 卸载注册项 | `HKCU\...\Uninstall` 有「桌宠 DeskPet」0.6.7 + `UninstallString` |
| 启动（安装版） | `DESKPET_DATA_DIR` 指到临时目录后起 CDP，`getAppStatus()` 报 `version 0.6.7`、`state bubble`，点一下正常冒泡 |
| 静默卸载 | 0.3s 退出码 0；安装目录 0 个残留、两个快捷方式已删、ARP 条目已删、用户数据保留 |
| 安装目录干净 | 修复 `log.js` 后安装目录里不再出现 `desk-pet-boot.log`（打包版 breadcrumb 改到 `%TEMP%`） |

### 7.4 踩坑（都验证过）

1. **目录名是 `desk-pet`**：一开始拿 `%LOCALAPPDATA%\Programs\DeskPet` 判断“装没装”，连续几轮都判成“静默安装无效”——实际早就装好了。验证脚本要么读 `UninstallString`，要么按 `name` 推路径。
2. **向导式 + 静默安装是坏的**：`oneClick: false` 时 `$INSTDIR` 只由向导页的 `setInstallModePerUser` 赋值；静默模式没有页面 → `$INSTDIR` 为空 → `CHECK_APP_RUNNING` 里 PowerShell 的 `$_.Path.StartsWith('$INSTDIR')` 变成 `StartsWith('')`，**任何进程都算命中** → 误判“DeskPet 正在运行”，静默退出码 0、什么都没装；向导模式则卡在「无法关闭 DeskPet 进程」。改成一键安装后两个问题都消失（`oneClick.nsh` 在 `.onInit` 里就设好安装模式）。
3. **`%TEMP%` 不可写**：报 `NSIS Error: Error writing temporary file…`，见 §5.2。
4. **构建产物复用**：见 §7.2 的 `clean:dist`。
5. **`/D=` 只在向导模式可靠**：一键安装固定装到 `%LOCALAPPDATA%\Programs\desk-pet`，想换位置就用便携版。

## 8. 打包时容易漏的两类目录（0.6.10 实测）

`build.files` 是白名单：写了 `app/**/* lib/**/* assets/**/*` 之后，仓库根下新加的目录**不会自动进去**。0.6.10 打包验证时发现安装版里 `themes/` 与 `locales/` 都不存在——界面能起，但主题下拉是空的、多语言字典是空的。已补成显式规则：

```json
"files": ["app/**/*", "lib/**/*", "assets/**/*", "locales/**/*", "themes/**/*", ...]
```

**验收方式**：装完之后跑 `window.deskPet.getThemes()`（应返回 ≥2 个包）与 `window.deskPet.i18n.t("tray.toggle")`（应返回当前语言文案）。开发态发现不了，因为开发态读的是仓库根目录。
