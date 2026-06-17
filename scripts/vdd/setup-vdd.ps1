# One-time elevated setup for the "extend screen" feature (run once, e.g. from the NSIS installer
# or first-run with UAC). After this, the app turns the virtual display on/off WITHOUT any further
# UAC prompt by triggering the two SYSTEM scheduled tasks via `schtasks /run`.
#
# What it does (all idempotent):
#   1. stage the signed MttVDD driver + tool into C:\ProgramData\moyu-monitor\vdd
#   2. write the 1920x464 / software-cursor vdd_settings.xml to C:\VirtualDisplayDriver
#   3. pnputil /add-driver  (put the signed driver in the driver store)
#   4. remove any existing Root\MttVDD devnode (off by default -> no leftover screen)
#   5. register MoyuVddOn / MoyuVddOff scheduled tasks (SYSTEM, highest, runnable by standard users)
#      that CREATE / REMOVE the devnode -> the only clean on/off for an IddCx display.
#
# Tool: uses devcon for now (local dev). For the public release, swap to the redistributable
# nefconw (NefCon, MIT) -- devcon is NOT redistributable (WDK EULA).
param(
  [string]$DriverDir   = 'C:\Users\45092\AppData\Local\Temp\moyu-m0\vdd-x\SignedDrivers\x86\VDD',
  [string]$DevconPath  = 'C:\Users\45092\AppData\Local\Temp\moyu-m0\vdd-x\Dependencies\devcon.exe',
  [string]$SettingsSrc = 'C:\Users\45092\AppData\Local\Temp\moyu-m0\vdd_settings.xml'
)
$ErrorActionPreference = 'Continue'
$log = 'C:\Users\45092\AppData\Local\Temp\moyu-m0\setup-vdd.log'
"=== setup-vdd $(Get-Date -Format o) ===" | Set-Content -Encoding UTF8 $log
function L($m){ $m | Out-File -FilePath $log -Append -Encoding UTF8 }

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
L "Administrator: $admin"
if (-not $admin) { L 'NOT ELEVATED'; exit 5 }

# 1) stage driver + tool
$dest = 'C:\ProgramData\moyu-monitor\vdd'
New-Item -ItemType Directory -Force $dest | Out-Null
foreach ($f in 'MttVDD.inf','mttvdd.cat','MttVDD.dll') { Copy-Item (Join-Path $DriverDir $f) $dest -Force }
Copy-Item $DevconPath (Join-Path $dest 'devcon.exe') -Force
Copy-Item $SettingsSrc (Join-Path $dest 'vdd_settings.xml') -Force
L "staged -> $dest"

# 2) settings the driver reads at init
New-Item -ItemType Directory -Force 'C:\VirtualDisplayDriver' | Out-Null
Copy-Item $SettingsSrc 'C:\VirtualDisplayDriver\vdd_settings.xml' -Force
L "settings -> C:\VirtualDisplayDriver\vdd_settings.xml"

# 3) stage the signed driver in the driver store
$inf = Join-Path $dest 'MttVDD.inf'
(pnputil /add-driver "$inf" /install) | ForEach-Object { L $_ }
L "pnputil exit=$LASTEXITCODE"

# 4) off by default: remove any existing devnode
$devcon = Join-Path $dest 'devcon.exe'
(& $devcon remove "Root\MttVDD") | ForEach-Object { L $_ }
L "removed existing devnode (exit=$LASTEXITCODE)"

# 5) register the two SYSTEM tasks, runnable by standard users (SDDL grants Built-in Users run)
function RegTask($name, $arguments) {
  $svc = New-Object -ComObject Schedule.Service
  $svc.Connect()
  $root = $svc.GetFolder('\')
  $td = $svc.NewTask(0)
  $td.RegistrationInfo.Description = "moyu-monitor virtual display: $name"
  $td.Principal.UserId   = 'S-1-5-18'  # LocalSystem
  $td.Principal.LogonType = 5          # TASK_LOGON_SERVICE_ACCOUNT
  $td.Principal.RunLevel  = 1          # TASK_RUNLEVEL_HIGHEST
  $td.Settings.AllowDemandStart = $true
  $td.Settings.DisallowStartIfOnBatteries = $false
  $td.Settings.StopIfGoingOnBatteries = $false
  $td.Settings.MultipleInstances = 2   # IgnoreNew
  $td.Settings.ExecutionTimeLimit = 'PT2M'
  $td.Settings.Hidden = $true
  $act = $td.Actions.Create(0)         # TASK_ACTION_EXEC
  $act.Path = $devcon
  $act.Arguments = $arguments
  # SDDL: SYSTEM + Admins full; Built-in Users generic read+execute (so a non-elevated user can /run it)
  $sddl = 'D:(A;;FA;;;SY)(A;;FA;;;BA)(A;;GRGX;;;BU)'
  $root.RegisterTaskDefinition($name, $td, 6, 'S-1-5-18', $null, 5, $sddl) | Out-Null
}
RegTask 'MoyuVddOn'  ('install "' + $inf + '" "Root\MttVDD"')
RegTask 'MoyuVddOff' ('remove "Root\MttVDD"')
L "registered MoyuVddOn / MoyuVddOff"
L '=== done ==='
