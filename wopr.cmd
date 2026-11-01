@echo off
rem Start W.O.P.R. (Windows). Same as the Start Menu shortcut.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0wopr.ps1" %*
