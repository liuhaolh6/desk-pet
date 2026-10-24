# M33 · 导入的音效没有声音：pet-sound 协议缺 CORS

> 现象：把外部 WAV 作为音效（设置 → 音效 → 导入…）后，试听与点击都没有声音；内置音色正常。
> 根因：`file://` 页面 `fetch()` 自定义协议被浏览器的 CORS 检查拦下——协议注册缺 `corsEnabled`，
> 响应也缺 `Access-Control-Allow-Origin`，两层缺一不可。
> 结果：修复后 `fetch` 200 / `decodeAudioData` 1.85s / 播放链路真的 start；unit **185** 例、
> smoke **67** 项、`npm run check`（51 文件）、check-a11y、check-i18n（30 文件 / 0 内联）全绿。

## 1. 先排除「文件坏了」

用户给的 `微信笔记语音_2026-10-24.wav` 先单独验：RIFF/PCM、16 bit、单声道、48 kHz、1.85 s
（88,800 帧，177,644 字节），峰值 29162、RMS 7323，54 ms 起有声。文件没问题。

## 2. 播放链路

`app/sound-model.js:168` `playFragment()`：

```
file:<id> → fetch('pet-sound://sound/' + id)      // 行 181
          → ctx.decodeAudioData(await res.arrayBuffer())
          → playBuffer(buffer, volume)
```

字节由主进程 `app/main/catalog.js` 的 `handleSoundProtocol` 供给，scheme 在 `app/main.js`
用 `protocol.handle('pet-sound', …)` 注册。内置音色走 WebAudio 合成，不经过这条链，所以「只有导入的哑」。

## 3. 实测定位（CDP 直连 pet.html）

| 探测 | 结果 |
|---|---|
| `fetch('pet-sound://sound/test')` | `TypeError: Failed to fetch` |
| `XMLHttpRequest` | `error` |
| `new Audio('pet-sound://sound/test')` | ok，duration 1.85 s |
| `fetch(..., {mode:'no-cors'})` | opaque（拿不到 body） |

`<audio>` 能放、`fetch` 不能——典型的 CORS：媒体元素对跨源不校验，`fetch` 校验。页面是
`file://` 载入的，`pet-sound://` 在它看来就是跨源。

## 4. 修法（两处，必须成对）

1. `app/main.js` 的 `registerSchemesAsPrivileged`：

```js
{ scheme: 'pet-sound', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }
```

2. `app/main/catalog.js` `handleSoundProtocol` 的每个响应加：

```
'access-control-allow-origin': '*'
'access-control-allow-headers': '*'
```

只加其一仍会 `Failed to fetch`：缺 1 时浏览器认为该协议不可被 fetch，缺 2 时预检/响应校验失败。

## 5. 验证证据

- 重启后 CDP 复测：`fetch` 200、`content-type: audio/wav`、177,644 字节；`decodeAudioData` 得
  duration 1.85 / channels 1 / 48000；`AudioContext.state === 'running'`；再调
  `playFragment('file:test')`，确实创建 `AudioBufferSourceNode` 并 `start(0)`（buffer 1.85 s）。
- `tests/unit/sound-protocol.test.js`（3 例）：wav 200 + ACAO `*` + 正确 content-type、mp3 →
  `audio/mpeg`、未知 id / 错误 host → 404。用假 fs/store，不碰真协议。
- `tools/smoke.js` 加两条断言：`main.js` privileges 含 `corsEnabled`、`catalog.js` 含
  `access-control-allow-origin`，防止以后被「清理」掉。
- 门禁：smoke 67 / unit 185 / check 51 文件 / check-a11y PASS / check-i18n 30 文件 0 内联。

## 6. 附带处理

- `package.json` 的 `build.files` 加 `!app/**/.dsh-ops-*.lock`，并清掉工作区里 130 个零字节
  `.dsh-ops-*.lock`（编辑器原子写留下的临时锁，之前被 `app/**/*` 打进 asar：600 → 549 条）。
- 出包踩坑两条：`dist/win-unpacked/DeskPet.exe` 被遗留的 `DeskPet.exe` 进程（7 个）锁住 →
  `EPERM`，先 `Stop-Process` 再 `node tools/clean-dist.js`；`npm run dist` 的 `predist` 在沙箱
  cmd 里找不到 `npm`，改用 `node node_modules/electron-builder/cli.js --win portable` 并把
  nodejs 目录加进 `PATH`（否则报 `No JSON content found in output`）。