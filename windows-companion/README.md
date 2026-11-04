# ULTRON Windows Wake Companion

This is a small, free-first Windows tray companion for the exact wake word **“Ultron”**. It uses the installed Windows System.Speech recognition engine and does not send microphone audio to the ULTRON server. No speech model is downloaded automatically.

## Build

Requires the .NET 8 SDK and Windows Desktop targeting support.

```powershell
dotnet restore .\windows-companion\Ultron.Companion.csproj
dotnet publish .\windows-companion\Ultron.Companion.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o .\artifacts\ultron-windows-companion
```

The GitHub Actions workflow builds this project on Windows and uploads a downloadable ULTRON.Companion.exe artifact. The Open ULTRON action opens the current ULTRON Core interface at `https://ultron-core-interface.onrender.com/`.

## Use

1. Start ULTRON.Companion.exe.
2. Click **Start wake word** and accept the microphone-consent prompt.
3. Keep the companion running in the Windows tray. Saying “Ultron” opens the hosted ULTRON assistant in the default browser.
4. Optionally enable **Start with Windows and listen**. The app asks for microphone consent first, then registers a visible, per-user Windows startup entry. On future sign-ins, the app starts into the tray and begins listening using that previously granted opt-in.
5. Use the tray menu to pause listening or exit the companion. Uncheck **Start with Windows and listen** to remove automatic startup.

Windows must have an installed compatible English speech-recognition engine and microphone permission. If no compatible recognizer is installed, the listener stays off and reports the problem. Audio is not sent to ULTRON by this app.

## Boundaries

- This is a wake-word launcher, not a completed Windows PC-control agent or a full live voice conversation client.
- It cannot unlock Windows, bypass PIN/biometrics, or run while the PC is powered off. Sleep/resume and locked-session behavior depend on Windows and device policy.
- Wake-word recognition is available only while the companion is running, the Windows session/audio device is available, and the installed speech recognizer works.
- Automatic startup is off by default and only enabled by an explicit checkbox after microphone consent. It uses the current user's normal Windows Run registry entry and stays visible in the system tray; it does not create a hidden task or service.
- It does not hide microphone activity, execute arbitrary commands, or perform consequential actions.


## Paired-device remote commands

The Windows companion can receive ULTRON device-queue commands after it has been paired with the server. Remote command polling is **off by default**. Enable the visible **Allow allowlisted remote commands from paired devices** checkbox in the companion window to opt in; unchecking it immediately stops polling.

The device ID and device token returned by the pairing claim are stored together using Windows DPAPI with current-user scope. Every queued command's HMAC-SHA256 signature is checked locally before an action is executed. The companion does not accept arbitrary shell commands, PowerShell, executable paths supplied by a caller, or unsigned commands.

Supported actions are deliberately limited:
- Launch or gracefully close a small, hard-coded allowlist of desktop apps.
- Set system volume, send basic media keys, or lock the workstation.
- Read basic machine/runtime vitals and display a Windows tray notification.
- List/read small text files under `Documents/ULTRON Shared` only. File reads are limited to 64 KB and common text formats.

Screen capture is disabled for privacy. Unlocking Windows, waking a suspended/powered-off machine, arbitrary shell execution, and general filesystem browsing are not supported. A failed/unsupported action is reported back as a failed task rather than being marked complete.

For remote file access, create `Documents/ULTRON Shared` and place only files you explicitly intend to expose to ULTRON there. Keep the companion running and leave the opt-in enabled to receive commands.
