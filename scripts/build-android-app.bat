@echo off
set "JAVA_HOME=C:\Users\Ali Raza Zaidi\AppData\Local\jdk17\jdk-17.0.21.0.2+1"
set "ANDROID_HOME=C:\Users\Ali Raza Zaidi\AppData\Local\Android\Sdk"
set "PATH=%JAVA_HOME%\bin;C:\Users\Ali Raza Zaidi\AppData\Local\gradle\gradle-8.10.2\bin;%PATH%"

cd /d "C:\Users\Ali Raza Zaidi\.gemini\antigravity\scratch\ULTRON-AI\android-companion"

echo === Generating Gradle Wrapper ===
call "C:\Users\Ali Raza Zaidi\AppData\Local\gradle\gradle-8.10.2\bin\gradle.bat" wrapper --gradle-version 8.10.2 --no-validate-url

echo === Running assembleDebug ===
call "C:\Users\Ali Raza Zaidi\AppData\Local\gradle\gradle-8.10.2\bin\gradle.bat" assembleDebug --stacktrace
