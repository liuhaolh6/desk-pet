# 代码签名（三条路线 + 现状）

> 现状（2026-10-23，0.6.8）：**仍未签名**。三条路线的代码侧准备工作都已做完，
> 卡在只能由人来办的一步：申请/采购证书（见 §0.3）。
> 签名一旦可用，`sign-release.yml` 会自动接管，产物地址与文件名不变。

## 0. 三条路线怎么选

| 路线 | 门槛 | 成本 | 拿证时间 | 发布者显示 | 本项目适配度 |
|---|---|---|---|---|---|
| **A. SignPath Foundation**（原选定） | 仓库必须 public + OSI 许可证 + 活跃维护 | 免费 | 审核 1–4 周（不保证通过） | `SignPath Foundation` | 已写好申请材料与 workflow；前提是 P2-8 先把仓库公开 |
| **B. Azure Trusted Signing** | 需要 Azure 订阅 + 组织身份验证（个人也可，需 3 年+ 企业/个人实名） | ≈ $9.99/月（Basic） | 1–3 个工作日 | 自己的名字/组织名 | **推荐起步**：云签名、无硬件 token、GitHub Action 成熟 |
| **C. OV 代码签名证书**（DigiCert/Sectigo/SSL.com 等） | 企业营业执照或个人身份核验 | ¥2000–5000/年 | 3–10 个工作日 | 自己的名字/组织名 | 最通用，但要硬件 token 或云 HSM，CI 接入麻烦 |

不建议 EV：单价 ¥5000+/年、审核更严，而 SmartScreen 信誉现在对 OV/EV 的差别已不明显。

### 0.1 三条路线的共同点

不管选哪条，**签名对象、时间戳、验签方式完全一样**：

```powershell
# 本地先把产物签出来（有证书后）
signtool sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /a dist\DeskPet-0.6.8-setup.exe
# 验签：状态必须 Valid、必须有时间戳
powershell -NoProfile -ExecutionPolicy Bypass -File tools/verify-signature.ps1
```

- 必须带 RFC3161 时间戳，否则证书过期后旧版本全部失效；
- `DeskPet-<v>-setup.exe`、`DeskPet-<v>-portable.exe`、`win-unpacked\DeskPet.exe` 三个都要签；
- 签名必须发生在 electron-builder 打包**之后**（签 exe 本身，不是目录）。

### 0.2 已经就绪的部分（不需要证书就能验收）

- `tools/verify-signature.ps1`：批量验签 + 时间戳检查，未签名时以非 0 退出（可直接当门禁用）。
- `.github/workflows/sign-release.yml`：SignPath 作业（路线 A）与 Azure Trusted Signing 作业（路线 B）两份，各自用 vars 开关，未配置时自动跳过。
- `npm run verify:signature`：本地一条命令验签。
- README「Code signing policy」：三条路线与发布者身份描述。

### 0.3 阻塞点（需要人来办，代码无法代办）

1. **路线 A**：仓库还是 private → 先做 P2-8（补 `PRIVACY.md` 后公开）；然后去 <https://signpath.org/apply> 提交申请，等审核。
2. **路线 B**：需要 Azure 订阅 + 完成组织/个人身份验证（Microsoft Entra 账号、税务/地址信息）；在 Azure 门户创建 Trusted Signing Account + Certificate Profile 后，把四个值填进仓库 vars：
   `AZURE_TS_ENDPOINT`、`AZURE_TS_ACCOUNT`、`AZURE_TS_PROFILE`、`AZURE_TS_SUBJECT`，再加 secrets `AZURE_CLIENT_ID`/`AZURE_TENANT_ID`/`AZURE_SUBSCRIPTION_ID`（OIDC 联邦凭据，不用存密码）。
3. **路线 C**：下单买证书 → 身份核验 → 拿到 token/HSM → 在 CI 里配 `WINDOWS_CERT_FILE`+`WINDOWS_CERT_PASSWORD`（或云 HSM 的 endpoint）。

**建议顺序**：先做 P2-8 公开仓库（半天），同时按路线 B 注册 Azure Trusted Signing（1–3 天出证）；
等 A 的 SignPath 审核结果（1–4 周）作为备选。两条都通了就把 `sign-release.yml` 的开关打开。

---

# 路线 A 细节：SignPath Foundation 免费 OSS 签名

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

## 8. 当前检查清单（路线 A）

- [x] README 增加 Code signing policy
- [x] `.github/workflows/sign-release.yml`
- [x] `tools/verify-signature.ps1`
- [x] `package.json` 增加 `verify:signature`
- [ ] 向 SignPath Foundation 提交申请
- [ ] SignPath 项目 / artifact config / signing policy / API token
- [ ] GitHub secrets + variables
- [ ] 跑签名工作流并人工批准
- [ ] 验签通过、发布带签名的版本

---

# 路线 B 细节：Azure Trusted Signing

## B.1 开通（人工，一次性）

1. Azure 订阅（Pay-As-You-Go 即可），并完成 Microsoft Entra 目录的**身份验证**（个人：3 年以上个人身份；企业：营业执照）。
2. 门户里创建 **Trusted Signing Account**（区域选 `East US` 或 `West Europe`），再建 **Certificate Profile**（类型 `PublicTrust`，有效期 1 年，自动续期）。
3. 在 Certificate Profile 里登记 `Subject`（个人名或组织名，CCA 审核过的名字）。
4. 创建 Entra 应用注册 → 联邦凭据（GitHub OIDC，`repo:liuhaolh6/desk-pet:ref:refs/tags/v*`）→ 给这个应用授 “Trusted Signing Certificate Profile Signer” 角色。

## B.2 接入 GitHub（仓库已经写好，只需填值）

仓库 Variables：`AZURE_TS_ENDPOINT`（如 `https://eus.codesigning.azure.net`）、`AZURE_TS_ACCOUNT`、`AZURE_TS_PROFILE`、`AZURE_TS_SUBJECT`；
仓库 Secrets：`AZURE_CLIENT_ID`、`AZURE_TENANT_ID`、`AZURE_SUBSCRIPTION_ID`。

配置好后推 `v*` tag → `sign-release.yml` 的 `build-sign-azure` 作业会：构建 → 用 `trusted-signing-action` 签 `setup.exe` / `portable.exe` / `win-unpacked\DeskPet.exe` → `verify-signature.ps1` 验签 → 上传 `deskpet-signed`。

## B.3 本地手签（拿到证书后的备选）

```powershell
winget install Microsoft.SigningClient   # 或 npm i -g @azure/trusted-signing-cli
signtool sign /fd SHA256 /tr http://timestamp.acs.microsoft.com /td SHA256 /dlib "C:\Program Files\Microsoft Signing Client\dlib.dll" /dmdf metadata.json dist\DeskPet-0.6.8-setup.exe
```

`metadata.json` 里写 `Endpoint`/`CodeSigningAccountName`/`CertificateProfileName`/`CorrelationId`，格式见 Azure 文档。

---

# 路线 C 细节：OV 代码签名证书

1. 向 DigiCert / Sectigo / SSL.com 下单 OV 代码签名（**不要买“文档签名”**），完成企业/个人核验。
2. 交付物一般是硬件 token 或云 HSM。云 HSM 会给你 `WINDOWS_CERT_FILE`(base64 pfx) / `WINDOWS_CERT_PASSWORD` / `WINDOWS_CERT_HSM` 一类参数。
3. 在 `sign-release.yml` 里改用 electron-builder 内置签名（最省事）：给构建环境加：

```yaml
env:
  CSC_LINK: ${{ secrets.WINDOWS_CERT_FILE }}
  CSC_KEY_PASSWORD: ${{ secrets.WINDOWS_CERT_PASSWORD }}
  CSC_IDENTITY_AUTO_DISCOVERY: 'true'
```

   electron-builder 会自动签 `setup.exe`/`portable.exe`/`win-unpacked` 里的 exe（签名参数加 `signingHashAlgorithms: [sha256]`、`rfc3161TimeStampServer: http://timestamp.digicert.com`）。
4. 签完用 `tools/verify-signature.ps1` 验；把 `Signed by` 写进 `SHA256SUMS.txt` 旁边。

---

# 通用：签完之后要做什么

- Release 说明里写明签名主体与时间戳，并提供 `SHA256SUMS.txt`（已有）。
- SmartScreen 信誉从零开始累积：前几十次下载仍可能弹警告，**不要**在文档里承诺“马上没警告”。
- 每次发版都用同一身份签；换证书等于重置信誉。
- 未签名产物不要再对外发（避免用户拿到混合版本）。
