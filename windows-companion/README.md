# ULTRON Windows Wake Companion

This is a small, free-first Windows tray companion for the exact wake word **“Ultron”**. It uses the installed Windows System.Speech recognition engine and does not send microphone audio to the ULTRON server. No speech model is downloaded automatically.

## Build

Requires the .NET 8 SDK and Windows Desktop targeting support.

```powershell
dotnet restore .\windows-companion\Ultron.Companion.csproj
dotnet publish .\windows-companion\Ultron.Companion.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o .\artifacts\ultron-windows-companion
```

The GitHub Actions workflow builds this project on Windows and uploads a downloadable ULTRON.Companion.exe artifact.

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


## Optional approved local actions

An optional, separate checkbox can enable the owner-approved action bridge. It defaults off and requires a dedicated high-entropy `ULTRON_DESKTOP_BRIDGE_TOKEN` configured out of band both on the backend and in the Windows user's environment. The backend also requires `ULTRON_INTEGRATION_OWNER_USER_ID` and the additive `supabase/migrations/20261028160000_desktop_action_bridge.sql` migration in the target test environment. Do not apply this migration to production without separate authorization.

The first safe allowlist can launch Notepad, Calculator, or Explorer without arguments, or return limited system information. By default, each request starts pending approval and requires a separate, exact action-ID approval. An owner may opt into hands-free mode by setting `ULTRON_DESKTOP_AUTONOMY_MODE=allowlisted` on the backend; only the stated allowlist can then be queued without a per-action prompt, and a valid bridge token is still required. Shell commands, arbitrary files, URL launching, screenshots, uploads, and deletion are not supported. External URL launching remains disabled because the browser's eventual network connection is not pinned to a prevalidated DNS answer.

A passing build or deterministic queue test is not proof of a paired Windows device or live database state. Keep the checkbox off until a separately authorized, non-sensitive test environment is ready.
