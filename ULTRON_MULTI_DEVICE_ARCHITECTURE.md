# ULTRON AI — Multi-Device Ecosystem Architecture
## ONE ULTRON · ONE BRAIN · ONE MEMORY · TWO DEVICE PLATFORMS

```
========================================================================================
                       ULTRON AI CENTRAL BRAIN & RUNTIME CORE
   [Authentication Isolation | Shared Memory Engine | Dynamic AI Fallback | Task Engine]
========================================================================================
                     ▲                                      ▲
                     │ (Authenticated WebSocket/TLS)        │ (Local Wi-Fi Direct or Relay)
                     ▼                                      ▼
    +----------------------------------+   +----------------------------------+
    |   ULTRON DESKTOP (WINDOWS PC)    |   |     ULTRON MOBILE (ANDROID)      |
    |  - Living Energy Core HUD        |   |  - Jetpack Compose Cyber HUD     |
    |  - Windows Desktop Agent         |   |  - On-Device Speech (EN/HI/Hing) |
    |  - Ryzen 7 5700U Local AI Guard  |   |  - Android Keystore AES-GCM      |
    |  - Allowlisted App/Hardware Ctrl |   |  - Remote Windows Control Center |
    |  - Outbound-Only Safe Networking |   |  - WorkManager Background Sync   |
    +----------------------------------+   +----------------------------------+
```

---

## 1. Executive Summary

This architecture expands the existing **ULTRON AI** system into an integrated, cross-device ecosystem unifying **Windows PC** and **Android smartphones**. 

Rather than deploying disparate assistants, ULTRON operates under **one unified intelligence identity**:
- **One User Account & Isolation**: Secure owner identification using Supabase JWT and cryptographic device-bound bearer tokens.
- **One Shared Memory**: Ephemeral and durable memory items, operator preferences, and document libraries synchronize across all connected nodes.
- **One Shared Conversation History**: Spoken or typed conversations initiated from an Android smartphone are immediately accessible and visible on the Windows PC interface, and vice-versa.
- **One Task Orchestration Engine**: Tasks submitted from any node are centrally registered, deduplicated via idempotency keys, and routed to the appropriate platform.
- **Zero-Cost Operation**: Strict adherence to free-tier cloud AI providers, local AMD Ryzen 7 5700U CPU/Vulkan acceleration (no CUDA), and deterministic offline execution.

---

## 2. Core Architectural Components

### 2.1 Central AI Backend (Render Node / Local Core)
- **Unified API Routing**: RESTful APIs for state management, configuration, memory, and tasks (`server.js`, `jarvis-router.js`).
- **Real-Time Communication**: Zero-dependency RFC 6455 WebSocket gateway (`integrations/device-websocket-gateway.js`) providing sub-10ms event streaming, bidirectional command dispatching, and heartbeat monitoring.
- **Event Streaming Fallback**: Server-Sent Events (SSE) mounted at `GET /api/jarvis/devices/:id/events` for restrictive corporate proxies.
- **Device Hub & Registry**: Durable, owner-isolated pairing and secret storage (`integrations/device-hub.js`), storing AES-256-GCM encrypted tokens on disk and SHA-256 hashes in memory.

### 2.2 Windows Desktop Platform
- **Windows Companion (`windows-companion/Program.cs`)**: WinForms + C# companion hosting the rotating **Living Energy Core floating overlay HUD** (with Win32 `WDA_EXCLUDEFROMCAPTURE` shield), local wake-word listener ("Ultron" & acoustic snap detection), and media ducking.
- **Windows Desktop Agent (`system/windows-desktop-agent.js`)**: Autonomous Node.js service managing approved application launching (Chrome, Edge, VS Code, Notepad, Calc, Terminal, Explorer), system telemetry queries (WMI CIM, AMD Ryzen 7 5700U, RAM, battery), and workstation locking/audio control.

### 2.3 Android Mobile Platform
- **Native Android Application (`android-companion/`)**: Kotlin + Jetpack Compose application.
- **Living Energy Core Canvas HUD**: Reactive multi-ring Arc Reactor visualizer responding to voice states (`LISTENING`, `THINKING`, `SPEAKING`, `EXECUTING`, `OFFLINE`).
- **On-Device Multilingual Speech Recognition**: Indian English (`en-IN`), US English (`en-US`), Hindi (`hi-IN`), and Romanized Hinglish.
- **Hardware-Backed Credential Storage**: Android Keystore AES-256-GCM non-exportable key isolation (`DeviceTokenStore.kt`).
- **Remote Windows Control Panel**: Visual command deck to inspect PC vitals and trigger permitted PC actions.
- **Background Sync**: Android `WorkManager` CoroutineWorker for low-power battery telemetry and task notifications.

---

## 3. Communication Protocols & Data Contracts

| Operation | Protocol | Endpoint | Authentication |
|---|---|---|---|
| Device Pairing Request | REST (POST) | `/api/jarvis/devices/pair/request` | Owner Session |
| Mobile QR Pairing Payload | REST (POST) | `/api/jarvis/devices/pair/qr` | Owner Session |
| One-Time Code Claim | REST (POST) | `/api/devices/pairings/claim` | 6-Digit Code |
| Real-Time Event Stream | RFC 6455 WS | `/ws/devices?token={token}` | Device Bearer Token |
| Real-Time SSE Stream | SSE (GET) | `/api/jarvis/devices/:id/events` | `x-device-token` |
| Cross-Device Routing | REST (POST) | `/api/jarvis/devices/route-command` | Owner or Device Token |
| Spoken Command Dispatch | REST (POST) | `/api/jarvis/voice/process-command` | Owner or Device Token |
| Presence Heartbeat | REST (POST) | `/api/jarvis/devices/:id/heartbeat` | `x-device-token` |
| Local Discovery Beacon | REST (GET) | `/api/discovery/local` | Public (LAN) |
| Network Mode Diagnostics | REST (GET) | `/api/network/connectivity` | Public |

---

## 4. End-to-End Cross-Device Workflow: Android to Windows PC

```
[Android Smartphone]               [ULTRON Central Brain]                 [Windows Workstation]
       │                                     │                                      │
       │ 1. "ULTRON, open Chrome on my PC"   │                                      │
       ├────────────────────────────────────►│                                      │
       │                                     │ 2. Authenticate Android Bearer Token │
       │                                     │ 3. Check Windows PC Presence (Online)│
       │                                     │ 4. Verify 'chrome' in App Allowlist  │
       │                                     │ 5. Generate HMAC-Signed Command      │
       │                                     │ 6. Dispatches via Active WebSocket   │
       │                                     ├─────────────────────────────────────►│
       │                                     │                                      │ 7. Verify Signature
       │                                     │                                      │ 8. Launch chrome.exe
       │                                     │ 9. Return Execution Result           │
       │                                     │◄─────────────────────────────────────┤
       │                                     │ 10. Update Shared Task History       │
       │                                     │ 11. Record into Shared Conversation  │
       │ 12. "Ji Ayaan, Chrome is opened."   │                                      │
       │◄────────────────────────────────────┤                                      │
```

---

## 5. Security Invariants & Fail-Closed Boundaries

1. **Zero Unrestricted Terminals**: The Windows companion never exposes arbitrary CMD, PowerShell, or bash execution. All executable launches are strictly checked against `APPROVED_REMOTE_APPS` (`chrome`, `msedge`, `code`, `notepad`, `calculator`, `terminal`, `cmd`, `explorer`, `spotify`).
2. **Never Lie About PC State**: If the Windows PC companion is offline, powered off, or disconnected, the central brain immediately rejects remote execution requests with `TARGET_DEVICE_OFFLINE` (HTTP 409). ULTRON will never pretend an action succeeded when the PC was unreachable.
3. **Idempotency on Reconnection**: All cross-device commands carry a unique `idempotencyKey`. If a network interruption forces a retry, the engine returns the cached result rather than executing the task twice.
4. **Zero-Secret Storage**: Plaintext tokens are never written to unencrypted storage. Windows uses DPAPI (`CurrentUser`); Android uses Android Keystore (`KeyProperties.PURPOSE_ENCRYPT | PURPOSE_DECRYPT`); Node backend uses AES-256-GCM disk encryption.
