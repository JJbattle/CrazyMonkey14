@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo   跳棋 APK 打包
echo ============================================
echo.

rem ---- 工具链和拖拉机共用 ../../.toolchain，不占 C 盘、不重复占盘 ----
set "JAVA_HOME=%~dp0..\..\.toolchain\jdk-21.0.12.1+1"
set "ANDROID_HOME=%~dp0..\..\.toolchain\android-sdk"
set "GRADLE_USER_HOME=%~dp0..\..\.toolchain\gradle-home"

if not exist "%JAVA_HOME%\bin\java.exe" (
  echo [错误] 找不到 Java：%JAVA_HOME%
  echo        请确认 ..\..\.toolchain 还在。
  pause
  exit /b 1
)
if not exist "%ANDROID_HOME%\platforms\android-36" (
  echo [错误] 找不到安卓 SDK：%ANDROID_HOME%
  echo        请确认 ..\..\.toolchain\android-sdk 还在。
  pause
  exit /b 1
)

echo [1/4] 校正 SDK 路径 ...
call python fix-sdk-path.py
if errorlevel 1 (
  echo 校正失败
  pause
  exit /b 1
)

echo.
echo [2/4] 把网页版同步进 www ...
call node sync.js
if errorlevel 1 (
  echo 同步失败
  pause
  exit /b 1
)

echo.
echo [3/4] 同步进安卓工程 ...
call npx cap sync android
if errorlevel 1 (
  echo 同步失败
  pause
  exit /b 1
)

echo.
echo [4/4] 开始编译（第一次要下依赖，会比较久）...
rem 注意：必须写 .\gradlew.bat，不能只写 gradlew.bat。
rem 这台机器设了 NoDefaultCurrentDirectoryInExePath=1，
rem cmd 不肯在当前目录下找程序，裸名字会报「不是内部或外部命令」。
pushd "%~dp0android"
call .\gradlew.bat assembleDebug
set "RC=%ERRORLEVEL%"
popd

if not "%RC%"=="0" (
  echo.
  echo [错误] 编译失败，错误码 %RC%
  pause
  exit /b %RC%
)

echo.
echo 把成品复制到 _安装包 目录 ...
copy /y "android\app\build\outputs\apk\debug\app-debug.apk" "..\..\_安装包\跳棋.apk" >nul

echo.
echo ============================================
echo   打包成功！
echo   成品： %~dp0..\..\_安装包\跳棋.apk
echo ============================================
pause
