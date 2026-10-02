@echo off
setlocal

set "APP=%~dp0app"
set "ADB=%APP%\.toolchain\android-sdk\platform-tools\adb.exe"
set "PKG=com.crazymonkey.tractor"

echo.
echo  ============================================================
echo    拖拉机  一键打包 + 装进雷电模拟器
echo  ============================================================
echo.
echo  用之前，请先把雷电 9 打开，等它进到桌面。
echo.
pause

echo.
echo  [1/4] 打包 APK ...
call "%APP%\build-apk.bat" <nul
if errorlevel 1 goto fail

echo.
echo  [2/4] 连模拟器 ...
"%ADB%" connect 127.0.0.1:5555
"%ADB%" -s 127.0.0.1:5555 get-state >nul 2>&1
if errorlevel 1 goto nodrv

echo.
echo  [3/4] 装进模拟器 ...
"%ADB%" -s 127.0.0.1:5555 install -r "%APP%\拖拉机.apk"
if errorlevel 1 goto fail

echo.
echo  [4/4] 打开 ...
"%ADB%" -s 127.0.0.1:5555 shell am force-stop %PKG%
"%ADB%" -s 127.0.0.1:5555 shell am start -n %PKG%/.MainActivity >nul

echo.
echo  ============================================================
echo    好了，模拟器上已经跑起来了。
echo  ============================================================
echo.
pause
exit /b 0

:nodrv
echo.
echo  ------------------------------------------------------------
echo    连不上雷电模拟器。
echo    请先打开雷电 9，等它进到安卓桌面，再双击这个脚本。
echo  ------------------------------------------------------------
echo.
pause
exit /b 1

:fail
echo.
echo  ------------------------------------------------------------
echo    出错了，往上翻翻看是什么问题。
echo  ------------------------------------------------------------
echo.
pause
exit /b 1
