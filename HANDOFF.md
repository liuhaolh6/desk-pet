# 交接文档（HANDOFF）

> 给下一个对话的我自己 / 协作者：读完这份就能接着干，不用重新摸索。

## 1. 项目是什么

Windows **桌面宠物**应用（Electron），悬浮在桌面上。不是 DSH 插件。

- 仓库：<https://github.com/liuhaolh6/desk-pet>（public，main 分支）
- 本地目录：`D:\project\deskpet`
- 版本：`0.6.4`（M12 P0 + P1-1~P1-9 可行部分 + 无障碍审计 + 桌宠窗口屏闪/虚影/气泡位移修复 + 仓库工程化 + 体验升级：照片形象、24 条提示语、温柔文案、粉奶油配色、气泡布置简化 + 气泡点击收起/命中区跟随云朵/运行中不改窗口大小（修频闪）；未签名）
- 远端状态：`main` 与 15 个 tag 已推到 GitHub；CI（push/PR）绿；`v0.5.8` Release 由 CI 构建并附 `DeskPet-0.5.8-portable.exe` + `SHA256SUMS.txt`
- 早期那套「DSH 挂件版」实现已移出仓库，归档在 `D:\project\deskpet-dsh-plugin`（需要参考角色/气泡系统时可以翻）

## 2. 现在能用的功能（都真机验证过）

| 能力 | 状态 |
|---|---|
| 透明无边框窗口、始终置顶（可关）、跳过任务栏 | ✅ |
| 单击出卡：天气 → 喝水 → 温馨语句，再点收起 | ✅ |
| 气泡出现时窗口向上加高，收起缩回（不挡桌面点击） | ✅ |
| 悬停 ☰ 菜单；托盘菜单（桌宠双击/右键无响应） | ✅ |
| 角色导入 / 切换 / 删除（自定义 `pet-role://` 协议） | ✅ |
| 天气：Open-Meteo、城市搜索、磁盘缓存、断网降级 | ✅ |
| 喝水：间隔提醒、今日杯数、免打扰、隐藏时系统通知 | ✅ |
| 设置：名字、大小、置顶、自启、模式、城市、刷新、间隔、气泡、音效 | ✅ |
| 气泡模块化编辑器 / 音效库（M7/M8） | ✅ |
| M6 打包：portable exe（图标 / 版本信息 / 便携数据目录） | ✅ 当前产物 `dist/DeskPet-0.5.0-portable.exe`；启动已验证，托盘图标本机不显示（见 §5.13） |
| M11 照片抠图（离线 U2Net + 抠图窗口 + 回退） | ✅ 0.5.1 修复 alpha/映射/回退语义，开发版/解包版/portable 均 CDP 走通；`npm test` 42 项 |
| M12.2 抠图体验（蒙版视图 / 擦除恢复 / 旋转翻转） | ✅ 0.5.2，见 `M12.2-NOTES.md` |
| M12.3 主进程卸载 / 去色污 / 照片阴影 | ✅ 0.5.3，见 `M12.3-NOTES.md` |
| M12.4 无障碍基础 / token IPC / 仓库基线 | ✅ 0.5.4，见 `M12.4-NOTES.md` |
| M12.5 完整无障碍审计（可自动化部分） | ✅ 0.5.5，82 项 0 失败（含键盘-only 流程），见 `A11Y-AUDIT.md`；未做 NVDA/真实高对比度 |
| M12.6 桌宠点击/拖动流畅性（缩放虚影、settings 缓存） | ✅ 0.5.6，见 `PET-WINDOW-NOTES.md` §1；无过冲帧、拖动按帧合并 |
| M12.7 气泡加高不得移动桌宠（顶部 clamp / 下方气泡） | ✅ 0.5.7，见 `PET-WINDOW-NOTES.md` §3；桌宠屏幕矩形不变量 + `petPos` |
| M10 手感与视觉（Q 弹 / 思考气泡 / 悬停菜单 / 设置重构 / 内置字体） | ✅ 见第 12 节、`M10-NOTES.md`、`M10.1-NOTES.md`、`M10.2-NOTES.md` |
| `npm test`（41 项，存储 / 角色 / 天气码 / 气泡布局 / 音效 / 多显示器 / 抠图 alpha） | ✅ |

## 3. 关键决策（别推翻，除非有理由）

1. **Electron 而不是 tkinter**：需要透明悬浮 + 好看的卡片 UI；本机 npm 可用，Electron 走 npmmirror 能下。
2. **窗口只包住宠物**：气泡靠临时加高窗口实现，避免全屏透明层吞掉桌面点击。
3. **渲染进程不碰文件**：角色图走自定义协议，落盘全在主进程。
4. **仓库不放个人照片**：默认角色是 `tools/make-default.py` 生成的占位图。
5. **数据目录可覆盖**：`DESKPET_DATA_DIR`，因为受限环境写不了 `%APPDATA%`。
6. **打包用 portable，不做安装器**：`electron-builder` 的 `portable` target，双击即用；数据优先写在 exe 同级 `desk-pet-data/`，整个文件夹可搬走。
7. **0.4.0 = M10 发布版本**：M6 的 portable 构建配置保留；图标在 `build/icon.ico`，exe 版本信息由 `package.json` 的 `version` / `author` / `description` 生成。
8. **字体随包内置**：Noto Sans SC 子集 → `DeskPet Sans`（OFL）。不要改回纯系统字体，否则跨机排版差异大。

## 4. 待办（按建议顺序）

| 里程碑 | 内容 | 备注 |
|---|---|---|
| **M6 打包** | electron-builder 出 portable exe，图标、版本信息、可选开机自启 | ✅ 已完成，产物 `dist/DeskPet-0.2.0-portable.exe`；记录见 `M6-PACKAGING.md` |
| **M7 气泡编辑器** | 多行排版、逐模块样式、拖拽排序、模块库 | ✅ 已完成，见第 8 节 |
| **M8 音效库** | 自定义片段、音量、试听 | ✅ 已完成，见第 9 节 |
| **M9 多显示器** | 记住每块屏的位置、贴边吸附 | ✅ 已完成，见第 10 节 |
| **M10 手感与视觉** | Q 弹 / 思考气泡 / 悬停菜单 / 设置重构 / 字体排版 | ✅ 已完成，见第 12 节 |
| **M11 照片抠图** | 离线 U2Net 生成角色 | ✅ 已完成，见第 13 节、`M11-NOTES.md`；质量缺陷由 M12 修复 |
| **M12 抠图质量修复** | alpha 合成/映射、回退语义、诊断与评测 | ✅ 0.5.1 P0；0.5.2 P1-1~P1-4；0.5.3 P1-5~P1-7；0.5.4 P1-8/9 可行部分 + token IPC；10 张 golden set 未完成 |
| **M15 交互与边界** | 主进程命中轮询 / 气泡永在下方之上 / 城市搜索反馈 | ✅ 0.6.2 |
| **M16 气泡手感** | 点气泡收起 / 空闲缩回桌宠 / 命中区跟随云朵 / 天气缺城市说明 | ✅ 0.6.3，见 `M16-NOTES.md` |
| **M14 气泡契约** | 固定比例框 / 实测居中 / 固定预留 / 喝水卡片 / 编辑器精简 | ✅ 0.6.1，见 `M14-NOTES.md` |
| **M13 体验升级** | 形象/文案/配色/天气/气泡布置 | ✅ 0.6.0：照片做图标与默认形象、24 条提示语、四窗口温柔通俗文案、粉奶油配色、天气新增体感/风/紫外线/日出日落/明天/未来 6 小时/贴心提醒、气泡一键预设 + 分组选单 + 折叠样式 |
| **发布签名** | SignPath Foundation 免费 OSS 签名 | ⬜ 工作流/申请材料已就绪，待申请与配置 secrets；当前 exe 仍未签名 |
| 小改进 | 天气卡文案换行（现在「80% 湿度」可能断行）、托盘的「暂停提醒」开关 | 低优先 |

## 5. 已知坑（踩过的，别再踩）

1. **`%APPDATA%` 写入 EPERM**：在本机 DSH 会话里启动的子进程写不了 `%APPDATA%`，会导致单实例锁失败并退出。
   → 测试时加 `DESKPET_DATA_DIR=D:\project\deskpet\.userdata`；代码已做回退，正常桌面启动不受影响。
2. **不要调用 `app.getPath('userData')` 做探测**：在受限环境下会**原生崩溃**（不是抛异常）。当前代码用 `process.env.APPDATA` 拼路径。
3. **需要 `--no-sandbox`**：本机从 DSH 启动 Electron 时必须加，否则崩在启动；正常桌面双击不需要。
4. **Electron 二进制没自动下载**：`npm install` 只装壳，需在 `node_modules/electron` 里手动 `node install.js`，并设 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`。
5. **前端脚本顶部不能再加 `'use strict'`**：文件开头 `'use strict'` 紧跟 `(function(){...})()` 会被解析成调用字符串，整个渲染进程报 `"use strict" is not a function`。
6. **截图抓不到右下角的宠物窗口**：本机屏幕捕获对那个区域的分层窗口不生效（原因未查明，疑似覆盖层）。要验证渲染请用 `webContents.capturePage()`，或把宠物拖到屏幕左上再截。
7. **打包版不带 `--no-sandbox` 会静默退出**（exit=-2147483645/0x80000003，连 app.log 都不写）：本机安全策略下 Chromium 沙箱起不来。
   双击/快捷方式必须带该参数（`tools/make-shortcut.ps1` 已默认带上）；开机自启也已在代码里带上。
8. **双击会被拆成两次单击**：已加 240ms 去抖，别再改回去。
9. **32 位 NSIS 编译大包会崩**：数据块超过约 16 MB 时 `makensis` 报
   `Internal compiler error #12345: error creating mmap the size of ...`。
   3.0.4.1 / 1.2.1（3.12）的 32 位编译器都会中招。本机改用 64 位 NSIS 编译器包装：
   `.tools/nsis-custom/makensis.cmd` + `ELECTRON_BUILDER_NSIS_DIR`，详见 `M6-PACKAGING.md` §3.1。
10. **未签名 exe 会被 SmartScreen / 安全软件拦**：双击出现「Windows 已保护你的电脑」；
   本机 Lenovo Anti-Virus（火绒引擎）还会把未签名进程写 `%LOCALAPPDATA%\Temp` 拦成 `ACCESS_DENIED`，
   NSIS portable 报 `Error writing temporary file. Make sure your temp folder is valid.`
   → 签名/加白名单；测试时把 `TEMP`/`TMP` 指到可写目录（如 `D:\project\deskpet\.tmp-runtime`），
   并用普通用户令牌启动（计划任务/Explorer）。
11. **`ELECTRON_RUN_AS_NODE=1`**：DSH 会话环境自带；直接启动打包/开发 Electron 会变成 Node 模式
    （`bad option: --no-sandbox`）。测试前 `Remove-Item Env:ELECTRON_RUN_AS_NODE` 或设空。
12. **从 DSH 前台启动 GUI 会挂住工具调用**：工具会等整棵进程树。用计划任务/WMI/Explorer 分离启动，
    不要在前台直接跑桌宠。
13. **托盘图标在本机不显示**：`Tray` 对象和菜单创建成功（日志 `tray created empty=false menu=...`），
    但 Windows 11 通知区和溢出区都看不到图标，`tray.getBounds()` 为 `0,0,0,0`。
    宠物窗口、右键菜单、设置窗口正常。疑似 Win11 26200 + 安全软件；待签名或干净机器复验，
    M6 的「托盘可用」只验证到对象/菜单创建。
14. **气泡渲染不能回写设置**（M7 后引入、已修）：天气卡曾在每次重绘时写 `lastWeatherShownAt`，
    导致「主进程广播设置 → 前端重绘 → 再写」死循环：音效连响、天气被反复请求。
    现在每次展示只写一次，重绘传 `playSound:false`，天气刷新限流 60s。
15. **拖动不能依赖气泡预留高度**（已修）：窗口顶部为气泡留了空间，若把「角色顶」当「窗口顶」摆，
    Windows 会把窗口夹回屏内，角色每拖一次下沉一截直至出屏。
    现在按下即收起气泡，位置用「窗口底 − 角色尺寸」反推，并抑制拖动后补发的 click。
16. **替换音效时删干净旧 `beep()`**（已修）：M8 改成 `playSound()` 时漏了一处，每次弹卡抛
    `ReferenceError: beep is not defined`，气泡渲染随之中断。
17. **气泡/菜单先预留窗口高度再显示**：先 `setBubble` 加高窗口，延迟 50ms 再显示；隐藏后延迟 200ms 缩回。
    顺序反过来，云朵/菜单顶部会被窗口裁掉；立即缩回则会出现透明残影。
18. **单击队列别在 pointerdown 收起气泡**：只在真正开始拖动（位移 >4px）时 `hideBubble()`。
    旧实现每次按下都收起，导致第二下点击永远回到第一张卡。
19. **镜像用宠物矩形而不是窗口矩形**：窗口有 `WIN_PAD=54`，窗口右缘本来就在屏外；用窗口矩形会
    在默认右下角位置误翻转。用 `placement.petRectOf` + 20px 阈值。
20. **字体子集**：`tools/make-font.py` 生成 `DeskPetSans-{Regular,Semibold}.woff2`，OFL/NOTICE 随包；
    不要提交 17MB 源字体，也不要依赖系统字体保证排版。
21. **桌宠双击/右键已移除**：设置只从悬停 ☰ 或托盘打开；不要再给 `pet` 加 `dblclick` / `contextmenu` 监听。
    单击仍走 240ms 去抖，双击只推进一张卡。
22. **气泡/菜单动效已对齐 whale-widget**：主体 .26s、大点 .13s、小点 0s、文字 .36s；关闭 .1/.2/.3s；
    气泡隐藏后 **540ms** 再缩窗口，改回 200ms 会把回收动画裁掉。
23. **气泡外观用 whale classic SVG 框**：`pet.html` 里的 `M 827 248 ...` 路径 + 两个 ellipse；
    SVG 做了水平 1.35 拉伸与重新居中、内容 padding `6 24 54`，否则多行中文会超出椭圆。
    改 viewBox/比例前先跑 `cdp-fullshot` 确认「今日 — · 降水 —」仍在白框内。
24. **不要声称当前 exe 已签名**：`0.5.0` 仍是未签名构建；签名走 SignPath Foundation 免费 OSS 路线，
    工作流只在配置了 `SIGNPATH_*` 变量后才运行。自签名只能本机测试，不解决用户端 SmartScreen。
    详见 `SIGNING.md`。
25. **参考目录的 58MB 模型是截断的**：`u2net_human_seg.onnx` 图长度字段约 176MB，文件只有 58MB，
    ONNX Runtime 报 `Protobuf parsing failed`。现在仓库里是完整模型静态量化后的 **44,253,573 字节**版本。
26. **ONNX 原生依赖别用动态量化**：动态量化生成的 `ConvInteger` 在当前 CPU EP 无实现。
    要量化就做静态 QOperator QDQ/QOperator，只量化 Conv，并先用真实照片校准；验证能 `InferenceSession.create` 再打包。
27. **模型不能放进 asar**：`onnxruntime-node` 需要真实文件路径。模型走 `extraResources/models`，
    原生模块 `asarUnpack`；只保留 win32 x64 二进制，否则 portable 会多出 180MB。
28. **抠图失败必须回退，但不能假装成功**（0.5.1 起）：`cutout:run` 失败返回 `mode:'fallback'` + `fallbackDataUrl`；
    抠图窗口显示“未抠图（整图）”，保存必须二次确认，`cutout:save` 没有 `confirmFallback:true` 会拒绝；
    角色条目写 `cutout:false`，图库显示“未抠图”徽标。别再改回“自动放开保存”。
29. **alpha 必须走自有像素管线，不要交给 nativeImage 缩放**（M12 已修，别回退）：`getBitmap()/createFromBitmap()` 是**预乘 BGRA**；
    对含透明像素的 nativeImage 调 `resize()` 会把 alpha=0 雾化成半透明。现在 `lib/cutout-pixels.js` 做预乘采样/合成，
    `lib/png.js` 直写 straight RGBA PNG；`lib/cutout.js` 只在入口用 nativeImage 解码一次。
30. **不要在抠图后处理里恢复 `mask²` / `a<0.45` / 按图 min-max**：这就是“背景 45%–91% 半透明”的来源；
    现在是绝对双阈值 + 8 邻接形态学 + 输出级 2px 羽化。阈值/羽化改动必须跑 `tools/cutout-diag.js --assert`。
31. **DSH 受限沙箱下 Electron 会被环境杀掉**：`workspace-write` 会话里启动 Electron 约 1s 内以
    `0x80000003`（STATUS_BREAKPOINT，Mojo 命名管道拒绝访问）退出，旧版同样；切到 danger-full-access 后可正常运行。
    测试前清 `ELECTRON_RUN_AS_NODE`、加 `--no-sandbox`；模型验证也可用“Electron 只解码 → 纯 Node 跑核心”的方式。
32. **诊断入口**：`node tools/cutout-diag.js --fake <img> --mask <gt> --assert`（合成，无模型）、`--png<角色.png>`（分析既有 PNG）、
    `--input <png>`（纯 Node 跑真模型）、`--decode`（Electron 把 JPEG 转 straight RGBA PNG）。
    每次抠图的 trace 写在 `<data>/cutout-trace.jsonl`（>256KB 轮转）。
33. **coverage 双侧门禁**：`<0.02 → NO_PERSON`、`>0.90 → OVER_SEGMENTED`，都会走回退并要求二次确认；
    不要再“自动放开保存”，也不要只看 31/41/42 项测试全绿当抠图质量证明。
34. **squash vs letterbox 不是主因**（0.5.2 实测）：修好 alpha/映射后，两种预处理在可用样例上的
    coverage/背景/主体/边缘差异 <1%。默认 letterbox 只是为了保持长宽比；不要再拿单张照片的
    “76% vs 43%”当结论，要改预处理先补 10 张 golden set。`--preprocess squash` 可随时回退。
35. **手动擦除必须存“图像空间”蒙版**：擦除层是 610×610 alpha 蒙版，绘制时用与图片相同的
    translate/rotate/scale 做 `destination-in`；指针坐标必须反旋转/反翻转再映射到图像像素。
    如果按画布坐标直接擦，缩放/旋转后笔画会漂移。
36. **抠图窗口变高后要保留内部滚动**：窗口 780×760，`.side { overflow-y:auto }`；删掉会在
    1366×768 等小屏把“修补边缘”卡片裁掉。
37. **抠图重活必须在 utilityProcess 里**（0.5.3）：推理 + compose + PNG 编码在主进程会卡 600ms/60ms；
    现在 `lib/cutout-worker.js` 走 `utilityProcess`，主进程只做解码（~25ms）。改动时注意：
    - `postMessage` 的 transfer list **只接受 MessagePort**，ArrayBuffer 只能结构化克隆（复制，别传 `[payload]`）；
    - 打包必须 `asarUnpack` `lib/**` 与 `onnxruntime-common`，否则 worker 从 unpacked 目录解析不到依赖；
    - worker 任意失败都要能退回进程内（`DESKPET_CUTOUT_INLINE=1` 可强制进程内）。
38. **`app/pet.js` 要监听 `roles:changed`**：否则保存/导入新角色后 `roleId` 变了、角色列表还是旧的，
    桌宠回退默认图直到重启（0.5.3 修复，别删这个订阅）。
39. **抠图原图不要塞进渲染层**（0.5.4）：`cutout:pick`/`cutout:load` 只返回 token + ≤1200px 预览，
    `cutout:run(payload.token)` 用 token 取回原图；25MB 原图的 base64 不再往返。`cutout:run` 仍兼容
    `{ dataUrl }`，但新代码别再用它传整图。token 存在 `cutoutInputs`（上限 3，窗口关闭清空）。
40. **仓库基线**：`.gitattributes` 只做二进制标记、**不要加 `text=auto`**（会全仓库重写换行）；
    模型不用 LFS、不重写历史，理由与量化约束见 `MODEL-ASSETS.md`；CI = `npm run check` + `npm test`
    + 合成图 `--fake --assert` + 真实模型正/负例。推送与 tag 仍需用户确认。
41. **透明窗口不要动画 `filter`，也不要频繁 resize**（0.5.5 屏闪修复，见 `PET-WINDOW-NOTES.md`）：
    - 触摸按压会补发 `pointerenter`（`pointerType === 'touch'`），**别让它触发 hover**——hover 里的
      `filter: drop-shadow(...) brightness(1.02)` 在透明窗口上逐帧重合成，按下的瞬间就会闪；
    - `#pet` 的 transition **只留 `transform`**，别加 `filter`；
    - `applyBubbleHeight()` 在气泡可见期间**只增不减**（隐藏时才缩回），否则卡片高度一变就 resize 一次；
    - 改尺寸前重新 `setBackgroundColor('#00000000')`；`tools/smoke.js` 有静态断言，别删。
42. **无障碍基线别回退**（0.5.5 审计，见 `A11Y-AUDIT.md`）：
    - `--muted` 必须对 `#eef2fa` ≥4.5:1（当前 `#5d6a86`）；次要文字不要再用 `#7d89a5`/`#8890a8` 这类浅色；
    - 滑杆、复选框 label、图标按钮都要 ≥24×24（2.5.8）；`input[type=range] { height: 24px }` 不要删；
    - 四个窗口 CSS 都要有 `prefers-reduced-motion` 全量规则；编辑器要保留 720px 以下的单列回流；
    - 桌宠 `☰` 菜单要能用键盘聚焦显示（`.pet-wrap:focus-within .menu-btn`）；
    - 动态创建的音效控件要有 `aria-label`；改完跑 `node tools/check-a11y.js` 与
      `node tools/a11y-audit.js --port <调试端口> --flow`（82 项应全过）。
43. **缩放动画不要用会过冲的缓动，也不要让被缩放的精灵带 `filter`**（0.5.6 虚影修复，见
    `PET-WINDOW-NOTES.md` §1）：
    - `#pet` 只许 `transition: transform 0.16s var(--ease-out)`；`--ease-spring`
      （`cubic-bezier(0.34,1.3,0.6,1)`）会过冲到 1.3，出现 1.034 / 0.877 这类**越界帧**＝肉眼虚影；
    - `drop-shadow` 放在未被缩放的 `.pet-flip` 上；`#pet` 自身不要 `filter`（同时带
      `will-change: transform` 会复用旧光栅，缩放时糊/拖影）；
    - 按压保持 ≥110ms，让单调过渡走完再回弹，别在动画中途反向（会每帧跳 4%～5%）；
    - 拖动时 `transition: none` 跟手，IPC 用 `requestAnimationFrame` 按帧合并；
    - **`store.readSettings()` 已有缓存**（拖动每帧都要读，无缓存时 175µs/次），别退回每次读盘；
    - `tools/smoke.js` 有静态断言，改完跑 `npm test`。
44. **气泡加高/缩回时，桌宠的屏幕矩形绝对不许变**（0.5.7，见 `PET-WINDOW-NOTES.md` §3）：
    - 旧代码 `y = Math.max(workArea.y, bottom - nextH)` 会把窗口顶边按在工作区上沿，而桌宠是
      `bottom: 0` 锚定窗口底部的 → 整只桌宠滑走（实测 110px，且不回来）；
    - 现在按上下两侧可用空间分配：上方够就向上加高，不够就**向下加高并把气泡画在桌宠下方**
      （`side='below'`，渲染层用 `body[data-bubble-side]` + `--bubble-room` 定位，鲸鱼尾巴隐藏）；
    - **主进程用 `petPos` 显式保存桌宠屏幕坐标**（`petScreenRect()` / `windowBoundsForPet()`），
      不要从窗口几何反推（透明无边框窗口的外框高度与 `getBounds()` 差几像素，拖动后首点会偏 10px）；
    - `pet:bubble` 必须是 `ipcMain.handle` 并回传 `{reserve, side}`，`preload` 用 `invoke`；
    - 任何调整窗口尺寸的新代码都要保持「桌宠 top/bottom 不动」；`npm test` 有断言。

## 6. 快速开始

```powershell
cd D:\project\deskpet
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
npm install
# 若 electron.exe 不存在（postinstall 被跳过）：
cd node_modules\electron; node install.js; cd ..\..

# 本机受限环境：
$env:DESKPET_DATA_DIR='D:\project\deskpet\.userdata'
.\node_modules\electron\dist\electron.exe . --no-sandbox

# 正常桌面：npm start
npm test

# 打包 portable（普通桌面环境）
npm run dist
# 本机（32 位 NSIS 限制）：见 M6-PACKAGING.md §3，用 64 位 NSIS 包装
```

- 打包：`npm run dist` → `dist/DeskPet-<version>-portable.exe`；本机绕坑见 `M6-PACKAGING.md`。

- 数据：`settings.json`、`roles.json`、`roles/*.png`、`weather-cache.json`
- 环境变量：`DESKPET_DATA_DIR`（数据目录）、`DESKPET_OPAQUE=1`（关透明，排查渲染）、`DESKPET_OPEN_SETTINGS=1`（启动即开设置）

## 7. 文件地图

| 路径 | 作用 |
|---|---|
| `app/main.js` | 窗口、托盘、IPC、天气调度、提醒定时器、启动日志（`app.log`） |
| `app/preload.js` | contextBridge 白名单 API（`window.deskPet`） |
| `app/pet.html/css/js` | 宠物窗口：精灵、思考气泡、触摸动效、悬停菜单、点击队列、拖拽 |
| `app/settings.html/css/js` | 设置窗口（侧栏分类 / 卡片 / 即时保存） |
| `app/tokens.css` | 设计 token、字号/间距/圆角、@font-face |
| `assets/fonts/` | DeskPet Sans 子集 + OFL/NOTICE |
| `tools/make-font.py` | 生成字体子集 |
| `lib/store.js` | 配置/角色/缓存的原子读写（可脱离 Electron 测试） |
| `lib/weather.js` | Open-Meteo 天气与城市搜索 |
| `tools/smoke.js` | `npm test` |
| `tools/make-assets.py` | 生成 icon/tray/ico/default |
| `build/icon.ico` | Windows 多尺寸图标（make-assets.py 生成） |
| `M6-PACKAGING.md` | M6 portable 打包记录 / 验证 / 本机限制 |
| `M10-NOTES.md` | M10 记录 / 验证 / 截图 |
| `M10.1-NOTES.md` | 0.4.1 交互收尾：去双击/右键、whale 气泡与菜单样式 |
| `M10.2-NOTES.md` | 0.4.2 气泡外观：whale classic SVG 框 + 适配 |
| `M11-NOTES.md` | 0.5.0 照片抠图：模型/量化/窗口/回退/验证（质量结论已由 M12 修正） |
| `M12-PLAN.md` | M12 抠图质量修复计划书（P0/P1/P2、验收、风险） |
| `M12-HANDOFF.md` | M12 抠图链路交接（代码地图、坑、复现、下一步） |
| `lib/cutout.js` | 离线 U2Net + 纯 Node 核心 `cutoutImageRGBA()`；Electron 入口只解码 |
| `lib/cutout-math.js` | 绝对双阈值/滞回、形态学、连通域、填洞、包围盒、适配纯函数 |
| `lib/cutout-pixels.js` | 预乘 BGRA↔RGBA、面积缩放、蒙版合成、羽化、alpha 分带 |
| `lib/png.js` | 8-bit RGBA PNG 编解码（zlib），保证 straight alpha |
| `tools/cutout-diag.js` | alpha 分带/背景/主体/边缘/耗时诊断与 `--assert` |
| `tools/make-cutout-fixtures.js` | 生成可公开的合成 fixture（人像+GT、负例、alpha 色块） |
| `tools/fixtures/` | 合成测试图（不含个人照片） |
| `M12-NOTES.md` | 0.5.1 抠图修复实测、未覆盖项、回滚 |
| `M12.2-NOTES.md` | 0.5.2 蒙版视图/擦除/旋转与 squash-vs-letterbox A/B |
| `M12.3-NOTES.md` | 0.5.3 utilityProcess 卸载、边缘去色污、照片角色阴影 |
| `M12.4-NOTES.md` | 0.5.4 无障碍基础、token IPC、CI/模型资产基线 |
| `MODEL-ASSETS.md` | 模型/二进制资产决策（不用 LFS、不重写历史、量化约束） |
| `.gitattributes` | 二进制标记（不含 `text=auto`） |
| `lib/cutout-worker.js` | utilityProcess 里的抠图执行体（P1-5） |
| `PET-WINDOW-NOTES.md` | 0.5.5 透明窗口屏闪：原因、证据、修复与验证 |
| `tools/check-a11y.js` | 静态无障碍回归（结构断言，非 WCAG 审计；CI 会跑） |
| `tools/a11y-audit.js` | CDP 无障碍审计 76 项（AX 名称/对比度/目标尺寸/焦点/回流/forced-colors/reduced-motion） |
| `tools/a11y-keyboard.js` | 键盘-only 抠图流程 6 项（WCAG 2.1.1；与上面合计 82） |
| `A11Y-AUDIT.md` | 0.5.5 无障碍审计报告（结论、方法、修复、未验证项） |
| `.github/workflows/ci.yml` | `npm ci` + 语法 + a11y 静态检查 + `npm test` + 合成图/真实模型断言（GitHub Actions 已实跑通过） |
| `.github/workflows/release.yml` | tag 触发：64 位 NSIS → 检查 → 构建 portable → 校验和 → 创建 Release；失败自动开 Issue，成功自动关闭 |
| `CHANGELOG.md` / `CONTRIBUTING.md` / `SECURITY.md` | 版本记录、贡献指南（含发布流程与 3-tag 限制）、安全策略 |
| `app/cutout.html/css/js` | 照片选择、预览、拖动缩放、保存/回退窗口 |
| `assets/models/u2net_human_seg.onnx` | 量化后 44MB 离线人像分割模型 |
| `SIGNING.md` | SignPath Foundation 免费 OSS 签名申请 / CI / 验签 |
| `THIRD-PARTY-NOTICES.md` | whale-widget / Noto Sans / Electron 许可与归属 |
| `.github/workflows/sign-release.yml` | 构建 + SignPath 签名工作流（配置变量前休眠） |
| `tools/verify-signature.ps1` | Authenticode 签名/时间戳校验 |

## 8. 最近变更（M7 气泡模块化编辑器）

- 新增 `app/bubble-model.js`：卡片 → 行 → 模块的数据模型，纯函数、可被 Node 测试（`tools/smoke.js` 已覆盖 6 项）。
  模块类型：固定文字、随机语句、名字、天气（图标/城市/温度/描述/高低温/降水/湿度/更新时间/离线提示）、今日杯数、下次提醒、时间、日期。
- 新增 `app/editor.html/css/js`：气泡编辑器窗口——卡片页签、行/模块编辑、拖拽排序、字号/加粗/斜体/文字色/底色、模块库、实时预览、卡片顺序（即点击顺序）。
- `app/pet.js` 改为按 `settings.bubble.layout` 渲染；`app/pet.html` 引入模型脚本。
- 入口：托盘菜单 / 角色右键菜单「编辑气泡…」，或设置窗口里的「编辑气泡…」按钮。
- 窗口横向加宽 `WIN_PAD=54`，角色水平居中，气泡可见宽度变大（以前被 220px 窗口掐得很碎）。
- 新增 `DESKPET_OPEN_EDITOR=1` 便于调试时直接打开编辑器。

注意：气泡布局存在 `settings.bubble.layout`；不存则用默认布局；`normalizeLayout` 对损坏数据 fail-soft 回默认，不会让挂件白屏。

## 9. 最近变更（M8 音效库）

- 新增 `app/sound-model.js`：事件（click/bubble/water）× 片段（`preset:*` 内置合成 / `file:<id>` 导入）模型；
  `eventVolume()` 实现「单事件音量 null = 跟随总音量」，总开关或事件关闭则返回 0。
- 新增 `pet-sound://sound/<id>` 自定义协议与 `sounds:list/import/delete` IPC；片段落盘在 `<data>/sounds/<id>.<ext>`，索引 `sounds.json`。
- 设置窗口新增音效区：总开关/总音量 + 每事件一行（开关、片段下拉、音量、跟随、试听）+ 片段库导入/删除。
  删除被引用的片段时，主进程自动把引用回退到 `preset:ding`。
- 宠物侧：点击角色 / 气泡出现 / 喝水提醒三个时机分别发声，旧的固定 beep 已删除。
- `tools/smoke.js` 扩到 **19 项**（新增音效默认值、归一化边界、音量回退、片段标签、片段增删、深合并）。

注意：内置音色是 WebAudio 合成的，仓库不带音频二进制；真实发声无法在无音频设备的会话里自动验证，目前只验证了代码路径与控制台无报错。

## 10. 最近变更（M9 多显示器与吸附）

- 新增 `lib/placement.js`（纯函数，可测）：显示器归一化、归属判定（交集优先、中心距离兜底）、
  `clampPet`（夹到工作区）、`snapPet`（四边磁吸 + 阈值）、`resolveSaved`（启动还原）。
- 位置改为 `{ x, y, displayId }`；启动时优先按 displayId 还原，显示器不存在则按坐标重新归属，
  都找不到则夹回最近屏幕；日志会打 `position clamped to display=`。
- 拖动时实时吸附（`settings.snap.enabled/gap`，默认 18px，0 = 关闭），拖动结束后记录所属显示器。
- 监听 `display-added / display-removed / display-metrics-changed`，自动把宠物夹回可见区域。
- 设置窗口「外观」新增：贴边吸附开关 + 吸附距离。
- `tools/smoke.js` 扩到 **26 项**（新增 7 项：无位置默认、记住显示器、拔掉后重归属、离屏夹回、小于屏幕、四边吸附阈值、归属判定）。

验证：手动把 `position` 写成 `{x:5000,y:4000,displayId:"999"}` 启动，日志出现 `position clamped to display=...`，
窗口落在主屏右下角。

## 11. 桌面快捷方式（v0.3.0）

- 版本号升到 `0.3.0`（含 M7 气泡编辑器 / M8 音效库 / M9 多显示器），因为之前的 portable exe 停在 0.2.0。
- 新增 `npm run dist:dir`（electron-builder `dir` 目标）与 `npm run shortcut`（`tools/make-shortcut.ps1`）。
- 快捷方式指向 **解包版** `dist\win-unpacked\DeskPet.exe`，而不是 portable：
  portable 会解压到 `%TEMP%`，本机火绒会拦未签名进程写 TEMP（见第 5 节第 2 条）；
  解包版直接运行，避开这一步。
- 实际建成的快捷方式：`C:\Users\刘浩\Desktop\小芳桌宠.lnk`（图标取 exe 自身）。
- 打包版已验证启动：4 个进程、窗口可见置顶、托盘创建成功、菜单含「编辑气泡…」。

注意：未签名 exe 首次双击仍会碰到 SmartScreen（需“更多信息 → 仍要运行”）；可以从 `dist\win-unpacked` 直接重建快捷方式，不必重新打包。

## 12. 最近变更（M10 手感与视觉包，0.4.1）

- 交互：按压 Q 弹 / 松手回弹 / 悬停微放大 / 拖动倾斜 / 贴边镜像；`pet.css` 用 CSS 变量组合 transform，`pet.js` 做手势仲裁（240ms 双击去抖、600ms 拖动抑制、36ms 按下帧）。
- 思考气泡：云朵感圆角 + 两个错落思考点，0/130/260ms 分段入场；`measureBubble` +30，先预留窗口高度再显示，隐藏后延迟 200ms 缩回。
- 悬停菜单：☰ 150ms 淡入，自绘 5 项菜单（设置 / 编辑气泡 / 刷新天气 / 隐藏 / 退出），复用 `pet:bubble` 临时加高窗口；Esc / 点外部 / blur 关闭。点角色本体仍只走卡片队列。
- 设置：左侧 7 类导航 + 右侧卡片 + 字段说明 + 角色图库 + 响应式音效行；保持即时保存；`settings.js` 增加 `selectPanel`。
- 字体：`DeskPet Sans`（Noto Sans SC 子集，OFL，约 2.1MB），`tokens.css` 统一 token；编辑器也接入。
- 修复：点击队列被 pointerdown 重置、默认位置误镜像、气泡/菜单高度时序。
- 验证：`npm test` 26 项；CDP 测悬停/按压/队列/菜单/120–360px/镜像/全部设置面板无横向溢出；打包版字体 `document.fonts.check` 通过、控制台无 error。截图在 `docs/m10/`，详情 `M10-NOTES.md`。
- **0.4.1 收尾**：移除桌宠双击/右键（设置只走悬停 ☰ / 托盘）；气泡文字色/描边/入场时序与菜单按钮/面板参数对齐 whale-widget；气泡隐藏后 540ms 再缩窗口。详见 `M10.1-NOTES.md`。
- **0.4.2 外观**：气泡换成 whale classic SVG 框（路径 + 双 ellipse），SVG 水平拉伸 1.35 并重新居中、内容 padding `6 24 54`，多行中文不裁切；截图 `docs/m10/pet-bubble.png`。详见 `M10.2-NOTES.md`。
- **签名脚手架**：选定 SignPath Foundation 免费 OSS 路线；新增 `.github/workflows/sign-release.yml`、`SIGNING.md`、`tools/verify-signature.ps1` 和 `npm run verify:signature`。当前 `0.5.0` 仍未签名，审核通过后由 CI 签。

## 13. 最近变更（M11 照片抠图，0.5.0）

- 新增 `assets/models/u2net_human_seg.onnx`：完整 human seg 模型静态量化（44MB），`lib/cutout.js` 用 `onnxruntime-node` + `nativeImage` 做 320 输入、蒙版归一化/最大连通域/alpha 清理/胸像裁切/610 画布合成。
- 新增独立 `cutout.html/css/js` 窗口：选择/拖入照片 → 开始抠图 → 棋盘格预览 → 拖动/滚轮/缩放滑杆 → 保存为角色；支持无人像/模型失败自动回退“仅缩放导入”，也有手动回退按钮。
- 设置 → 角色 → “从照片生成角色”已启用；保存后写 `store.addRole`、切换 `roleId`，通过 `roles:changed` 刷新设置里的角色图库。
- 打包：模型走 `extraResources/models`（不能放 asar）；`onnxruntime-node` 走 `asarUnpack`，排除 darwin/linux/win32-arm64，portable 153MB。
- 验证：`npm test` 31 项；开发版/打包版 CDP 都完成“拖入→抠图→保存角色”，无人像图片回退成功，控制台无 error。详见 `M11-NOTES.md`。

注意：复杂背景/多人/发丝可能有残留；当前是自动胸像裁切，没有手动橡皮擦。**2026-10-20 复盘确认该描述低估了缺陷**：保存 PNG 有大片半透明背景，且回退可保存整图；质量修复计划见 `M12-PLAN.md` / `M12-HANDOFF.md`。

**M12 复盘结论**：用户所说“只是把背景变淡”是保存 PNG 的真实 alpha 问题，不是棋盘格视觉。已证实两条：① straight-alpha + `nativeImage` 预乘解释 + `resize` 把透明区雾化；② `mask² + a<0.45` 把背景压成 45%–91% 半透明。另有回退整图可直接保存、无角色标记。M12 先修这些，再对预处理 squash/letterbox 做 A/B；换模型放 P2。

**M12 结果（0.5.1）**：P0-1~P0-8 已实施；同一张本地照片的远背景平均 alpha 23.07→0、非边缘半透明 8.25%→0%、边缘 7.67px→2.23px；`npm test` 41 项；开发版与解包版 GUI（CDP）均走通“拖入→抠图→保存”和“负例→未抠图（整图）→二次确认保存”，角色库显示“未抠图”。10 张 golden set 与 G5 人工核验仍未做，详见 `M12-NOTES.md` §5。

**M12.2 结果（0.5.2）**：新增结果/原图/蒙版三态、图像空间擦除/恢复/撤销 3 步、旋转/翻转；squash vs letterbox A/B 差异 <1%（默认 letterbox 仅保持长宽比）；`npm test` 42 项。

**M12.3 结果（0.5.3）**：推理/合成/编码移入 utilityProcess（抠图中主进程 IPC 往返 max 7ms，进程内对照 644ms）；边缘去色污；照片角色阴影降级；修复保存新角色后桌宠不刷新；`npm test` 43 项。

**M12.4 结果（0.5.4）**：token IPC（原图不再进渲染层）、画布 `aria-live` 替代文本与 `Q/W/F` 键盘构图、进出修补的焦点管理；`.gitattributes`/`MODEL-ASSETS.md`/`npm run check`/CI 真实模型正负例。推送与 tag 未做，详见 `M12.4-NOTES.md`。

**M12.5 结果（0.5.5）**：CDP 无障碍审计 82 项全过（4 窗口 + 设置 7 面板 + 编辑器标签页 + 键盘-only 抠图流程）；修了对比度令牌、气泡默认色、20px 高控件、无名音效控件、reduced-motion 覆盖、编辑器 320px 回流、桌宠菜单键盘可达；`tools/check-a11y.js` 扩到 30+ 项静态回归。未做 NVDA/VoiceOver 与真实高对比度主题，详见 `A11Y-AUDIT.md`。

## 14. 新对话开场白（直接粘贴）

> 继续 `D:\project\deskpet` 的桌面宠物项目，先读 `HANDOFF.md`、`A11Y-AUDIT.md`、`PET-WINDOW-NOTES.md`、`M12.4-NOTES.md`、`M12-PLAN.md`。
> 0.5.4 已完成 M12 P0 + P1-1~P1-9 的可行部分（蒙版/擦除/旋转、utilityProcess、去色污、阴影、token IPC、基础无障碍、CI/模型资产基线）；`npm test` 43 项。
> 剩余：push/tag/CI 实跑、完整 WCAG 审计、10 张 golden set、P2 模型 A/B。签名待 SignPath。
