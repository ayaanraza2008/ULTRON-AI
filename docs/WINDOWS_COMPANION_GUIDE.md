# ULTRON AI — Windows Desktop Companion Guide
## Architecture, Security Boundaries, Installation & Operations

### 1. Overview
The **ULTRON Windows Desktop Companion** provides an authorized local bridge connecting the ULTRON Core brain to the host operating system. It operates under strict **Least Privilege** security principles.

- **Non-Bypassable Security Boundary:** Arbitrary remote shell access is permanently disabled by design.
- **Allowlisted Execution:** Only approved executables (`notepad.exe`, `calc.exe`, `explorer.exe`, `wt.exe`, `cmd.exe`, `powershell.exe`) and parameterized commands can be invoked.
- **Cryptographic Pairing:** Pairing uses random UUID tokens (`dtk_...`) rotated per device registration session.
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

### 4. Uninstallation

To cleanly remove all companion configuration and scheduled tasks:

```powershell
.\scripts\uninstall-windows-companion.ps1
```
