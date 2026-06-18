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

# The IddCx virtual monitor only ATTACHES when the device node is created from the INTERACTIVE
# desktop session. A SYSTEM task (S-1-5-18 / session 0) creates the adapter but it stays
# "Device is currently stopped" and no 1920x464 monitor ever arrives (verified on win11). So run
# the tasks as the logged-on (installing) user with an interactive token + Highest privileges =>
# session 1, elevated, NO runtime UAC. Requires that user be a local admin (perMachine install
# already required admin). Non-admin users would get a non-elevated task that can't create the node.
$ConsoleUser = (Get-CimInstance Win32_ComputerSystem).UserName
if (-not $ConsoleUser) { $ConsoleUser = "$env:USERDOMAIN\$env:USERNAME" }
L "tasks will run as interactive user: $ConsoleUser"

# 5) register two tasks (interactive token, Highest) that create / remove the node
function RegTask($name, $argline) {
  $svc = New-Object -ComObject Schedule.Service; $svc.Connect()
  $root = $svc.GetFolder('\'); $td = $svc.NewTask(0)
  $td.RegistrationInfo.Description = "moyu-monitor virtual display: $name"
  # session 1 + elevated + no UAC: IddCx monitor only attaches from the interactive session, not SYSTEM/session 0
  $td.Principal.UserId = $ConsoleUser; $td.Principal.LogonType = 3; $td.Principal.RunLevel = 1  # InteractiveToken + Highest
  $td.Settings.AllowDemandStart = $true; $td.Settings.DisallowStartIfOnBatteries = $false
  $td.Settings.StopIfGoingOnBatteries = $false; $td.Settings.MultipleInstances = 2
  $td.Settings.ExecutionTimeLimit = 'PT2M'; $td.Settings.Hidden = $true
  $act = $td.Actions.Create(0); $act.Path = $nefcon; $act.Arguments = $argline
  $sddl = 'D:(A;;FA;;;SY)(A;;FA;;;BA)(A;;GRGX;;;BU)'  # SYSTEM/Admins full; Built-in Users read+execute
  $root.RegisterTaskDefinition($name, $td, 6, $ConsoleUser, $null, 3, $sddl) | Out-Null  # logonType 3 = interactive token
}
# ON uses nefconw's `install <inf> <hwid>` (full DIF_INSTALLDEVICE = create node + install + START the
# driver) — NOT `--create-device-node`, which only creates a bare node that stays "stopped" so the
# IddCx monitor never attaches. This is the verb the upstream Virtual-Display-Driver project uses.
RegTask 'MoyuVddOn'  ('install "' + $inf + '" "' + $hwid + '"')
RegTask 'MoyuVddOff' ("--remove-device-node --hardware-id `"$hwid`" --class-guid `"$guid`"")
L "registered MoyuVddOn / MoyuVddOff"
L '=== done ==='
