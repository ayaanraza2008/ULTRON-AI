# ULTRON AI — Final Remaining Blockers & External Requirements
## Transparent Accounting of External Services, Hardware & Credentials

In strict accordance with the **No Fake 100%** directive, capabilities requiring external cloud accounts, billable API credentials, or physical hardware are transparently cataloged below:

---

### 1. External Cloud Model Inference Credentials
- **Status:** `CONFIGURED_UNVERIFIED` / `BLOCKED_EXTERNAL_DEPENDENCY`
- **Requirement:** Active API keys for OpenRouter (`OPENROUTER_API_KEY`), Groq (`GROQ_API_KEY`), or Google Gemini (`GEMINI_API_KEY`).
- **Impact:** Live cloud LLM responses require valid credentials. System gracefully falls back to local quantized inference (Cactus/Strata) or mocked responses in automated test environments.

### 2. Physical Microphone & Local Audio Stream
- **Status:** `DEVICE_VERIFIED_LOCAL_ONLY`
- **Requirement:** User microphone consent on Windows host.
- **Impact:** The public cloud deployment on Render cannot access the physical microphone of the client device directly; audio capture is mediated via the authenticated local Windows Companion or browser Web Speech API.

### 3. Binary Video Rendering Pipeline
- **Status:** `PLANNER_VERIFIED_RENDERER_EXTERNAL`
- **Requirement:** Local `ffmpeg` binary or dedicated GPU rendering worker for binary video rendering.
- **Impact:** ULTRON generates complete video production scripts, scene plans, audio prompts, and thumbnail plans. Final MP4 binary encoding requires a rendering worker.

### 4. Third-Party Self-Hosted Services
- **Status:** `ADAPTER_INTEGRATED_SERVICE_UNCONFIGURED`
- **Repositories:** HeyGem (`suifeng9203/HeyGem.ai`), ComfyUI (`Comfy-Org/ComfyUI`), Immich (`immich-app/immich`), OpenProject (`opf/openproject`), Chatwoot (`chatwoot/chatwoot`).
- **Requirement:** Separately hosted service instances and API tokens.
- **Impact:** Full schema validation and anti-SSRF client adapters are built and verified. Live service operations remain blocked until instances are deployed by the operator.
