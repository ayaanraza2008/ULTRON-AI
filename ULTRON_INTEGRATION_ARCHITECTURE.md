# ULTRON ETERNAL — Universal Integration Architecture Blueprint

> **Codename:** ULTRON ETERNAL  
> **Source Engine:** `https://github.com/AbuZar-Ansarii/Ultron` (Mark-LV / ULTRON Python Desktop Engine)  
> **Destination Ecosystem:** `https://github.com/ayaanraza2008/ULTRON-AI` (ULTRON Autonomous Multi-Agent Runtime)  
> **Target Machine Profile:** AMD Ryzen 7 5700U (8 cores / 16 threads), Radeon Graphics, 8 GB RAM, 512 GB SSD, Windows 11  
> **Architectural Paradigm:** Decoupled Headless Node.js Core + On-Demand Python Capability Runtime + Living Energy Core PWA HUD + .NET 8 Windows Companion  

---

## 1. Executive Architectural Topology

ULTRON ETERNAL integrates all compatible, high-utility capabilities from the monolithic Python source repository into the modular, multi-agent Node.js assistant ecosystem. Rather than transplanting incompatible PyQt6 desktop loops or unsafe raw Python execution into the core server process, the system employs an **isolated, on-demand RPC capability gateway**.

```mermaid
flowchart TD
    subgraph Client Interfaces
        PWA["Living Energy Core Cyber-HUD (Web PWA / SSE)"]
        WIN["Windows Companion (.NET 8 WPF System Tray)"]
        MOB["Android Companion (Mobile MCP / Signed Pairing)"]
    end

    subgraph Node.js Core Ecosystem ["ULTRON Core (Node.js 20+ / Express)"]
        SERVER["server.js (Express API Gateway)"]
        ROUTER["jarvis-router.js / brain-router.js"]
        ORCH["AgentOrchestrator (18-Agent DAG Engine)"]
        REGISTRY["core/tool-registry.js (59 Registered Tools)"]
        WORKER["worker.js (Autonomous Task Queue)"]
        CEREBRO_JS["knowledge/cerebro-knowledge-vault.js (TF-IDF Graph)"]
        EVOLUTION_JS["self-improvement/prometheus-evolution-engine.js"]
        MATRIX_JS["system/workspace-matrix.js (Vibranium Battle Modes)"]
    end

    subgraph Capability Gateway ["Python Capability Gateway (JSON-RPC)"]
        GATEWAY["integrations/python-capability-gateway.js"]
        RPC_ENTRY["system/python-capability-runtime/runtime_entry.py"]
    end

    subgraph Python Capability Runtime ["Isolated Python 3.12 Runtime (CPU-First)"]
        CEREBRO_PY["capabilities/cerebro_engine.py"]
        DESKTOP_PY["capabilities/desktop_controller.py (PyCAW/WMI/psutil)"]
        AIRSPACE_PY["capabilities/airspace_engine.py (Bleak / WiFi RSSI)"]
        NETWORK_PY["capabilities/network_sentinel.py (ARP / Multi-DNS)"]
        VOICE_DSP_PY["capabilities/voice_dsp_engine.py (24kHz WAV / Ultron Formant)"]
        BIOMETRIC_PY["capabilities/biometric_engine.py (Haar Cascade Face ID)"]
        GESTURE_PY["capabilities/gesture_engine.py (Spatial Minority Tracking)"]
        IOT_PY["capabilities/iot_engine.py (Tuya / Smart Life / MQTT)"]
        SANDBOX_PY["capabilities/self_evolution_sandbox.py (AST Security)"]
    end

    Client Interfaces -->|HTTPS / Supabase JWT| SERVER
    SERVER --> ROUTER
    ROUTER --> ORCH
    ORCH --> REGISTRY
    REGISTRY --> CEREBRO_JS
    REGISTRY --> EVOLUTION_JS
    REGISTRY --> MATRIX_JS
    REGISTRY --> GATEWAY
    GATEWAY -->|Authenticated On-Demand Stdio IPC| RPC_ENTRY
    RPC_ENTRY --> CEREBRO_PY
    RPC_ENTRY --> DESKTOP_PY
    RPC_ENTRY --> AIRSPACE_PY
    RPC_ENTRY --> NETWORK_PY
    RPC_ENTRY --> VOICE_DSP_PY
    RPC_ENTRY --> BIOMETRIC_PY
    RPC_ENTRY --> GESTURE_PY
    RPC_ENTRY --> IOT_PY
    RPC_ENTRY --> SANDBOX_PY
```

---

## 2. Core Architectural Pillars

### 2.1 The On-Demand Python Capability Runtime
To satisfy the strict architectural directive:
> *"The Python runtime must be optional and independently manageable. It must not make the existing backend dependent on a permanently running Python process for unrelated functions."*

The Python runtime is architected with **zero permanent daemon overhead**:
1. **Lazy Loading:** Modules (`scipy`, `bleak`, `psutil`, `comtypes`) are imported only when their specific capability is invoked.
2. **Stateless Subprocess Execution:** Invoked via `spawn` with `--stdin` streaming, 15-second execution timeout clamps, and 2MB output buffer boundaries.
3. **Pure Node.js Fallbacks:** If Python is uninstalled or temporarily offline, native Node.js implementations (e.g. `cerebro-knowledge-vault.js`, `windows-automation.js`) provide seamless continuity without crashing the core server.

### 2.2 Project Cerebro: Infinite Neural Knowledge Graph
Project Cerebro provides semantic entity linking and graph recall:
- **Corpus-Wide TF-IDF Vectorization:** Calculates term frequency and inverse document frequency across stored knowledge nodes.
- **Cosine Similarity Matching:** Ranks entities against natural language search prompts with sub-10ms response times.
- **Multi-Hop Traversal:** Breadth-first search discovers n-degree relationship pathways between entities with cycle prevention.
- **Strict User Isolation:** Storage keys and search filters enforce `userId` partitioning, preventing cross-tenant data leakage.

### 2.3 Prometheus Secure Self-Evolution Sandbox
Replaces the unsafe raw file synthesis from the source repository with a 5-stage defensive pipeline:
```
[Propose Tool Code] ──► [Stage 1: AST Analysis] ──► [Stage 2: Static Token Scan] ──► [Stage 3: Approval Gate] ──► [Stage 4: Versioned Registry] ──► [Stage 5: Automated Rollback]
```
1. **AST Parsing:** Forbids dangerous nodes (`eval`, `exec`, `__import__`, `subprocess`, `os.system`, `socket`, `fork`).
2. **Static Regex Shield:** Rejects `process.exit`, `child_process`, and unescaped shell commands.
3. **Permission Tiers:** Level 3 & 4 capabilities strictly require human confirmation tokens.
4. **Append-Only Versioning:** Tools are assigned monotonic versions (`v1`, `v2`, `v3`) in `.local/evolved_tools/`.
5. **Deterministic Rollback:** If a tool experiences runtime errors, one-click rollback restores the previous verified version immediately.

### 2.4 Vibranium Macro Protocol Engine & Workspace Matrix
Implements 7 unified operational environments:
| Mode | Display Brightness | Audio Volume | Lighting Scene | Primary Toolchain |
| :--- | :---: | :---: | :---: | :--- |
| **`FOCUS`** | 70% | 25% | Warm White (75%) | VS Code / IDE, notifications silenced |
| **`STEALTH`** | 20% | Muted | Deep Crimson (10%) | Secondary displays blanked, minimal telemetry |
| **`GAMING`** | 90% | 85% | Cyber Neon RGB | Background servers suspended, Radeon boost |
| **`CINEMA`** | 30% | 75% | Deep Red (20%) | YouTube / media player stream extraction |
| **`WAR_ROOM`** | 95% | 50% | Cyan Command Matrix | Multi-monitor dashboard & network auditor |
| **`CODING`** | 85% | 40% | Studio White | Git sentinel, terminal status, test runner |
| **`RESEARCH`**| 75% | 30% | Neutral Balanced | Multi-tab Ego Lite TaskSpaces, Cerebro logging |

---

## 3. Hardware Optimization Blueprint (AMD Ryzen 7 5700U)

To run continuously and responsively on the target AMD Ryzen 7 5700U machine:
1. **CPU-First Execution:** All AI inference and audio processing run strictly on the 8-core / 16-thread CPU. No mandatory CUDA or discrete GPU drivers are required.
2. **Memory Headroom Clamps:** Host RAM is capped at 85% utilization threshold with dynamic worker load shedding.
3. **WAV 24kHz Procedural Audio:** SFX and voice warping generate raw 16-bit PCM arrays mathematically, eliminating external audio server overhead.
4. **Subprocess Isolation:** Background worker child processes are memory-capped to 256MB.
