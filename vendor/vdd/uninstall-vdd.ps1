# Reverses install-vdd.ps1. Run by the NSIS uninstaller (elevated). Best-effort / idempotent.
$ErrorActionPreference = 'Continue'
$log = Join-Path $env:TEMP 'moyu-uninstall-vdd.log'
"=== uninstall-vdd $(Get-Date -Format o) ===" | Set-Content -Encoding UTF8 $log
function L($m){ $m | Out-File -FilePath $log -Append -Encoding UTF8 }

$dest = 'C:\ProgramData\moyu-monitor\vdd'
$nefcon = Join-Path $dest 'nefconw.exe'
$hwid = 'Root\MttVDD'
$guid = '4D36E968-E325-11CE-BFC1-08002BE10318'

# remove the virtual display device node
if (Test-Path $nefcon) { (& $nefcon --remove-device-node --hardware-id "$hwid" --class-guid "$guid") | ForEach-Object { L $_ } }

# delete the scheduled tasks
foreach ($t in 'MoyuVddOn','MoyuVddOff') {
  try { $svc = New-Object -ComObject Schedule.Service; $svc.Connect(); $svc.GetFolder('\').DeleteTask($t, 0); L "deleted task $t" }
  catch { L "task $t not present" }
}

# clean up the stable folders (leave the driver in the store; harmless and avoids oemNN guesswork)
Remove-Item 'C:\VirtualDisplayDriver' -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item 'C:\ProgramData\moyu-monitor' -Recurse -Force -ErrorAction SilentlyContinue
L '=== done ==='
