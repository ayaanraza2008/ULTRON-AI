# ULTRON AI — Mobile Control Subsystem Architecture

## 1. Architectural Overview

```mermaid
flowchart TD
    User([User Prompt / Voice / HUD]) --> Router[Autonomous Orchestrator / Jarvis Router]
    Router --> MobileAgent[Mobile Task Agent]
    
    subgraph Brain ["ULTRON Cognitive Layer"]
        MobileAgent --> Planner[Mobile Task Planner]
        Planner --> DAG[Execution DAG]
        MobileAgent -.-> Vision[UltronVision / Multimodal Perception]
    end

    subgraph Security ["Security & Gatekeeper"]
        DAG --> PermEngine{Permission Engine}
        PermEngine -->|Level 1-2 Approved| Engine[Mobile Control Engine]
        PermEngine -->|Level 3-4 Sensitive| Gate[Confirmation Gate]
        Gate -->|Require Human Auth| Token[Generate Single-Use UUIDv4 Token]
        Token --> UserModal[HUD Confirmation Modal 60s]
        UserModal -->|Authorize| Engine
        UserModal -->|Deny/Timeout| Reject[Halt & Log Audit]
    end

    subgraph Execution ["Execution Engines"]
        Engine -->|Primary| MCP[MobileMcpClient JSON-RPC 2.0]
        Engine -->|Resilient Fallback| ADB[Native AdbBridge adb.exe]
    end

    subgraph Device ["Target Device"]
        MCP --> Hardware[Android Phone / Emulator / Wireless TCP]
        ADB --> Hardware
    end

    Hardware -->|Screen Capture Frame| Vision
    Vision -->|Scene Summary & OCR| Router
```

---

## 2. Detailed Data Flow

### A. Action & Automation Flow
```
1. Operator submits goal: "Open YouTube on phone and search for quantum computing"
2. Intent Analysis:
   - Brain detects domain: "INTEGRATIONS"
   - Intent classified: "MOBILE_DEVICE_CONTROL"
   - Assigned Agent: AGENT_ROLES.MOBILE_DEVICE_AGENT ("mobile-device-agent")
3. Task Planning:
   - MobileTaskPlanner resolves "youtube" -> "com.google.android.youtube"
   - Plans 4 DAG stages:
     * Stage 1: mobile_launch_app ("com.google.android.youtube")
     * Stage 2: mobile_list_elements_on_screen (find search box)
     * Stage 3: mobile_type_keys ("quantum computing")
     * Stage 4: mobile_press_button ("ENTER")
4. Permission Evaluation:
   - Level 2 actions (launch non-sensitive app, type, enter) permitted under Autonomy Level 2
   - Sensitive package shield verifies YouTube is not financial or messaging
5. Pre-Action Assertion:
   - Control engine records foreground app before launch
6. Execution:
   - Dispatches via Mobile MCP or Native ADB
7. Post-Action Assertion:
   - Dumpsys query verifies foreground package equals "com.google.android.youtube"
8. Verification & Briefing:
   - Agent synthesizes natural JARVIS summary and updates HUD
```

---

## 3. Multimodal Perception Flow

```mermaid
sequenceDiagram
    participant User as Operator
    participant Agent as Mobile Task Agent
    participant Engine as Mobile Control Engine
    participant Device as Android Device (ADB)
    participant Vision as UltronVision Model

    User->>Agent: "Take a screenshot and tell me what is on screen"
    Agent->>Engine: captureScreen(deviceId)
    Engine->>Device: screencap -p (PNG Buffer)
    Device-->>Engine: Base64 PNG Frame
    Engine-->>Agent: { success: true, data: "iVBORw..." }
    Agent->>Vision: understandImage(dataUrl, prompt)
    Vision-->>Agent: { description: "Active Settings menu showing Wi-Fi connected to Home_5G" }
    Agent-->>User: "Sir, your phone screen shows the Settings menu with Wi-Fi connected to Home_5G."
```
