@echo off
setlocal
chcp 65001 >nul
pushd "%~dp0"
title Redemption Journey Server
if exist "runtime\node.exe" (
  "runtime\node.exe" "server.mjs"
) else (
  where node >nul 2>nul
  if errorlevel 1 (
    echo [ERROR] Node.js was not found. Use the complete Windows deployment folder.
    pause
    popd
    exit /b 1
  )
  node "server.mjs"
)
set "gameExitCode=%errorlevel%"
if not "%gameExitCode%"=="0" pause
popd
exit /b %gameExitCode%
