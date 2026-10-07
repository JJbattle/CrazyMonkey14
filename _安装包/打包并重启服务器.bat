@echo off
setlocal

echo.
echo ============================================================
echo   拖拉机 —— 一键打包 + 重启联网服务器
echo ============================================================
echo.
echo   1) 重新打包拖拉机 APK（输出到本文件夹的 拖拉机.apk）
echo   2) 重启 8099 端口的联网服务器
echo.

rem ===== 1. 打包 APK =====
echo [1/2] 正在打包拖拉机 APK（第一次要编译，稍等）...
echo.
call "%~dp0..\tractor\app\build-apk.bat" <nul
if errorlevel 1 (
  echo.
  echo 打包失败，看上面的提示。
  echo.
  pause
  exit /b 1
)

rem ===== 2. 重启服务器 =====
echo.
echo [2/2] 正在重启联网服务器（端口 8099）...

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8099" ^| findstr "LISTENING"') do (
  echo   结束旧服务器进程 PID=%%a
  taskkill /F /PID %%a >nul 2>&1
)

start "拖拉机联网服务器" /D "%~dp0..\tractor\server" cmd /k "chcp 65001 >nul && node server.js"

echo.
echo ============================================================
echo   完成！
echo     - 新 APK：本文件夹的 拖拉机.apk
echo     - 服务器：已在独立窗口启动，把窗口里的 IP 填到手机
echo ============================================================
echo.
pause
exit /b 0
