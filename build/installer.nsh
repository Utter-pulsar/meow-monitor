; Custom NSIS hooks for 摸鱼监控 — install / remove the virtual-display driver during setup.
; The installer is perMachine (electron-builder.yml nsis.perMachine: true) so it runs elevated;
; the PowerShell scripts live in resources\driver\ (electron-builder extraResources).

!macro customInstall
  DetailPrint "正在安装扩展屏虚拟显示驱动…"
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\driver\install-vdd.ps1"'
  Pop $0
  DetailPrint "虚拟显示驱动安装完成 (code $0)"
!macroend

!macro customUnInstall
  DetailPrint "正在移除扩展屏虚拟显示驱动…"
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\driver\uninstall-vdd.ps1"'
  Pop $0
!macroend
