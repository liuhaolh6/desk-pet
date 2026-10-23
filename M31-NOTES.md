# M31 · 主题包（P2-7）

> 目标：换主题不改代码；非法包有校验。
> 结果：**`themes/<id>/theme.json` + 设置页下拉 + 校验器 + zip 导入导出**，两个内置包（默认 / 像素），14/14 + 17/17 运行时断言通过。

## 1. 包长什么样

```json
{
  "id": "pixel",
  "nameKey": "theme.pixel",
  "tokens": { "--ink": "#f4f7ff", "--radius-md": "0px", "--font-ui": "'Cascadia Mono', monospace" }
}
```

- 只允许 **白名单 token**（见 `lib/theme.js` 的 `ALLOWED`，36 个）：颜色、字体、圆角、阴影、气泡底色。
- 任何能改布局的量（`--pet-size`、`--bubble-*` 尺寸、`--u`）都不在白名单里——主题包**不能**把按钮挪出屏幕。
- `id` 必须是小写短横线、且与目录名一致（`id-folder-mismatch`）；`nameKey` 缺省时按 id 生成。

## 2. 校验（为什么敢以后开放导入）

`lib/theme.js#validateTheme` 返回 `{ ok, theme, errors }`：

| 检查 | 例子 | 错误码 |
|---|---|---|
| 声明逃逸 | `red;}</style>`、`url(...)`、`expression(...)` | `unsafe-token-value:<key>` |
| 白名单外 token | `--position:fixed` | `unknown-token:<key>` |
| 名字格式 | `--Ink`、`color` | `bad-token-name:<key>` |
| 值长度 | 超过 200 字 | `bad-token-value:<key>` |
| id | `X Y`、`-lead` | `bad-id` |

**取值会进 `<style>`**，所以危险字符一律按"整包不通过"处理，不做净化。

## 3. 谁在应用主题

第一版想在主进程用 `webContents.insertCSS` 一次注入到所有窗口。实测**不生效**（`insertCSS` 能在 CDP 里拿到 key，但页面 `getComputedStyle` 不变；`cssOrigin:'user'` 更差——用户样式在层叠里本来就输给作者样式）。后来改成：

1. 主进程算 CSS 字符串（`app/main/theme.js#css`），仍是唯一校验入口；
2. `theme:set` 后广播 `theme:changed`；
3. `app/theme-boot.js`（每个窗口都在 `</body>` 前引入）把 CSS 写进 `<style id="theme-pack">`，并在收到广播时重写。

现在 6 个页面都引入了它：pet / overlay / settings / editor / cutout / onboard。

## 4. 设置页

「外观 → 主题包」下拉，选项文案走语言包（`theme.default` / `theme.pixel`），选中即时生效（不用重启），并写进 `settings.theme`。搜索索引里也能搜到（关键词：主题 皮肤 配色 换肤 像素 暗色）。

## 5. 验证（CDP，端口 9300，数据目录 `.dev-theme`）

```
PASS 默认主题有底色 token / getThemes 返回至少两个包 / 当前主题是 default
PASS 默认包没有覆盖 token / setTheme 成功
PASS 像素主题的底色生效（与默认不同）  # #202a44 -> #f4f7ff
PASS 像素主题改了圆角                  # 15px -> 0px
PASS 像素主题用等宽字体
PASS 设置里记下了选择
PASS pixel 包给了非空 CSS
PASS 设置窗口已打开 / 后开的窗口也套用了主题（dom-ready 之后开的窗口同样生效）
PASS 设置页主题下拉有两个包 / 下拉显示当前主题
PASS 切回默认后设置页恢复原色 / 桌宠窗口也跟着回来 / 设置里记回 default
RESULT 17/17
```

门禁：`npm run check` 62 文件 · smoke **67** · unit **175**（theme 9 例）· check-a11y 通过 · i18n **0 处内联**。

## 6. zip 导入导出（已做）

包里只有一个文件，所以不值得为它引一个 zip 依赖——`lib/theme-zip.js` 自己读写：

| 方向 | 做法 | 备注 |
|---|---|---|
| 导入 | 读 zip → 找任意层级里的 `theme.json` → `validateTheme` → 写到 `<data>/themes/<id>/theme.json` | 写进数据目录而不是安装目录（便携版安装目录只读） |
| 导出 | 把所选包的 `theme.json` 重新序列化成单文件 zip | 与导入对称，导出→导入能原地往返 |

- 读支持 stored(0) 与 deflate(8)；zip64、加密、多卷直接抛错。解包后**只认 theme.json**，其余文件丢弃（避免把任意文件写进数据目录）。
- `id` 取自包内 `id`，缺失时用文件名（`idFromFileName` 只留小写字母/数字/短横线，最多 32 字）。
- 失败返回错误码由 IPC 层翻译（`bad-zip` / `no-theme-json` / `bad-json` / `invalid` / `bad-id` / `write-failed`），与 P2-6 的「错误码当协议、中文不当协议」一致。
- `theme:import` / `theme:export` 都接受可选路径参数：UI 不传就走系统对话框，测试传路径就能免点击验证。

验证（CDP 9300）：导入 `deep-night` → 列表出现且 `source:user`、token 数 2、切换后 `--ink` 生效；导出后重新解析 zip 内容一致；坏文件/白名单外 token/无 theme.json 三种输入分别拿到 `bad-zip` / `invalid` / `no-theme-json`，14/14。

## 7. 未做（后续）

- **用户主题目录**（`<data>/themes/<id>/`）已实现且优先级高于内置，但还没有 UI 提示"这个包来自导入"。
- 主题只影响 CSS 变量；抠图动画和气泡尾巴的阴影用的是 token，像素包下会变成硬边阴影（预期）。