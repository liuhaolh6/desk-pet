# M36：让公开仓库的 CI 徽章变绿（0.6.15 之后）

> 2026-10-25。用户一句「仓库公开后徽章是红的，解决」。
> 结论：**不是代码坏了**，是 e2e 用例默认了中文系统；外加 Actions 的日志拿不到，
> 导致连"哪条用例失败"都看不见。

## 1. 现象与卡点

- README 顶部的 `CI` 徽章来自 `.github/workflows/ci.yml`；push 后 `test` job 全绿，`e2e` job 红。
- Actions 的 job 日志：`GET /repos/.../actions/jobs/<id>/logs` 未登录一律 403
  （即使是公开仓库），本地没有 `gh`、没有 token，git 远程是 SSH 也就没有 HTTPS 凭据可用。
- `e2e` 步骤只跑了 22 秒（4 个用例本地约 15 秒 + 启动），说明用例跑起来了、断言挂，
  不是"Electron 起不来"。

## 2. 先让失败能看见

`ci.yml` 的 e2e 步骤改成：

```yaml
- name: Headless Electron e2e (noresize / collapse / city)
  shell: bash
  run: |
    set -o pipefail
    npm run test:e2e 2>&1 | tee e2e.log
  env:
    DESKPET_E2E_PORT: '9333'
    DESKPET_E2E_KEEP: '1'
```

再加一步 `if: failure()` 跑 `node tools/e2e/annotate.js e2e.log`。

`tools/e2e/annotate.js` 把 `FAIL ...` 行、紧跟的 `  - 断言信息`、以及 `.e2e-data/*/app.log`
的最后几行，用 `::error::` 发成 **check-run 注解**：注解对公开仓库是匿名可读的，
用 `GET /repos/{owner}/{repo}/check-runs/{id}/annotations` 就能拉，不用 token。

`tools/e2e/launch.js` 配合加了 `keepData`（`DESKPET_E2E_KEEP=1`），失败时别把
`.e2e-data/` 删掉，否则注解步骤读不到 `app.log`。顺手把 artifact 的
`include-hidden-files` 打开（`.e2e-data` 是点开头的目录，默认被跳过）。

拉注解后一眼看到：

```
FAIL city (3325ms) → 设置页应当有「天气」分类
```

## 3. 根因

`tools/e2e/launch.js` 的种子设置只写了 `onboarded / weather / mode`，没写 `locale`。
`app/settings.html` 的分类按钮文字来自语言包（`data-i18n="panel.weather.title"`）：

- 本地系统 zh-CN → 「天气」，`city.js` 里的 `/天气/` 能命中；
- GitHub 的 `windows-latest` 是 en-US → 变成「Weather」，断言就挂了。

这是典型的"本地绿、CI 红"：用例依赖了运行环境的语言。

## 4. 修法（两处，都不碰产品代码）

1. `tools/e2e/launch.js`：种子设置固定 `locale: 'zh-CN'`，e2e 环境从此与系统语言无关。
2. `tools/e2e/cases/city.js`：找分类用 `document.querySelector('.nav-item[data-panel="weather"]')`
   （`data-panel` 不随语言变），并给 5 秒重试窗口——CI 上设置页首帧比本地慢。

## 5. 验证

- 本地 `npm run test:e2e`：4 用例全过（city 3.4s / collapse 2.6s / i18n 4.2s / noresize 4.3s）。
- push `26f09fc` 后 CI run `40173191967`：`test` ✅ + `e2e` ✅。
- 徽章实测：`https://github.com/liuhaolh6/desk-pet/actions/workflows/ci.yml/badge.svg`
  的 `<title>` 已是 `CI - passing`。

## 6. 教训

- **e2e 要把运行环境钉死**：语言、时区、屏幕尺寸、DPI 都可能让"本地绿"在 runner 上变红。
  能用 `data-*` 定位就别用界面文字。
- **公开仓库的日志不是公开的**：job 日志要鉴权；想匿名排查就让 workflow 把关键信息写成
  check-run 注解。
- 先拿到"哪一条断言失败"，再改代码；这次根因只有一行 locale，猜是猜不出来的。