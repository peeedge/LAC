@echo off
rem LiteCAD - stop leftover processes that still have this folder open.
rem
rem   stop-lingering.bat           stop them
rem   stop-lingering.bat -DryRun   list them without stopping
rem
rem Safe to double-click from Explorer, and safe to run from cmd or PowerShell.

setlocal
pushd "%~dp0"

rem Prefer PowerShell 7 when it is installed, otherwise use the one that ships
rem with Windows. -ExecutionPolicy Bypass keeps a restrictive machine policy
rem from blocking the wrapper.
set "PS=pwsh"
where pwsh >nul 2>&1 || set "PS=powershell"

"%PS%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-lingering.ps1" %*
set "EXITCODE=%ERRORLEVEL%"

popd

rem A double-click that fails would otherwise flash and vanish before the error
rem could be read, so hold the window open when something went wrong.
if not "%EXITCODE%"=="0" (
  echo.
  echo Exited with code %EXITCODE%.
  pause
)

exit /b %EXITCODE%
