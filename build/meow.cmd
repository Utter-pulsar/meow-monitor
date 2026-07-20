@echo off
setlocal
set "APP_DIR=%~dp0..\.."
set "APP_EXE=%APP_DIR%\meow-monitor.exe"

rem Older releases used a localized executable name. Find the large application
rem executable without embedding non-ASCII text that cmd.exe may decode incorrectly.
if not exist "%APP_EXE%" (
  set "APP_EXE="
  for %%F in ("%APP_DIR%\*.exe") do if %%~zF GTR 10000000 set "APP_EXE=%%~fF"
)

if not defined APP_EXE (
  echo meow-monitor executable was not found. 1>&2
  exit /b 3
)

"%APP_EXE%" meow-cli %*
