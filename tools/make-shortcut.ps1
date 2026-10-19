# Create (or refresh) a desktop shortcut for the built app.
#
#   powershell -ExecutionPolicy Bypass -File tools\make-shortcut.ps1
#   powershell ... -File tools\make-shortcut.ps1 -Name "DeskPet" -Target "D:\path\DeskPet.exe"
#
# The target defaults to the unpacked build (dist\win-unpacked\DeskPet.exe).
# The unpacked build is preferred for shortcuts: it launches without NSIS
# extracting to %TEMP%, which some antivirus products block for unsigned apps.
param(
  [string]$Name = '小芳桌宠',
  [string]$Target = ''
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

if (-not $Target) { $Target = Join-Path $root 'dist\win-unpacked\DeskPet.exe' }
if (-not (Test-Path $Target)) {
  Write-Error "找不到可执行文件：$Target`n先运行：npm run dist:dir"
  exit 1
}

$desktop = [Environment]::GetFolderPath('Desktop')
if (-not $desktop) { Write-Error '无法定位桌面目录'; exit 1 }

$lnk = Join-Path $desktop ("{0}.lnk" -f $Name)
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($lnk)
$shortcut.TargetPath = $Target
$shortcut.WorkingDirectory = Split-Path -Parent $Target
$shortcut.IconLocation = "$Target,0"
$shortcut.Description = '桌面宠物：点一下看天气、提醒喝水'
$shortcut.Save()

Write-Host "已创建：$lnk"
Write-Host "        指向：$Target"
