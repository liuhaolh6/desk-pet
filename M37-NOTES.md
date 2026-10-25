# M37 · CI 与 Release 转绿（0.6.16）

> 2026-10-25。用户报「仓库公开后徽章是红的」，随后要求「修掉」。两个红：`ci.yml` 的 e2e job，
> 以及 tag `v0.6.15` 的 Release（卡在「Build installer」）。本文件记录四个根因、修法与验证证据。

## 看不见日志这件事本身是第一个问题

Actions 的 job 日志接口未登录一律 403，本机没有 `gh`、远程是 SSH 也没有 HTTPS 凭据，
Release 失败时建的 Issue 正文还只有 `System.Object[]`（见根因 4）。所以先把「失败信息」变成公开可见的东西：

- `tools/e2e/annotate.js`：读 `e2e.log`，把 `FAIL …` 行、紧跟的断言、`.e2e-data/*/app.log` 尾巴转成
  `::error::` 注解。check-run 注解在公开仓库匿名可读，于是不用登录也能看到失败原因。
- `ci.yml` 的 e2e 步骤改成 `bash` + `set -o pipefail` + `tee e2e.log`，失败时多跑一步注解；
  `DESKPET_E2E_KEEP=1` 让用例不删数据目录，注解步骤才读得到 `app.log`。
- `tools/ci-annotate.js`：同一套路给安装器探针用，挑含 `error/failed/cannot/ERR_/exit code` 的行。

## 根因 1：e2e 在 en-US 的 runner 上按中文文案找按钮

注解给到的第一手信息：`FAIL city (3325ms) → 设置页应当有「天气」分类`。
`tools/e2e/launch.js` 的种子设置没写 `locale`，runner 是 en-US，设置页分类渲染成 Weather，
`city.js` 用 `/天气/` 找 `.nav-item` 自然找不到。修法：种子固定 `locale: 'zh-CN'`，用例改用
`.nav-item[data-panel="weather"]` 定位并给 5 秒重试窗口。

## 根因 2：Release 的安装器其实构建成功了，死在「自动发布」

探针第 6 轮（commit `3fc5f8e`，run `40174219016`）的注解里终于出现：

```
⨯ GitHub Personal Access Token is not set, neither programmatically, nor using env "GH_TOKEN"
```

前面的 `signing with signtool.exe`、`building block map`、`setup.__uninstaller.exe` 说明安装器本体已经做完了。
electron-builder 从 `repository` 字段推断出 GitHub 发布源，构建收尾自己 `publish`，CI 上给不了 token 就退出 1。
修法：`dist` / `dist:installer` 都加 `--publish never`，发布只留给 `release.yml` 里显式 `gh release` 的那一步。

## 根因 3：探针里 YAML 吃掉反斜杠

`Verify Electron binary` 报找不到 `node_modules` 和 `electron` 粘连在一起的怪路径——反斜杠在写 YAML 时被折掉了。
路径统一改正斜杠后通过。

## 根因 4：Release 失败时建的 Issue 正文是 `System.Object[]`

`release.yml` 的 Report failure 步骤写 `@("…", "", $tail, $fence)`，PowerShell 会把数组当元素再拼一层，
`$lines -join` 得到字面量 `System.Object[]`。改成 `@(…) + $tail + @($fence)`。

## 验证证据

| 环节 | 运行 | 结论 |
| --- | --- | --- |
| CI（test + e2e） | run `40174396465`（`e16b99d`） | 绿；注解链路在 `839b6d0` 那轮验证过 |
| 安装器探针 | run `40174396464`（`e16b99d`） | 绿：`--publish never` 后 NSIS 安装器完整产出 |
| Release | tag `v0.6.16` | 见 HANDOFF「最新产物」：便携版 + 安装器同时产出 |

探针是一张便宜的传感器：只跑安装器、没有单测与 e2e，3~5 分钟一轮；由 `paths` 触发
（工作流自身、`tools/ci-annotate.js`、`package.json`），改打包配置会自动探一次。

## 以后注意

1. **构建脚本别碰发布**：所有 electron-builder 调用都带 `--publish never`，防止仓库里有 `repository` 字段就自动发布。
2. **注解每步上限 10 条**：`ci-annotate.js` 的调用顺序要按「最可能出错」排，别让成功步骤的转录把名额占光（踩过一次）。
3. **`::error::` 是公开仓库里唯一的匿名日志通道**：需要看 CI 现场时优先加注解，而不是要 token。
4. **失败 Issue 的正文拼接要防数组被当元素**：`@(a,b,$tail)` 不等于 `@(a,b) + $tail`。