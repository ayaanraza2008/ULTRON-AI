@echo off
set "DOTNET=C:\Users\Ali Raza Zaidi\AppData\Local\dotnet\dotnet.exe"
"%DOTNET%" publish windows-companion\Ultron.Companion.csproj -c Release -r win-x64 --self-contained -o windows-companion\publish
