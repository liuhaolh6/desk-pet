# desk-pet · 桌面宠物

Windows 桌面上的常驻小宠物：点一下看天气、被提醒喝水，换自己的照片当角色，名字、大小、模式、位置都能改。

> 不依赖 DSH：这是一个独立的 Electron 桌面应用。早期版本曾按 DSH 插件形态实现，存档在仓库外的 `deskpet-dsh-plugin/`。

## 特性

- 🖼️ **自定义角色**：任意图片导入（自动缩放到 610px 内），多角色切换与删除
- 🌤️ **天气**：点角色弹出当前天气（温度、天气、今日高低温、降水概率、湿度），城市搜索，断网用上次缓存并标注「离线缓存」
- 💧 **喝水提醒**：按间隔提醒，记录今日杯数，支持免打扰时段；窗口隐藏时走系统通知
- 💬 **点击队列**：天气 → 喝水 → 温馨语句（到点才出现），再点收起；温馨语句可自己写
- 🧩 **气泡模块化编辑器**：每张卡由多行、每行由多个模块组成；模块可选固定文字 / 随机语句 / 名字 / 天气各项 / 今日杯数 / 时间 / 日期，单独调字号、加粗、斜体、文字色、底色，支持拖拽排序与「模块库」复用
- 🧲 **桌面行为**：无边框透明窗口、始终置顶（可关）、拖动摆位、托盘菜单、开机自启（可选）
- 🎛️ **全量可配置**：名字、大小 120–360px、模式（安静/正常/话痨）、天气刷新、气泡收起与冷却、音效
- 🔊 **音效库**：内置 5 种合成音色（叮/啵/水滴/三音/轻提示，不占安装体积）；可导入 wav/mp3/ogg/m4a/flac；点击角色、气泡出现、喝水提醒三个事件各自选片段、单独音量或跟随总音量，每行带试听
- 🔒 **本地运行**：不登录、不上传，只请求 Open-Meteo 天气接口

## 运行

需要 Node.js 18+。

```bash
npm install          # 首次安装 Electron（国内可用镜像，见下）
npm start            # 启动桌宠
npm test             # 无界面测试：存储 / 角色 / 天气码映射
```

镜像加速（国内网络）：

```bash
# PowerShell
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
npm install --registry=https://registry.npmmirror.com
```

## 打包

```bash
npm run dist      # electron-builder portable，输出 dist/DeskPet-<version>-portable.exe
```

便携版无需安装，双击 exe 即可运行；数据默认写在 exe 同级 `desk-pet-data\`（可用 `DESKPET_DATA_DIR` 覆盖），整个文件夹可以搬走。

- exe 带图标与版本信息（ProductName / FileVersion / Copyright 等）。
- 未签名 exe 可能被 SmartScreen 提示「已保护你的电脑」：点「更多信息 → 仍要运行」，或对 exe 签名。
- 本机打包绕坑（32 位 NSIS mmap、火绒拦临时目录）见 [`M6-PACKAGING.md`](M6-PACKAGING.md)。

## 使用

| 操作 | 行为 |
|---|---|
| 左键单击角色 | 依次弹出天气 / 喝水 / 温馨语句，走完再点收起 |
| 按住拖动 | 任意摆位，松手保留位置 |
| 右键角色 | 菜单：设置、刷新天气、置顶切换、隐藏、打开数据目录、退出 |
| 双击角色 | 打开设置窗口 |
| 托盘图标 | 显示/隐藏，右键菜单同角色右键 |

设置窗口里可改名字、大小、模式、城市、喝水间隔、免打扰、气泡行为、音效，并导入角色图片。

## 配置

配置存在 `%APPDATA%\desk-pet\settings.json`（设置窗口改完即时保存）：

| 字段 | 说明 | 默认 |
|---|---|---|
| `name` | 显示名（气泡落款、托盘 tooltip） | `小芳桌宠` |
| `size` | 角色边长 px（120–360） | `220` |
| `mode` | `quiet` 不提醒 / `normal` / `chatty` | `normal` |
| `position` | `{x,y}` 窗口左上角，`null` 为右下角 | `null` |
| `alwaysOnTop` | 始终置顶 | `true` |
| `autostart` | 开机自启 | `false` |
| `sound.enabled` / `sound.volume` | 音效总开关 / 总音量 | `true` / `0.45` |
| `sound.events.<click\|bubble\|water>` | 每个事件的 `enabled` / `fragment` / `volume`（`null` = 跟随总音量） | 叮 / 啵 / 水滴 |
| `weather.lat` / `lon` / `city` | 天气坐标与城市名 | `null` |
| `weather.refreshMinutes` | 天气刷新间隔 | `15` |
| `water.intervalMinutes` | 喝水提醒间隔 | `60` |
| `water.quietFrom` / `quietTo` | 免打扰时段（小时，可跨零点） | `23` / `8` |
| `water.lastDrinkAt` / `water.today.cups` | 上次喝水 / 今日杯数 | — |
| `bubble.autoHideSeconds` | 气泡自动收起，`0` 不收起 | `20` |
| `bubble.cooldownMinutes` | 天气卡冷却 | `30` |
| `bubble.phrases` | 温馨语句（设置里每行一条） | 内置 6 条 |
| `roleId` | 当前角色 | `default` |

角色图片：建议 610×610、透明背景、主体脚底贴底边；导入时会自动缩放到最长边 610px。

数据目录：普通运行在 `%APPDATA%\desk-pet\`；便携版默认在 exe 同级 `desk-pet-data\`；均可用 `DESKPET_DATA_DIR` 覆盖。文件：`settings.json`、`roles.json`、`roles/*.png`、`weather-cache.json`、`sounds.json`、`sounds/*`。

## 开发

```
app/
├── main.js       Electron 主进程：窗口、托盘、IPC、天气调度、提醒定时器
├── preload.js    contextBridge 白名单 API
├── pet.html/css/js        宠物窗口（透明、无边框）
└── settings.html/css/js   设置窗口
lib/
├── store.js      配置/角色/缓存的原子读写（可脱离 Electron 测试）
└── weather.js    Open-Meteo 天气与城市搜索
tools/
├── smoke.js      无界面测试
└── make-assets.py 生成 icon/tray/ico
build/
└── icon.ico      Windows 多尺寸图标（make-assets.py 生成）
```

设计要点：

- **透明窗口只覆盖宠物本身**：气泡出现时窗口向上临时加高（`setBounds`），气泡收起再缩回，避免透明区域挡住桌面点击。
- **拖动用增量位移**：渲染进程发送 `dx/dy`，主进程 `setPosition` 并夹在工作区内。
- **角色图走自定义协议** `pet-role://`，渲染进程拿不到文件路径。
- 天气与定位都在主进程完成，渲染进程不直连第三方。

环境变量：

| 变量 | 用途 |
|---|---|
| `DESKPET_DATA_DIR` | 覆盖数据目录（便携版 / 测试 / `%APPDATA%` 不可写的环境） |
| `DESKPET_OPAQUE=1` | 关闭透明背景，排查渲染问题用 |
| `DESKPET_OPEN_SETTINGS=1` | 启动后直接打开设置窗口 |
| `DESKPET_OPEN_EDITOR=1` | 启动后直接打开气泡编辑器 |

## 后续

见 [PLAN.md](PLAN.md)；跨对话接手请看 [HANDOFF.md](HANDOFF.md)（现状、决策、已知坑、待办与开场白）。
当前 `0.2.0` 已有：角色、天气、喝水、气泡模块化编辑器、音效库、托盘、设置、置顶、自启、便携打包。待做：多显示器记忆、贴边吸附。

## License

MIT
