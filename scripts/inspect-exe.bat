@echo off
set "EXE=windows-companion\publish\ULTRON.Companion.exe"

powershell -NoProfile -Command ^
  "$info = (Get-Item '%EXE%').VersionInfo; " ^
  "Write-Host 'ProductName:    ' $info.ProductName; " ^
  "Write-Host 'ProductVersion: ' $info.ProductVersion; " ^
  "Write-Host 'FileVersion:    ' $info.FileVersion; " ^
  "Write-Host 'Description:    ' $info.FileDescription; " ^
  "Write-Host 'OriginalName:   ' $info.OriginalFilename; " ^
  "$bytes = [System.IO.File]::ReadAllBytes('%EXE%'); " ^
  "$peOffset = [BitConverter]::ToInt32($bytes, 0x3C); " ^
  "$machine = [BitConverter]::ToUInt16($bytes, $peOffset + 4); " ^
  "Write-Host 'PE Machine:     ' ('0x' + $machine.ToString('X4') + ' (' + (if ($machine -eq 0x8664) { 'AMD64 / x64' } else { 'Other' }) + ')')"
