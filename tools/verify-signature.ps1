#requires -Version 5.1
<#
.SYNOPSIS
  Verify Authenticode signatures and timestamps for DeskPet release binaries.

.DESCRIPTION
  Defaults to the portable exe. Pass one or more paths (globs allowed) to check
  the unpacked app exe or a downloaded signed artifact as well.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File tools/verify-signature.ps1

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File tools/verify-signature.ps1 `
    -Path 'signed\DeskPet-0.4.2-portable.exe','dist\win-unpacked\DeskPet.exe'
#>
param(
  [string[]]$Path,
  [switch]$AllowNoTimestamp
)

$ErrorActionPreference = 'Stop'
if (-not $Path -or $Path.Count -eq 0) {
  $version = (Get-Content (Join-Path $PSScriptRoot '..\package.json') -Raw | ConvertFrom-Json).version
  $Path = @("dist\DeskPet-$version-portable.exe")
}
$files = @()
foreach ($pattern in $Path) {
  $files += @(Get-ChildItem -Path $pattern -File -ErrorAction SilentlyContinue)
}
$files = $files | Sort-Object FullName -Unique

if (-not $files -or $files.Count -eq 0) {
  Write-Error "No files matched: $($Path -join ', ')"
  exit 1
}

$invalid = 0
$missingTimestamp = 0
foreach ($file in $files) {
  $sig = Get-AuthenticodeSignature -FilePath $file.FullName
  $subject = if ($sig.SignerCertificate) { $sig.SignerCertificate.Subject } else { '(none)' }
  $timestamp = if ($sig.TimeStamperCertificate) { $sig.TimeStamperCertificate.Subject } else { '(missing)' }

  Write-Host ''
  Write-Host "File:      $($file.FullName)"
  Write-Host "Status:    $($sig.Status) - $($sig.StatusMessage)"
  Write-Host "Signer:    $subject"
  Write-Host "Timestamp: $timestamp"

  if ($sig.Status -ne 'Valid') { $invalid++ }
  if (-not $sig.TimeStamperCertificate) { $missingTimestamp++ }
}

if ($missingTimestamp -gt 0 -and -not $AllowNoTimestamp) {
  Write-Warning "$missingTimestamp file(s) have no timestamp. The signature will expire with the certificate; pass -AllowNoTimestamp only for local testing."
  exit 1
}

if ($invalid -gt 0) {
  Write-Error "$invalid file(s) have an invalid or missing signature."
  exit 1
}

Write-Host ''
Write-Host "All $($files.Count) file(s) have a valid signature." -ForegroundColor Green
