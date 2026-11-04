# ULTRON AI — Windows Desktop Companion Guide
## Architecture, Security Boundaries, Installation & Operations

### 1. Overview
The **ULTRON Windows Desktop Companion** provides an authorized local bridge connecting the ULTRON Core brain to the host operating system. It operates under strict **Least Privilege** security principles.

- **Non-Bypassable Security Boundary:** Arbitrary remote shell access is permanently disabled by design.
- **Allowlisted Execution:** Only approved executables (`notepad.exe`, `calc.exe`, `explorer.exe`, `wt.exe`, `cmd.exe`, `powershell.exe`) and parameterized commands can be invoked.
- **Device authentication:** The native companion sends a server-issued `ULTRON_DEVICE_TOKEN` (or server-configured `ULTRON_DESKTOP_AGENT_TOKEN`) as `x-device-token`. Do not generate an arbitrary client token or commit the token to source control. The current DeviceHub stores pairing state in process memory; persistent pairing is not production-complete.
- **Host Vitals & Hardware Telemetry:** Real-time monitoring of CPU cores, frequency, RAM headroom (<85%), storage free space, and battery charge status.
- **Screen & Energy Core Synchronization:** Workstation lock/unlock events via Windows `user32.dll` reflect in the Cyber-HUD Energy Core state.

---

### 2. Installation & Quick Setup

From an authorized PowerShell console in the repository root:

```powershell
# 1. Run automated companion installation
.\scripts\install-windows-companion.ps1

# 2. Run standalone diagnostic health check
node scripts\check-windows-companion.mjs
```

---

### 3. Verification & Diagnostic Commands

Run the health check at any time to verify system connectivity and telemetry:

```bash
node scripts/check-windows-companion.mjs
```

Expected Output:
- **Host Platform:** `win32 (Native Windows Host)`
- **CPU Model:** `AMD Ryzen 7 5700U with Radeon Graphics`
- **RAM Headroom:** `< 85% utilization`
- **Device Registration:** `SUCCESS (64-char Cryptographic UUID)`
- **Security Grid:** `PASSED (SYSTEM_UNLOCKED / SYSTEM_LOCKED)`

---

### 4. Wake-to-command behaviour and current limitations

- Wake detection currently uses an installed English Windows speech recognizer for the word `Ultron`; finger-snap detection is a basic audio-level transient heuristic, not a calibrated acoustic classifier.
- After wake/snap, the updated companion pauses the wake recognizer, opens a separate `DictationGrammar` capture for up to 12 seconds, sends only the recognised text (not raw microphone audio) to the backend, speaks the backend response, and re-arms the wake listener.
- `ULTRON_VOICE_LANGUAGE=hinglish` uses the installed English recognizer as a best-effort path; Hindi requires an installed `hi-IN` recognizer and is not guaranteed on every Windows installation.
- Remote backend calls default to `https://ultron-ai-core.onrender.com`. Only HTTPS is allowed for remote hosts; HTTP is allowed only for loopback development.
- Set a valid server-issued `ULTRON_DEVICE_TOKEN` locally only after pairing. Without a valid token, the companion deliberately refuses to send the command. The current pairing implementation is in-memory and configuration-gated; do not treat the pairing UI/API tests as durable production pairing.
- New wake-to-dictation code is awaiting the Windows build workflow and physical microphone/paired-backend testing. The companion build is not proof of physical-device operation.

## 5. Uninstallation

To cleanly remove all companion configuration and scheduled tasks:

```powershell
.\scripts\uninstall-windows-companion.ps1
```
