# Installs the MttVDD virtual-display feature. Run by the NSIS installer (perMachine = already
# elevated). Idempotent. Driver files + nefconw.exe sit next to this script (resources\driver).
#
# After this: the app turns the virtual screen on/off WITHOUT further UAC by triggering the two
# SYSTEM scheduled tasks (MoyuVddOn / MoyuVddOff) it registers here.
$ErrorActionPreference = 'Continue'
$src = $PSScriptRoot
$log = Join-Path $env:TEMP 'moyu-install-vdd.log'
"=== install-vdd $(Get-Date -Format o) src=$src ===" | Set-Content -Encoding UTF8 $log
function L($m){ $m | Out-File -FilePath $log -Append -Encoding UTF8 }

# 1) stage driver + tool to a stable machine-wide location (survives app moves/updates)
$dest = 'C:\ProgramData\moyu-monitor\vdd'
New-Item -ItemType Directory -Force $dest | Out-Null
foreach ($f in 'MttVDD.inf','mttvdd.cat','MttVDD.dll','nefconw.exe','vdd_settings.xml') {
  if (Test-Path (Join-Path $src $f)) { Copy-Item (Join-Path $src $f) $dest -Force } else { L "WARNING missing: $f" }
}
L "staged -> $dest"

# 2) settings the driver reads at init (1920x464, software cursor)
New-Item -ItemType Directory -Force 'C:\VirtualDisplayDriver' | Out-Null
Copy-Item (Join-Path $dest 'vdd_settings.xml') 'C:\VirtualDisplayDriver\vdd_settings.xml' -Force

# 3) stage the signed driver into the Windows driver store
$inf = Join-Path $dest 'MttVDD.inf'
(pnputil /add-driver "$inf" /install) | ForEach-Object { L $_ }
L "pnputil exit=$LASTEXITCODE"

$nefcon = Join-Path $dest 'nefconw.exe'
$hwid = 'Root\MttVDD'
$guid = '4D36E968-E325-11CE-BFC1-08002BE10318'   # Display setup class (no braces, per nefcon docs)

# 4) off by default: remove any existing devnode so there's no leftover screen
if (Test-Path $nefcon) { (& $nefcon --remove-device-node --hardware-id "$hwid" --class-guid "$guid") | ForEach-Object { L $_ } }

# 5) register two SYSTEM tasks (runnable by standard users via SDDL) that create / remove the node
function RegTask($name, $argline) {
  $svc = New-Object -ComObject Schedule.Service; $svc.Connect()
  $root = $svc.GetFolder('\'); $td = $svc.NewTask(0)
  $td.RegistrationInfo.Description = "moyu-monitor virtual display: $name"
  $td.Principal.UserId = 'S-1-5-18'; $td.Principal.LogonType = 5; $td.Principal.RunLevel = 1
  $td.Settings.AllowDemandStart = $true; $td.Settings.DisallowStartIfOnBatteries = $false
  $td.Settings.StopIfGoingOnBatteries = $false; $td.Settings.MultipleInstances = 2
  $td.Settings.ExecutionTimeLimit = 'PT2M'; $td.Settings.Hidden = $true
  $act = $td.Actions.Create(0); $act.Path = $nefcon; $act.Arguments = $argline
  $sddl = 'D:(A;;FA;;;SY)(A;;FA;;;BA)(A;;GRGX;;;BU)'  # SYSTEM/Admins full; Built-in Users read+execute
  $root.RegisterTaskDefinition($name, $td, 6, 'S-1-5-18', $null, 5, $sddl) | Out-Null
}
RegTask 'MoyuVddOn'  ("--create-device-node --hardware-id `"$hwid`" --class-name Display --class-guid `"$guid`"")
RegTask 'MoyuVddOff' ("--remove-device-node --hardware-id `"$hwid`" --class-guid `"$guid`"")
L "registered MoyuVddOn / MoyuVddOff"
L '=== done ==='
