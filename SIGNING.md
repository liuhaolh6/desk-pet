# 代码签名（SignPath Foundation 免费 OSS 路线）

> 选定路线：**A. SignPath Foundation 免费开源签名**
> 状态：申请材料、GitHub Actions、artifact 配置示例、本地验签脚本已就绪；**当前 `0.5.0` 仍是未签名构建**。SignPath 审核通过并配置 secrets/vars 后，由 GitHub Actions 签名。

## 1. 这条路线是什么

SignPath Foundation 为公开开源项目提供免费代码签名：证书签发给 **SignPath Foundation**，发布者会显示为 `SignPath Foundation`，不是“小芳桌宠”或个人名字。

适合当前项目的原因：

- 仓库 public + MIT，符合 OSI 许可证条件；
- 不需要买证书、不需要硬件 token；
- 构建在 GitHub 托管 runner 上完成，SignPath 会校验来源；
- 每次发布在 SignPath 里人工批准，安全性比“私钥放本地”好。

需要接受的限制：

- **不保证申请通过**；SignPath 会看项目信誉、维护活跃度、发布物；
- 发布者显示 SignPath Foundation；
- 每次签名需人工批准；
- 签名不等于 SmartScreen 立刻零警告，信誉仍会累积。

官方条件：<https://signpath.org/terms.html>
申请入口：<https://signpath.org/apply>

## 2. 申请前准备

1. **README 里的 Code signing policy**：已加，见 `README.md` 的「Code signing policy」。
2. **GitHub 2FA**：SignPath 要求所有成员开启 MFA。
3. **公开的发布页**：至少有一个 GitHub Release，里面能有当前 exe/zip。
4. **项目说明**：README 已描述功能、下载、运行方式。
5. **版本号**：正式签名发布前把 `package.json` 的 version 升到新版本（例如 `0.5.1`），避免和当前未签名的 `0.5.0` 混淆。
6. **单人维护说明**：当前 committer/reviewer/approver 都是 `@liuhaolh6`；如果 SignPath 要求职责分离，审核时按他们的要求加第二个人。

申请时可以写：

```text
Project: desk-pet
Repository: https://github.com/liuhaolh6/desk-pet
License: MIT
Release: https://github.com/liuhaolh6/desk-pet/releases
Artifact: DeskPet-<version>-portable.exe (Windows x64)
Build: GitHub Actions, windows-latest, from source
Code signing policy: see README "Code signing policy"
```

## 3. SignPath 侧配置

审核通过后，在 SignPath 完成：

1. 安装 [SignPath GitHub App](https://github.com/apps/signpath)，授权仓库。
2. 创建 Project，slug 建议 `desk-pet`。
3. 关联 Trusted Build System：**GitHub.com**。
4. 创建 **Artifact Configuration**，slug 建议 `deskpet-portable`：

```xml
<artifact-configuration xmlns="http://signpath.io/artifact-configuration/v1">
  <parameters>
    <parameter name="version" required="true" />
  </parameters>
  <pe-file path="DeskPet-*-portable.exe"
           product-name="DeskPet"
           product-version="${version}"
           file-version="${version}">
    <authenticode-sign/>
  </pe-file>
</artifact-configuration>
```

工作流上传的是 `archive: false` 的单个 exe，所以根节点用 `<pe-file>`。`version` 由工作流从 `package.json` 读取后传入；SignPath Foundation 要求签名文件的 ProductName / ProductVersion 被 metadata restriction 固定住。

如果以后改成上传 ZIP，需要改成：

```xml
<artifact-configuration xmlns="http://signpath.io/artifact-configuration/v1">
  <parameters>
    <parameter name="version" required="true" />
  </parameters>
  <zip-file>
    <pe-file path="DeskPet-*-portable.exe"
             product-name="DeskPet"
             product-version="${version}"
             file-version="${version}">
      <authenticode-sign/>
    </pe-file>
  </zip-file>
</artifact-configuration>
```

5. 创建 **Signing Policy**，slug 建议 `release-signing`；审批人填你自己。
6. 在 SignPath 生成 **API Token**（submitter 权限）。

## 4. GitHub 仓库配置

在 `Settings → Secrets and variables → Actions` 添加：

| 类型 | 名称 | 值 |
|---|---|---|
| Secret | `SIGNPATH_API_TOKEN` | SignPath 生成的 API Token |
| Variable | `SIGNPATH_ORGANIZATION_ID` | SignPath Organization ID |
| Variable | `SIGNPATH_PROJECT_SLUG` | 例如 `desk-pet` |
| Variable | `SIGNPATH_SIGNING_POLICY_SLUG` | 例如 `release-signing` |
| Variable | `SIGNPATH_ARTIFACT_CONFIGURATION_SLUG` | 例如 `deskpet-portable` |

工作流：`.github/workflows/sign-release.yml`

- 手动 `workflow_dispatch` 或推送 `v*` tag 触发；
- 只有配置了 `SIGNPATH_ORGANIZATION_ID` + `SIGNPATH_PROJECT_SLUG` 才会运行，未配置时跳过；
- 构建 `npm run dist`，上传未签名 portable，提交 SignPath，等待人工批准（最长 30 分钟），下载签名后的 exe；
- 最后用 `Get-AuthenticodeSignature` 验签。

### CI 上 NSIS 失败时

本机曾遇到 32 位 NSIS 对 ~100MB 数据块报 mmap 错误。若 `windows-latest` 也失败：

1. 改用 `npm run dist:dir`；
2. `Compress-Archive` 把 `dist\win-unpacked\*` 打成 `DeskPet-<version>-win-x64.zip`；
3. 上传这个 zip（`archive: false`）；
4. Artifact Configuration 改成：

```xml
<artifact-configuration xmlns="http://signpath.io/artifact-configuration/v1">
  <parameters>
    <parameter name="version" required="true" />
  </parameters>
  <zip-file>
    <pe-file path="DeskPet.exe"
             product-name="DeskPet"
             product-version="${version}"
             file-version="${version}">
      <authenticode-sign/>
    </pe-file>
  </zip-file>
</artifact-configuration>
```

这样签的是解包版里的 `DeskPet.exe`，发布 zip 也比 portable 少一层 TEMP 解压，能避开火绒对 portable 临时目录的拦截。

## 5. 验证

```powershell
# 默认验 portable
powershell -NoProfile -ExecutionPolicy Bypass -File tools/verify-signature.ps1

# 指定路径
powershell -NoProfile -ExecutionPolicy Bypass -File tools/verify-signature.ps1 `
  -Path 'signed\DeskPet-0.5.1-portable.exe','dist\win-unpacked\DeskPet.exe'
```

或：

```powershell
Get-AuthenticodeSignature .\signed\DeskPet-0.5.1-portable.exe | Format-List *
signtool verify /pa /v .\signed\DeskPet-0.5.1-portable.exe
```

`Status` 必须是 `Valid`，并确认有 **Timestamp**。签名后不要再改文件，任何改动都会让签名失效。

## 6. 签名之后仍然要注意

- **SmartScreen**：签名解决“未知发布者”，但标准 OV/OSS 证书仍可能要累积信誉；EV/托管签名初始信誉通常更好，也不保证立刻零警告。
- **火绒**：签名能降低“未签名”触发，但 portable 往 `%LOCALAPPDATA%\Temp` 写仍可能被行为规则拦。遇到时用解包版 zip，或向火绒提交误报/加白。
- **只签外层不够**：portable 的外层 exe 被签了，用户解压后运行的 `DeskPet.exe` 还是未签名。如果发布 `win-unpacked` zip，要再做一个 artifact configuration 签里面的 `DeskPet.exe`。
- **时间戳**：SignPath 会加时间戳；本地 PFX 签名务必带 RFC3161 时间戳。
- **同一张证书持续发版**：信誉才会累积，不要频繁换证书。

## 7. 备用方案

如果 SignPath 不通过：

- **Certum 开源代码签名**：<http://certumcodesign.cn/shop/product/open-source-code-signing-cloud/>
- **OV 证书**：国内 CA/代理询价，通常需要企业资质 + 硬件 token；electron-builder 用 `CSC_LINK` + `CSC_KEY_PASSWORD`。
- **Azure Artifact Signing**：个人 Public Trust 仅美国/加拿大，组织限特定国家/地区，中国大陆个人不适用。
- **自签名**：只用于本机测试，不解决用户端 SmartScreen。

## 8. 当前检查清单

- [x] README 增加 Code signing policy
- [x] `.github/workflows/sign-release.yml`
- [x] `tools/verify-signature.ps1`
- [x] `package.json` 增加 `verify:signature`
- [ ] 向 SignPath Foundation 提交申请
- [ ] SignPath 项目 / artifact config / signing policy / API token
- [ ] GitHub secrets + variables
- [ ] 跑签名工作流并人工批准
- [ ] 验签通过、发布带签名的版本
