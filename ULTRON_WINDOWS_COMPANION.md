# ULTRON AI — Windows Companion Architecture & Operations
## WINDOWS DESKTOP NODE · SYSTEM-CONTROL CAPABILITIES · HARDWARE INTEGRATION

---

## 1. Executive Summary

The **ULTRON Windows Companion** provides deep, safe, and audited operating system control for Microsoft Windows workstations running AMD Ryzen 7 5700U hardware. It consists of two complementary layers:
1. **Windows Wake Companion UI (`windows-companion/Program.cs`)**: C# .NET WinForms application providing the tray controller, Living Energy Core HUD overlay with Win32 screen capture exclusion, acoustic finger-snap detector, and on-device English/Hindi/Hinglish wake-word listener.
2. **Windows Desktop Agent (`system/windows-desktop-agent.js`)**: Autonomous Node.js service managing approved remote task reception, local app launching, hardware telemetry, and secure status reporting.

---

## 2. Capabilities & Hardware Integration

### 2.1 Hardware Profile: AMD Ryzen 7 5700U Workstation
- **Processor**: AMD Ryzen 7 5700U with Radeon Graphics (8 Cores, 16 Threads, 1.8 GHz base, up to 4.3 GHz boost).
- **Memory**: 8.00 GB DDR4 (Throttle ceiling configured at 85% to preserve system stability).
- **Graphics**: Integrated AMD Radeon Graphics 8 CUs (DirectML / Vulkan support; no CUDA dependencies).
- **Operating System**: Microsoft Windows 11 / 10.

### 2.2 Approved Application Launching Allowlist
Arbitrary command execution is strictly denied. The companion permits launching ONLY approved executables registered in `ALLOWLISTED_APPS`:

| App Key | Executable | Launch Mode | Security Scope |
|---|---|---|---|
| `chrome` | `chrome.exe` | Shell execute | Standard user context |
| `msedge` / `edge` | `msedge.exe` | Shell execute | Standard user context |
| `code` / `vscode` | `code.cmd` | Process execute | Workspace sandboxed |
| `notepad` | `notepad.exe` | Shell execute | Standard user context |
| `calculator` / `calc` | `calc.exe` | Shell execute | Standard user context |
| `terminal` | `wt.exe` | Shell execute | Non-elevated Windows Terminal |
| `cmd` | `cmd.exe` | Shell execute | Non-elevated prompt |
| `explorer` | `explorer.exe` | Shell execute | File Explorer standard |
| `spotify` | `spotify.exe` | Shell execute | Standard user context |

### 2.3 Hardware & System Control
- **Session Screen Lock**: Triggers `rundll32.exe user32.dll,LockWorkStation` to securely lock the Windows user session without logging off.
- **System Audio Volume**: Modulates master volume via virtual key events (VK 173 Mute, VK 174 Volume Down, VK 175 Volume Up).
- **Screen Capture**: Takes primary monitor capture into `Documents/UltronWorkspace/screenshots/` and returns base64 PNG data URLs.
- **Power & Battery Telemetry**: Queries `Win32_Battery` via WMI CIM query (`Get-CimInstance`) to report charge percentage, AC connection status, and estimated runtime.
- **Sandboxed File Operations**: Restricts file reading and directory listings to designated user directories with path traversal (`..`) and symbolic link traversal denial.

---

## 3. Living Energy Core Cyber-HUD Overlay

The floating HUD is an always-on, translucent, circular HUD anchored to the bottom-right of the primary monitor:
- **Win32 Window Flags**: `WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW` to prevent taking window focus from IDEs or games.
- **Capture Shield (`WDA_EXCLUDEFROMCAPTURE`)**: Calls `SetWindowDisplayAffinity(Handle, 0x11)` to exclude the Energy Core HUD from screen recordings and screenshots.
- **Reactive State Animations**:
  - `STANDBY`: Glowing cyan `#00D2FF`
  - `LISTENING`: Pulsing amber `#FFB300`
  - `THINKING`: Swirling cyber purple `#8A2BE2`
  - `SPEAKING`: Vibrant sky blue `#38BDF8`
  - `EXECUTING`: Neon blue `#2563EB`
  - `ERROR`: Crimson `#EF4444`

---

## 4. Security & Cryptographic Invariants

1. **Token Protection with DPAPI**:
   Device credentials (`ultron_dev_...`) are protected on disk using the Windows Data Protection API (`ProtectedData.Protect` with `DataProtectionScope.CurrentUser`). The token is decryptable ONLY by the same logged-in Windows user account.
2. **Outbound-Only Networking**:
   The Windows companion does NOT open any inbound listening ports on the public network. It connects OUTBOUND to the central brain via WebSocket or authenticated HTTPS polling.
3. **Destructive Operations Gating**:
   File deletions, software installations, or elevated operations require explicit cryptographic operator authorization; they can never be initiated blindly from remote mobile devices.
