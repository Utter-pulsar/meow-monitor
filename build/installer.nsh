; Custom NSIS hooks for 摸鱼监控 — install / remove the virtual-display driver during setup.
; The installer is perMachine (electron-builder.yml nsis.perMachine: true) so it runs elevated;
; the PowerShell scripts live in resources\driver\ (electron-builder extraResources).

!macro customInstall
  DetailPrint "正在安装扩展屏虚拟显示驱动…"
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\driver\install-vdd.ps1"'
  Pop $0
  DetailPrint "虚拟显示驱动安装完成 (code $0)"
  DetailPrint "正在配置 meow 命令环境变量…"
  nsExec::ExecToLog `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$$dir = '$INSTDIR\resources\meow'; $$legacy = Join-Path $$env:USERPROFILE '.meow-monitor'; $$cur = [Environment]::GetEnvironmentVariable('Path','User'); $$parts = @(); if ($$cur) { $$parts = $$cur -split ';' | Where-Object { $$_ -and $$_ -ne $$dir } }; [Environment]::SetEnvironmentVariable('Path', ((@($$dir) + $$parts) -join ';'), 'User'); Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $$legacy 'meow.cmd')"`
  Pop $1
  DetailPrint "meow 命令路径配置完成 (code $1)"
!macroend

!macro customUnInstall
  DetailPrint "正在移除扩展屏虚拟显示驱动…"
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\driver\uninstall-vdd.ps1"'
  Pop $0
  DetailPrint "正在移除 meow 命令环境变量…"
  nsExec::ExecToLog `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$$dir = '$INSTDIR\resources\meow'; $$cur = [Environment]::GetEnvironmentVariable('Path','User'); if ($$cur) { $$parts = $$cur -split ';' | Where-Object { $$_ -and $$_ -ne $$dir }; [Environment]::SetEnvironmentVariable('Path', ($$parts -join ';'), 'User') }"`
  Pop $1
!macroend
