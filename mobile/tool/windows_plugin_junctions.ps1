# Flutter Windows plugin builds need NTFS symlinks. Without Developer Mode,
# unprivileged processes get ERROR_PRIVILEGE_NOT_HELD (1314). Directory
# junctions (mklink /J) do not need that privilege; Flutter skips createSync
# when the link already exists.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$dep = Join-Path $root '.flutter-plugins-dependencies'
if (-not (Test-Path -LiteralPath $dep)) {
  Write-Error 'Run flutter pub get first (.flutter-plugins-dependencies missing).'
}
$json = Get-Content -Raw $dep | ConvertFrom-Json
$destRoot = Join-Path $root 'windows\flutter\ephemeral\.plugin_symlinks'
New-Item -ItemType Directory -Force -Path $destRoot | Out-Null
foreach ($p in $json.plugins.windows) {
  $src = $p.path.TrimEnd('\')
  $dest = Join-Path $destRoot $p.name
  if (-not (Test-Path -LiteralPath $src)) { continue }
  if (Test-Path -LiteralPath $dest) { continue }
  cmd /c mklink /J "$dest" "$src" | Out-Null
}
Write-Output "Plugin junctions ready in $destRoot"
