# ULTRON AI — COMPLETE ARCHITECTURE STATUS
## JARVIS × ULTRON HYBRID INTELLIGENCE OPERATING SYSTEM
**Evaluation Date:** 2026-11-01T01:55:00+05:30  
**Head Commit:** `2b4cfceff0eb0daee47e279dc3709e6022295676` (`2b4cfcef`)  
**Repository:** `ayaanraza2008/ULTRON-AI`  
**Active Working Branch:** `feat/ultron-cyber-core`  
**Pull Request:** [PR #440](https://github.com/ayaanraza2008/ULTRON-AI/pull/440)

---

## 1. HIGH-LEVEL ARCHITECTURAL TOPOLOGY

ULTRON AI operates as an integrated personal AI operating system combining the proactive intelligence, voice synthesis, and visual reasoning of Iron Man's JARVIS with the autonomous task planning, multi-agent coordination, and defensive security posture of Marvel's ULTRON.

```
                           +----------------------------------------+
                           |       OPERATOR & CLIENT SURFACES       |
                           |   Cyber-HUD UI · AudioWorklet · PWA    |
                           +-------------------+--------------------+
                                               |
                        +----------------------+----------------------+
                        |                                             |
            +-----------v------------+                   +------------v-----------+
            |  AUTHENTICATION & RLS  |                   |   VOICE & SENSORY HUB  |
            |  Supabase Auth (ap-s1) |                   |  Kokoro ONNX (am_onyx) |
            |  HttpOnly Session Mgmt |                   |  Web Audio Worklet     |
            |  HIBP k-Anonymity SHA1 |                   |  ULTRON EYES (Camera)  |
            +-----------+------------+                   +------------+-----------+
                        |                                             |
+-----------------------v---------------------------------------------v------------------------+
|                                    ULTRON CORE RUNTIME                                       |
|                                                                                              |
|  +--------------------+  +--------------------+  +--------------------+  +----------------+  |
|  |    BRAIN ROUTER    |  |  MULTI-AGENT DAG   |  |   AUTONOMOUS WORKER|  | COGNITIVE VAULT|  |
|  | Model Chain Routing|  | 18 Specialist Agents| | 11-Stage Lifecycle |  | RLS Scoped Mem |  |
|  | Heuristic Intent   |  | Kahn Cycle Detect  |  | Lease Renewal Fence|  | Short-term Buf |  |
|  | Provider Fallback  |  | Dead-Letter Queue  |  | Exp. Backoff Retry |  | Deduplication  |  |
|  +--------------------+  +--------------------+  +--------------------+  +----------------+  |
|                                                                                              |
|  +--------------------+  +--------------------+  +--------------------+  +----------------+  |
|  |     CYBER CORE     |  |   QUALITY GATE     |  |   WINDOWS AGENT    |  | CODING SANDBOX |  |
|  | Target Auth Gateway|  | SAST (14 CWE Rules)|  | Parameterized Exec |  | Fail-Closed    |  |
|  | Latching E-Stop    |  | Host npm audit SCA |  | Allowlisted Apps   |  | VM Script Isol |  |
|  | Red-Team Evaluator |  | Zero-Ret. Secrets  |  | Secure UUID Token  |  | Container Gate |  |
|  +--------------------+  +--------------------+  +--------------------+  +----------------+  |
+----------------------------------------------------------------------------------------------+
```

---

## 2. SUBSYSTEM ARCHITECTURAL BREAKDOWN

### A. Core Brain & Model Gateway
- **Modules:** `core/brain-router.js`, `core/ultron-core.js`, `scripts/model-provider-smoke.mjs`
- **Routing Engine:** Multi-tier fallback chain spanning primary cloud models (Groq, OpenRouter), local inference runtimes (Cactus), and loopback deterministic safety handlers.
- **Provider Health:** Dynamically monitors response latency, timeouts, and rate limits. Fails over automatically when an upstream provider encounters an outage.
- **Intent Classifier:** Heuristic-based regex classification parsing complexity, domains (coding, vision, cyber, general), and user preferences before token dispatch.

### B. ULTRON EYES (Sensory Perception Pipeline)
- **Modules:** `vision/ultron-eyes-manager.js`, `vision/ultron-vision.js`, `public/ultron-eyes.js`
- **Device Synchronization:** Client browser enumerates genuine hardware video inputs via `navigator.mediaDevices.enumerateDevices()` and synchronizes metadata to `/api/jarvis/eyes/devices/sync`.
- **Consent & Session Management:** User must explicitly grant camera consent before video capture starts; visible camera preview and active HUD pills indicate live recording.
- **Production Truthfulness:** Synthetic objects, fake bounding boxes, and mock OCR text are purged from production paths. Without a configured multimodal provider, it returns `BLOCKED_NO_VISION_PROVIDER`.

### C. Voice AI & Multilingual Speech Synthesis
- **Modules:** `voice/kokoro-engine.js`, `features.js`, `voice/wake-word.js`, `voice/windows-speech-daemon.js`
- **Kokoro-82M ONNX:** Local CPU-based neural TTS utilizing `kokoro-v0_19.onnx` with the deep authoritative `am_onyx` persona at 0.95x speed. Real-Time Factor benchmarked at ~0.35x on AMD Ryzen 7 5700U.
- **Multilingual Support:** Natural speech across Hindi, English, and Hinglish. Forced English restriction removed in PR #437.
- **Dual Activation & Interruption:** Web Audio Worklet bandpass & transient energy detector for hands-free wake word. Low-latency barge-in aborts active audio playback in 2.2ms.

### D. Multi-Agent Orchestration & Worker Queue
- **Modules:** `agents/catalog.js`, `agents/orchestrator.js`, `worker.js`, `scripts/worker-smoke.mjs`
- **18 Specialized Agents:** Full schemas covering research, coding, security, data analysis, planning, executive operations, and media generation.
- **Topological DAG:** Upfront Kahn's cycle detector guarantees zero deadlock or circular dependency traps before execution.
- **11-Stage Worker Machine:** Tasks transition through `QUEUED`, `CLAIMED`, `RUNNING`, `VALIDATING`, `COMPLETED`, `FAILED`, and `RETRYING` with attempt fencing to prevent race conditions.

### E. Defensive Security Quality Gate & Cyber Core
- **Modules:** `security/code-shield.js`, `security/secret-scanner.js`, `security/target-authorization-gateway.js`, `security/cyber-web.js`, `security/cyber-ai-redteam.js`
- **Target Authorization Gateway:** Enforces cryptographic scope proofs. Strictly rejects unapproved, remote, or out-of-scope targets.
- **Latching Emergency Stop:** Immediate, cluster-wide shutdown halting all agent execution and background processes.
- **Static Application Security Testing (SAST):** Scans 159 files across 14 CWE rules (command injection, SQLi, XSS, path traversal, unsafe file writes, SSRF, prototype pollution, crypto, tokens).
- **Software Composition Analysis (SCA):** Genuine host `npm audit --json` verified on 94 production dependencies (0 vulnerabilities).
- **Zero-Retention Secret Detection:** Scans files and Git commits. Redacts all sensitive keys with SHA-256 fingerprints before logging.

### F. Windows Companion & Device Integration
- **Modules:** `system/windows-desktop-agent.js`, `system/computer-control.js`, `system/windows-automation.js`, `integrations/desktop-companion.js`
- **Parameterized Execution:** Dynamic shell string concatenation eliminated; safe `execFile` array passing enforces strict boundary isolation.
- **Allowlisted Launching:** Restricted to predefined binaries (`notepad.exe`, `calc.exe`, `explorer.exe`, `wt.exe`, `cmd.exe`, `msedge.exe`).
- **Paired Companion Token:** Uses cryptographically secure `crypto.randomUUID()` for companion daemon authentication.

---

## 3. HARDWARE PROFILE & RESOURCE BOUNDARIES

- **Processor:** AMD Ryzen 7 5700U (8 Cores, 16 Threads)
- **Graphics:** Integrated AMD Radeon Graphics (Pure CPU inference, Zero mandatory CUDA)
- **Memory Footprint:** Fully optimized for 8 GB RAM; capped stream readers prevent unbounded memory consumption.
- **Storage:** 512 GB SSD; zero heavy automatic multi-gigabyte model downloads.
