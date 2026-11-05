# ULTRON AI — SUPER HIGH-FI SYSTEM ARCHITECTURE SPECIFICATION

**Author:** Antigravity AI Systems Architect  
**Target Host:** AMD Ryzen 7 5700U (8C/16T), Integrated AMD Radeon Graphics, 8 GB RAM, 512 GB SSD, Windows 11  
**Repository Branch:** `feat/ultron-remaining-gaps-completion`  
**Execution Standard:** Zero-Mock, Empirical Verification, Non-Fabrication Policy  

---

## 1. Architectural Philosophy & Mission

The **ULTRON Super High-Fi Architecture** elevates ULTRON into an autonomous, multimodal personal AI operating system inspired by the practical capabilities of JARVIS. It operates under strict engineering principles:
1. **Real Execution over Simulation:** Tools and integrations perform real work; when an environment or dependency is missing, the system truthfully reports `UNSUPPORTED` or `SIMULATED` rather than fabricating success.
2. **Hardware Harmony:** Zero CUDA dependencies, zero multi-gigabyte forced model downloads. Engineered for low idle CPU (< 1%) and controlled RAM (< 400 MB server process) on 8 GB host memory.
3. **Multi-Tier Security & Trust:** Non-bypassable 4-tier permission gates, human confirmation tokens with anti-replay protection for sensitive operations, zero-retention secret masking, and strict sandboxing.
4. **Multimodal Cohesion:** Unified sensory inputs (vision frames, audio streams, text, system vitals) routed through an intelligent DAG orchestrator.

---

## 2. Core Architecture Topology

```
┌────────────────────────────────────────────────────────────────────────┐
│                        USER & CLIENT INTERFACES                        │
│   Web HUD (Particle Swarm) │ Native Win32 Companion │ Android ADB Client│
└────────────────────────────────────┬───────────────────────────────────┘
                                     │
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        UNIFIED INGRESS & ROUTING                       │
│      Express 4.21 Gateway │ Rate Limiting │ Account Isolation Guard    │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│                       CENTRAL INTELLIGENCE ENGINE                      │
│  BrainRouter (Multi-Provider Routing: Groq, Gemini, Cerebras, CPU)     │
│  Complexity Classifier │ Language Detection │ Hallucination Evaluator  │
│  Circuit Breakers & Token Telemetry (Usage Accounting)                 │
└──────────────────┬─────────────────┬─────────────────┬─────────────────┘
                   │                 │                 │
                   ▼                 ▼                 ▼
┌──────────────────────┐ ┌──────────────────────┐ ┌──────────────────────┐
│ LIVING COGNITIVE MEM │ │ 11-STAGE DAG ORCHEST │ │ MULTI-AGENT CATALOG  │
│ 6 Cognitive Layers   │ │ Intent Analysis      │ │ 18 Specialized Roles │
│ 45-Day Half-Life     │ │ Plan Generation      │ │ DAG Dependency Waves │
│ Reinforcement Boost  │ │ Level 1-4 Gate Check │ │ DLQ Failure Recovery │
│ Secret Sanitization  │ │ Result Verification  │ │ Checkpoint Persistence│
└──────────────────────┘ └───────────┬──────────┘ └──────────────────────┘
                                     │
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   TOOL REGISTRY & CAPABILITY ADAPTERS                  │
│  44 Schema-Validated Tools Across 7 Master Categories                  │
├────────────────────┬────────────────────┬──────────────────────────────┤
│ COMPUTER CONTROL   │ BROWSER AUTOMATION │ MULTIMODAL SENSORY           │
│ Structured Exec    │ Direct Chromium CDP│ Multilingual Voice (SAPI)    │
│ 4-Tier Hardware    │ Page Screenshot    │ Vision Pipeline (Eyes)       │
│ UltronWorkspace    │ DOM Interactions   │ 10-Gesture Recognizer        │
│ Allowlisted Binaries│ Multi-Tab Manager │ Mobile ADB MCP Bridge        │
└────────────────────┴────────────────────┴──────────────────────────────┘
```

---

## 3. Subsystem Breakdown

### 3.1 Central Intelligence & Routing (`core/brain-router.js`)
- **Multi-Provider Resilience:** Dynamically prioritizes fast low-latency models (Groq Llama 3.3, Cerebras Llama 3.1) and complex reasoning models (Gemini 2.5 Flash/Pro) with automatic CPU fallback.
- **Circuit Breakers:** Tracks consecutive failures; trips circuit breaker after 3 failures with configurable cooldown.
- **Bounded Token Telemetry:** Measures prompt and completion tokens via provider response body; falls back to character-length estimation with explicit `source: "estimated"` tag.

### 3.2 Living Cognitive Memory (`cognitive-memory.js` & `agentmemory-integration.js`)
- **6 Memory Layers:** `working`, `short_term`, `episodic`, `semantic`, `procedural`, `profile`.
- **Decay & Persistence:** Inferred memories decay with a 45-day half-life; user-approved explicit memories do not decay.
- **Lesson Extraction:** Turns user corrections into reusable procedural lessons without storing raw prompt secrets.
- **Account Isolation:** Memory queries strictly scoped to authenticated user ID with SHA-256 tenant hashing.

### 3.3 Multi-Agent Orchestration (`core/autonomous-orchestrator.js` & `agents/orchestrator.js`)
- **11-Stage Lifecycle:** Ingestion → Intent → Complexity → Model → Planning → Approval Gate → Execution → Verification → Recovery → Persist → Response.
- **DAG Execution:** Kahn's algorithm cycle detection, parallel wave dispatch, cascading skip on upstream failure.
- **Dead Letter Queue (DLQ):** 6-class failure categorization (`TIMEOUT`, `RATE_LIMIT`, `TRANSIENT_NETWORK`, `PERMISSION_DENIED`, `VALIDATION_ERROR`, `FATAL_CRASH`).

### 3.4 Real Browser Automation (`integrations/browser/ego-lite/direct-chromium-driver.js`)
- **Direct Chromium Control:** Direct DevTools WebSocket connection to host Chrome/Edge; CDP `Page.captureScreenshot`, `Input.dispatchKeyEvent`, `window.scrollBy`, multi-tab handling.
- **Redirect SSRF Defense:** Real-time CDP `Network.requestWillBeSent` and HTTP 3xx revalidation blocking loopback, RFC1918, and AWS metadata addresses.

### 3.5 Real Computer Control & Hardware Automation (`system/windows-automation.js`)
- **4-Tier Classification:** All hardware operations return `SUPPORTED_AND_VERIFIED`, `COMMAND_SENT_BUT_UNVERIFIED`, `UNSUPPORTED_HARDWARE`, or `FAILED`.
- **Structured Execution:** `execFileAsync` with allowlisted binaries; immediate rejection of shell chaining operators (`&`, `&&`, `|`, `;`, newline, `$()`, backticks).

### 3.6 Multimodal Sensory System (`voice/` & `vision/`)
- **Voice Pipeline:** Automatic language detection (Hindi, English, Hinglish), neural voice recommendation, genuine local WAV generation via Windows SAPI.
- **Vision & Gestures:** 10-gesture taxonomy (`OPEN_PALM`, `CLOSED_FIST`, `THUMBS_UP`, `THUMBS_DOWN`, `POINTING`, `PINCH`, `TWO_HAND_EXPAND`, `TWO_HAND_CONTRACT`, `SWIPE_LEFT`, `SWIPE_RIGHT`) strictly confined to harmless UI manipulation.

### 3.7 Cross-Device Intelligence (`mobile/`)
- **Mobile MCP & ADB Bridge:** Device discovery, touch dispatch, accessibility tree inspection, screenshot capture, live verified on physical OPPO CPH2127 via Wireless ADB TLS.

---

## 4. Verification Evidence Matrix

| Subsystem | Test Suite | Pass Count | Failure Count | Verified Mechanism |
| :--- | :--- | :---: | :---: | :--- |
| Intelligence Routing | `tests/brain-router.test.js` | 11 | 0 | Multi-provider fallback, token telemetry |
| Cognitive Memory | `tests/cognitive-memory.test.js` | 6 | 0 | 6 layers, 45-day decay, lesson extraction |
| Orchestration & DAG | `tests/agents-orchestrator.test.js` | 8 | 0 | Kahn's algorithm, DLQ, checkpoint persistence |
| Autonomous Tools | `tests/autonomous-intelligence-orchestrator.test.js` | 11 | 0 | 11-stage lifecycle, Level 3/4 confirmation |
| Browser CDP | `tests/browser-automation-complete.test.js` | 5 | 0 | Screenshots, multi-tab, redirect SSRF |
| Windows Control | `tests/windows-control-and-security.test.js` | 5 | 0 | 4-tier status, structured execFileAsync |
| Voice Pipeline | `tests/voice-pipeline-completion.test.js` | 5 | 0 | Hindi/Hinglish detection, local SAPI WAV |
| Native Companion | `tests/native-companion-lifecycle.test.js` | 2 | 0 | Win32 transparent window, Mutex, IPC bridge |
| Vision & Gestures | `tests/gesture-recognizer.test.js` | 4 | 0 | 10-gesture taxonomy, confidence scoring |
| Cross-Device MCP | `tests/mobile-adb-bridge.test.js` | 4 | 0 | Real ADB bridge, process parsing, sanitization |
| Security & Red-Team | `tests/cyber-ai-redteam.test.js` | 3 | 0 | Secret exfiltration probe, privilege escalation |

---

## 5. Architectural Non-Negotiables

1. **No Mock Fabrications:** When a service or device is missing, report `UNSUPPORTED_HARDWARE` or `BLOCKED_NO_PROVIDER`.
2. **Production Boundary:** No code merges to `main` without review; zero deployment to Render without explicit `DEPLOY` command.
3. **Zero Secrets in Memory:** API keys, session tokens, and passwords are unconditionally scrubbed before logging or persistence.
