@echo off
set "JAVA_HOME=C:\Users\Ali Raza Zaidi\AppData\Local\jdk17\jdk-17.0.21.0.2+1"
set "PATH=%JAVA_HOME%\bin;%PATH%"
set "APKSIGNER=C:\Users\Ali Raza Zaidi\AppData\Local\Android\Sdk\build-tools\35.0.0\apksigner.bat"
set "APK=android-companion\app\build\outputs\apk\debug\app-debug.apk"

echo === APKSIGNER VERIFY ===
call "%APKSIGNER%" verify --verbose "%APK%"

echo === AAPT BADGING DUMP ===
set "AAPT=C:\Users\Ali Raza Zaidi\AppData\Local\Android\Sdk\build-tools\35.0.0\aapt.exe"
"%AAPT%" dump badging "%APK%" | findstr /i "package: launchable-activity sdkVersion targetSdkVersion"
