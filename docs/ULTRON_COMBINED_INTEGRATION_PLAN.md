# ULTRON AI — Combined Integration Master Plan
## Best-of-Both Engineering Blueprint: JARVIS-ULTIMATE + ULTRONMAIN → ULTRON AI

**Repository:** `ayaanraza2008/ULTRON-AI`  
**Dedicated Branch:** `feat/ultron-combined-best-of-both-integration`  
**Base Commit:** `37d503a7`  
**Target Hardware:** AMD Ryzen 7 5700U (8C/16T), 8 GB RAM, Integrated AMD Radeon Graphics, Windows 10/11  
**Architect:** Antigravity Autonomous Systems Engineering  
**Date:** November 4, 2026  

---

## 1. Architectural Philosophy & Zero-Duplication Constraints

The ultimate integration mission enhances the existing ULTRON AI platform with the strongest, practical capabilities from **JARVIS-ULTIMATE (Source A)** and **ULTRONMAIN (Source B)**.

```
                      ┌──────────────────────────────────────────────────┐
                      │             ULTRON CENTRAL ORCHESTRATOR         │
                      │  - Single Intelligent Brain (BrainRouter)        │
                      │  - Unified Tool Registry (7 Categories)          │
                      │  - 4-Tier Security & Permission Engine           │
                      └─────────────┬──────────────────────┬─────────────┘
                                    │                      │
             ┌──────────────────────▼──────┐        ┌──────▼──────────────────────┐
             │    SOURCE A ADAPTATIONS     │        │    SOURCE B ADAPTATIONS     │
             │ - Floating Orb Anchoring    │        │ - WMI Display Brightness    │
             │ - System Tray Context Menu  │        │ - Edge-TTS Neural Hindi/Eng │
             │ - Global Activation Keyhook │        │ - Zero-Subprocess Telemetry │
             │ - Window Close Interception │        │ - Playwright URL Normalizer │
             └─────────────────────────────┘        └─────────────────────────────┘
```

### Invariant Rules
1. **Zero Duplicate Engines:** Never introduce a second AI brain, a second database, or a competing background voice loop.
2. **Backward Compatibility:** All existing REST endpoints, WebSocket contracts, and CLI scripts must remain 100% functional.
3. **Hardware Constraint:** The workstation possesses 8 GB total RAM. All background services must use asynchronous event loops, bounded queues, and lazy imports. No CUDA or heavy local model downloads are permitted.
4. **Security Non-Negotiable:** Shell commands, file writes, and device interactions must pass through ULTRON's permission engine. Destructive commands (`rm`, `del`, `format`, `shutdown`) require Level 4 confirmation tokens.

---

## 2. Component Implementation Blueprints

### 2.1 Module A: Permanent Desktop Companion Integration
**Source Influence:** JARVIS-ULTIMATE (`main.js`, `src/orb.html`, `src-tauri/src/commands.rs`)  
**Target Files:**
- `system/desktop-companion-manager.js` (NEW: Unified companion lifecycle & state bridge)
- `public/floating-core.js` (ENHANCE: Window anchoring, tray sync, keyboard shortcuts)
- `routes/companion-api.js` (NEW: REST/WebSocket endpoints for companion state, position, and tray controls)

**Key Capabilities Added:**
1. **Persistent Orb Positioning:** Multi-monitor coordinate save and recovery with edge boundary clamping.
2. **Window Anchoring:** When the main chat HUD is opened, anchor its position relative to the floating orb `(orb.x - 300, orb.y + 70)`.
3. **Tray Menu Lifecycle:** Tray context menu with `Show/Hide ULTRON`, `Settings`, `Emergency Stop`, and `Quit`.
4. **Global Keyhook:** `Ctrl+Shift+U` (primary) and `Ctrl+Shift+J` (compatibility alias) to toggle visibility without stealing active window focus.
5. **Close Interception:** Intercept close requests on the main HUD to hide to tray rather than killing the backend service.

---

### 2.2 Module B: Advanced Windows Computer Control & Settings
**Source Influence:** ULTRONMAIN (`actions/computer_settings.py`, `actions/computer_control.py`) & JARVIS-ULTIMATE (`commands.rs`)  
**Target Files:**
- `system/windows-automation.js` (ENHANCE: WMI brightness, media controls, window management)
- `system/computer-control.js` (ENHANCE: Destructive command classifier, expanded application allowlist)
- `core/tool-registry.js` (ENHANCE: Register `windows_display_brightness`, `windows_media_control`, `windows_window_manager`)

**Key Capabilities Added:**
1. **Display Brightness:**
   - Query current brightness via WMI (`Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorBrightness`).
   - Set brightness level (0-100%) via WMI (`WmiMonitorBrightnessMethods.WmiSetBrightness`).
2. **Media Playback Controls:**
   - Play/Pause toggle, Next Track, Previous Track, Stop via virtual key codes (`VK_MEDIA_PLAY_PAUSE`, `VK_MEDIA_NEXT_TRACK`, `VK_MEDIA_PREV_TRACK`).
3. **Window State Management:**
   - Minimize, Maximize, Restore, and Close active foreground window.
4. **Destructive Command Classification:**
   - Inspect command strings for destructive patterns (`rm `, `del `, `format `, `shutdown`, `Remove-Item`).
   - Elevate matching commands to `LEVEL_4_CRITICAL`, requiring explicit user confirmation tokens.

---

### 2.3 Module C: Unified Multilingual Neural Speech (Edge-TTS + Kokoro)
**Source Influence:** ULTRONMAIN (`core/tts.py`, `core/stt.py`)  
**Target Files:**
- `voice/edge-tts-adapter.js` (NEW: Lightweight Node.js Edge-TTS client for neural Hindi & English)
- `voice/voice-engine.js` (ENHANCE: Integrate Edge-TTS profiles alongside Kokoro)
- `core/tool-registry.js` (ENHANCE: Voice tool execution mapping)

**Key Capabilities Added:**
1. **Multilingual Neural Speech Profiles:**
   - `hindi_madhur`: `hi-IN-MadhurNeural` (Natural male Hindi voice)
   - `hindi_swara`: `hi-IN-SwaraNeural` (Natural female Hindi voice)
   - `english_christopher`: `en-US-ChristopherNeural` (Authoritative English voice)
   - `english_ryan`: `en-GB-RyanNeural` (Refined British voice)
2. **Zero-API-Key Operation:** High-speed streaming synthesis using free Edge endpoints without paid subscriptions.
3. **Offline Fallback:** Automatic failover to local `KokoroEngine` (`am_onyx`, `bm_lewis`) when offline.
4. **Single-Stream Audio Guard:** Ensures only one audio output stream plays at any given instant with media ducking.

---

### 2.4 Module D: Enhanced Hardware Telemetry & Monitoring
**Source Influence:** ULTRONMAIN (`actions/system_monitor.py`)  
**Target Files:**
- `system/computer-control.js` (ENHANCE: GPU, temperature, uptime, detailed RAM telemetry)
- `core/tool-registry.js` (ENHANCE: `system_hardware_monitor` tool)

**Key Capabilities Added:**
1. **GPU Utilization & VRAM:** Query GPU model, utilization, and memory via PowerShell WMI (`Win32_VideoController`) with zero external DLL requirements.
2. **Memory Pressure Detection:** Real-time RAM monitoring calibrated for 8 GB RAM with automatic background process throttling when memory exceeds 85%.
3. **Power & Battery Health:** Real-time charging status, remaining capacity percentage, and estimated battery runtime.

---

### 2.5 Module E: Advanced Browser Automation & URL Normalization
**Source Influence:** ULTRONMAIN (`actions/browser_control.py`)  
**Target Files:**
- `integrations/browser-automation-helper.js` (NEW: URL normalizer, profile detector, anti-SSRF validator)
- `core/tool-registry.js` (ENHANCE: Browser navigation tool validation)

**Key Capabilities Added:**
1. **Intelligent URL Normalization:** Automatically resolves bare terms (e.g., `"github"` -> `"https://github.com"`, search terms -> `"https://duckduckgo.com/?q=..."`).
2. **Localhost & SSRF Protection:** Blocks private subnet requests (`127.0.0.1`, `10.0.0.0/8`, `192.168.0.0/16`, `169.254.169.254`).
3. **Chrome Profile Discovery:** Safe read-only detection of user profile directories on Windows without locking default databases.

---

## 3. Measurable Acceptance Criteria

Every integrated feature must satisfy strict verification criteria on the live workstation:

| Feature | Acceptance Target | Verification Command / Suite | Pass Criterion |
|---|---|---|---|
| **Companion Lifecycle** | Position persistence & anchoring | `node --test tests/desktop-companion-manager.test.js` | Coordinates restored, clamped within display bounds |
| **Display Brightness** | WMI Brightness adjustment | `node --test tests/windows-hardware-control.test.js` | Returns valid level (0-100%) or simulated success |
| **Media Controls** | Play/Pause/Skip dispatch | `node --test tests/windows-hardware-control.test.js` | Successful dispatch of virtual media keys |
| **Edge-TTS Neural Voices** | Hindi/English voice synthesis | `node --test tests/edge-tts-adapter.test.js` | Produces valid audio buffer for Hindi & English text |
| **Hardware Telemetry** | CPU, RAM, GPU, Battery report | `node --test tests/system-telemetry-enhanced.test.js` | Contains CPU %, RAM %, GPU info, Battery % |
| **URL Normalization** | Bare query & anti-SSRF check | `node --test tests/browser-automation-helper.test.js` | Bare words expanded; SSRF URLs blocked |
| **Destructive Command Gate** | `rm`, `del`, `format` blocked | `node --test tests/windows-command-security.test.js` | Level 4 confirmation token required |
| **Syntax Verification** | All repository files clean | `npm run check` | 0 syntax errors across all modules |
| **Security Audit** | SAST, SCA, Secret scan clean | `npm run security:report` | 0 vulnerabilities, 0 secrets, Gate PASSED |

---

## 4. Rollback & Risk Containment

1. **Dedicated Branch:** All work proceeds on `feat/ultron-combined-best-of-both-integration`.
2. **Zero Modification to Core DB:** No destructive Supabase migrations; memory schemas are purely additive.
3. **Deployment Prohibition:** No code is pushed to remote `main`, and no deployment to Render is triggered.
