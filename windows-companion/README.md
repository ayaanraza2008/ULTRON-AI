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

### Choose the ULTRON web destination

Open **Server settings** from the Windows companion window or tray menu. Paste the exact public HTTPS address from the ULTRON web app and save it. The companion validates the address and stores it in the current Windows user's registry profile. It is then used by **Open ULTRON**, wake-word activation, and future device pairings.

The original default address remains a fallback only. The correct canonical deployment must be selected before using cloud pairing. An existing paired device keeps its original heartbeat server even if the launch address is changed; revoke it in ULTRON and pair it again to move the device to another deployment.

For managed/headless setups, `ULTRON_ASSISTANT_URL` remains available as a fallback when no valid saved server setting exists. Only absolute HTTPS destinations with a DNS hostname and the default HTTPS port are accepted.

### Pair this PC with your ULTRON account

The current tray companion can pair directly with ULTRON and keep the PC's online status visible without leaving a terminal window running.

1. Open the ULTRON web app on the same HTTPS deployment you intend to use on the PC. Sign in with your Supabase account, open **PC and mobile devices**, and generate a one-time pairing code.
2. Configure the Windows companion to use that exact deployment origin. In PowerShell, set it for the current user, then restart the tray app:

   ```powershell
   [Environment]::SetEnvironmentVariable(
     "ULTRON_ASSISTANT_URL",
     "https://YOUR-ULTRON-HOST",
     "User"
   )
   ```

   Use the exact HTTPS hostname shown in your browser. A legacy default URL may not be the current canonical deployment; the hosted PWA and pairing API must be deployed to that same origin first.
3. In **ULTRON Wake Companion**, click **Pair this PC**, paste the one-time code, and choose **Pair securely**. The code expires after five minutes and can be redeemed once.
4. Click **Start cloud presence** and approve the separate status-sharing prompt. The PC sends an outbound HTTPS heartbeat every 30 seconds while this option is running. Use **Stop cloud presence** or Exit to stop it.
5. To disable a device permanently, use **REVOKE** beside it in ULTRON's device list. Revocation is enforced on the next heartbeat.

The device bearer token is stored in the current Windows user's Credential Manager; it is not placed in source files or displayed by the app. The device ID is a non-secret local UUID. The client rejects non-global DNS answers, pins each new HTTPS connection to a validated public address, disables redirects, validates the TLS hostname, and bounds response size/time.

**Presence is not remote control.** This relay has no command queue, PowerShell/shell execution, file access, screenshots, process inspection, keyboard/mouse input, or wake-from-shutdown ability. Wake-word microphone consent and cloud presence consent are separate. Cloud presence never starts automatically with Windows.

## Boundaries

- This is a wake-word launcher, not a completed Windows PC-control agent or a full live voice conversation client.
- It cannot unlock Windows, bypass PIN/biometrics, or run while the PC is powered off. Sleep/resume and locked-session behavior depend on Windows and device policy.
- Wake-word recognition is available only while the companion is running, the Windows session/audio device is available, and the installed speech recognizer works.
- Automatic startup is off by default and only enabled by an explicit checkbox after microphone consent. It uses the current user's normal Windows Run registry entry and stays visible in the system tray; it does not create a hidden task or service.
- It does not hide microphone activity, execute arbitrary commands, or perform consequential actions.
