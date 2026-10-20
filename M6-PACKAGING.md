# M6 打包记录（portable exe）

> 记录时间：2026-10-19 · 版本 `0.2.0`
> 产物：`dist/DeskPet-0.2.0-portable.exe`（gitignore，不随仓库提交）
>
> 历史记录。当前 `0.4.1` 的便携包沿用同一 build 配置与 64 位 NSIS 绕坑，
> 产物与 M10/M10.1 验证见 `M10-NOTES.md`、`M10.1-NOTES.md`。

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
