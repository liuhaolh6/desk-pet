# 自签名试用版（Self-Signed Trial）

> 目标：让「朋友第一次运行」时不至于完全没有任何发布者信息，同时把升级/分发流程先跑通一遍。
> 结论：**可行，已在 0.6.11 上跑通并验证**（见文末实测）。

## 1. 一句话原理

Windows 只信任两类签名：**受信任根证书链上的证书**签的，和**你自己机器上信任的证书**签的。
公开 CA 的代码签名证书要钱 + 企业实名，短期内拿不到；自签名的做法是：

1. 我们自己造一个「根证书 + 代码签名证书」（一次，3 年有效）；
2. 用它给 `DeskPet.exe`、便携版、安装器签名；
3. 朋友的机器上**手动信任一次**这个根证书（双击 `.cer` → 安装到「受信任的根证书颁发机构」）；
4. 之后所有用同一张证书签的版本，在他机器上都显示「已验证的发布者」。

## 2. 我们这台机器上怎么做的（可复现）

```powershell
# 1) 造证书（SHA-256 / RSA 2048 / 3 年 / 只用于代码签名）
$cert = New-SelfSignedCertificate -Type CodeSigningCert `
  -Subject "CN=桌宠 DeskPet (Self-Signed Trial)" `
  -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm sha256 `
  -KeyUsage DigitalSignature `
  -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3') `
  -NotAfter (Get-Date).AddYears(3) `
  -CertStoreLocation 'Cert:\CurrentUser\My'

# 2) 导出（pfx 有私钥，绝不能外传；cer 只有公钥，发给朋友）
Export-PfxCertificate -Cert $cert -FilePath .tmp-signing\deskpet-selfsigned.pfx -Password (Read-Host -AsSecureString)
Export-Certificate  -Cert $cert -FilePath .tmp-signing\deskpet-selfsigned.cer

# 3) 带着证书构建：electron-builder 会自动给 win-unpacked\DeskPet.exe、
#    portable、setup、安装器内嵌的 uninstaller 全部签名
$env:CSC_LINK = 'D:\project\deskpet\.tmp-signing\deskpet-selfsigned.pfx'
$env:CSC_KEY_PASSWORD = '<pfx 密码>'
npm run dist                    # 便携版
npx electron-builder --win nsis --x64   # 安装器

# 4) 验证
Get-AuthenticodeSignature dist\DeskPet-0.6.11-setup.exe | Select-Object Status
#   本机信任前：UnknownError（链终止于不受信任的根）
#   本机信任后：Valid
```

信任根证书（本机/朋友机器都可以用这两种之一）：

```powershell
# A. 命令行（无弹窗）
certutil -user -addstore -f Root .tmp-signing\deskpet-selfsigned.cer
certutil -user -addstore -f TrustedPublisher .tmp-signing\deskpet-selfsigned.cer

# B. 图形界面：双击 .cer → 安装证书 → 当前用户 → 把证书放入"受信任的根证书颁发机构"
```

## 3. 实测结果（0.6.11，本机）

| 对象 | 签名前 | 信任根证书前 | 信任根证书后 |
|---|---|---|---|
| `dist\win-unpacked\DeskPet.exe` | 无 | `UnknownError`（有签名者，链不可信） | `Valid` |
| `dist\DeskPet-0.6.11-portable.exe` | 无 | `UnknownError` | `Valid` |
| `dist\DeskPet-0.6.11-setup.exe` | 无 | `UnknownError` | `Valid` |

签名后便携版照常启动（实测进程正常起来、数据目录可用）。

## 4. 朋友那边要做什么

1. 拿到两个东西：**安装包/便携版** + `deskpet-selfsigned.cer`；
2. 双击 `.cer`，把证书装进「受信任的根证书颁发机构」；
3. 再运行桌宠：Win11 的「未知发布者」提示会变成带发布者名字的提示；文件属性 → 数字签名 里能看到签名者。

如果他**不想信任证书**：也可以直接点「仍要运行」，程序功能完全一样，只是每次都提示未知发布者。

## 5. 代价与隐患（想清楚再发）

- **SmartScreen 仍可能拦**：自签名没有信誉积累，首次下载运行大概率弹「Windows 已保护你的电脑」→ 需要「更多信息 → 仍要运行」。信任根证书能去掉「未知发布者」，但去不掉 SmartScreen 信誉提示。
- **私钥泄露 = 任何东西都能冒充你**：`.pfx` 绝不能进仓库、进群、进网盘公开目录；丢了就重造一张，但朋友要重新信任。
- **可信度取决于「让朋友装根证书」这一步**：很多人会犹豫，这是自签名最大的摩擦点。
- **换机器/重装系统**：证书在「当前用户」存储里，导出 `.pfx` 备份，否则以后签的版本和旧版本签名者不一致（升级时不会出问题，但用户看到的发布者会变）。
- **有效期 3 年**：到期后新版本签名会失效，需要重签（或在那之前换正式证书）。
- **不能用于商店/正式分发**：微软商店、部分企业环境、部分杀软会额外审查自签名。

## 6. 什么时候该换正式证书

- 想让朋友**零步骤**安装（不需要装根证书）；
- 想消掉 SmartScreen 的「未知发布者」；
- 想上架/被企业环境接受。

正式路线：OV 代码签名证书（约 ¥1000–3000/年，需企业或个人实名）或 EV 证书（更贵，但对 SmartScreen 信誉更快）。
换证书后：把新的 `.pfx` 路径塞进 `CSC_LINK`、密码塞进 `CSC_KEY_PASSWORD` 重新构建即可，**代码不需要改**。

## 7. 仓库里留了什么

- 本文档（流程 + 实测 + 风险）；
- 证书与私钥**不进仓库**（在 `.tmp-signing/`，已被 `.gitignore` 的 `.tmp-*` 规则忽略）；
- 想复现：按 §2 跑一遍即可，`tools/verify-signature.ps1` 可检查签名状态。
## 9. 已知限制：杀软拦截安装器解包（本机实测）

本机装的是 **Lenovo Anti-Virus powered by Huorong Security**（另带 Windows Defender）。
从 2026-10-24 起，它会**静默拦截 NSIS 安装器的解包写盘**：

| 实验 | 结果 |
|---|---|
| 0.6.11 签名包，默认 TEMP | 装不上，退出码 0 |
| 0.6.11 签名包，TEMP 指向项目目录 | 装不上 |
| 0.6.11 签名包，`/S /D=D:\DeskPetTest\installed` | 装不上，目录都没建 |
| **0.6.8 老包**（当初在本机装成功过） | **同样装不上** |

最后一行是判据：**同一份二进制、同一套命令，环境变了才失败**，与代码无关。
火绒也解释了为什么 `%LOCALAPPDATA%\Temp` 一开始就不可写。

失败时的表现容易误导排查：

- 交互安装会在中途弹出「DeskPet 无法关闭」——这句来自 `extractAppPackage.nsh` 的解包失败分支，
  与“关闭程序”无关（同一个 message id 也被旧卸载器重试循环复用）。
- 静默安装（`/S`）直接放弃，**退出码 0、无任何提示**。

`installSection.nsh` 里 `customInstall` 之后就解包 `app-64.7z`；用钩子落盘可证明
`customInit`、`customInstall` 都到达了，之后文件一个都没写出来。

**给用户的建议**：装前把安装包加入杀软白名单，或直接用便携版 `DeskPet-<ver>-portable.exe`。
**产品侧兜底**：`build/installer.nsh` 的 `customInit` 会清掉「有安装记录但没有卸载器」的注册表残留，
避免走进那条没有出口的重试循环。
