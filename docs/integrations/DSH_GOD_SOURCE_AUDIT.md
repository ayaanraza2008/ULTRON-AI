# ULTRON AI — DSH-GOD Complete Source Audit Report

## 1. Provenance & Upstream Metadata

- **Source Repository:** `https://github.com/crackerghost/DSH-GOD`
- **Target Repository:** `https://github.com/ayaanraza2008/ULTRON-AI`
- **Audited Commit Hash:** `c67271f42141dc1afc5d371e313ead7b8e35bfdd`
- **Release Version:** `2.7.3`
- **Original Authors & Contributors:** crackerghost, Ebony-Vinyl, Jet, yetone
- **License:** MIT License (Full attribution preserved in `integrations/dsh-god/license-registry.js`)
- **Integration Target Path:** `integrations/dsh-god/`

---

## 2. Architectural Subsystem Audit

### A. Provider Registry (`src/providers/registry.json`)
- **Inventory:** 76 catalog providers spanning major model labs, aggregators, cloud hosts, and local runners.
- **Wire Formats:** `openai-chat`, `openai-responses`, `anthropic-messages`.
- **Authentication Kinds:** `apiKey`, `none` (keyless/local), `oauth`, `adc`.
- **Categories:** `apikey`, `free`, `free-tier`, `local`, `oauth`.
- **Denied Channels Policy:** `workbuddy`, `codebuddy`, `huaweicloud` excluded at registry resolution boundary to protect user security and adhere to upstream policy.

### B. OpenCode Zen / Free Lane (`src/upstream.js`)
- **Target Endpoint:** `https://opencode.ai/inference/v1`
- **Gate Fingerprint (v2):** User-Agent `opencode/latest/2.0.26/cli`
- **Headers:** `x-session-id`, `x-opencode-session-id`, `x-session-affinity` (must not send legacy v1 `x-opencode-request`).
- **Session ID Encoding:** 48-bit inverted descending hex `~(ts_ms << 12 | counter)` with counter 1–63 (low 12 bits `0xfc0–0xfff`). Ascending or sha256 timestamps trigger 403 FreeTierError.
- **Tool Decoys:** Injects official `read` and `shell` tool schemas verbatim. Suppresses `tool_choice: "none"`.

### C. Kilo AI Free Pool (`src/kilo.js`)
- **Target Endpoint:** `https://api.kilo.ai/api/gateway`
- **Model Listing:** `GET /models` filtered by `isFree: true`.
- **Completion Wire:** `POST /chat/completions` OpenAI-compatible format.
- **Privacy Policy:** Requires explicit disclosure that prompts sent to the free pool may be logged by upstream providers for model training.

### D. Virtual Combo Router (`src/combos.js`)
- **Routing Strategies:** `fallback`, `round-robin`, `smart`, `usage`, `pace`.
- **Capability Intersection:** Enforces that a virtual combo's context window is `Math.min(...)` across candidate models, and vision/tool flags are strictly `false` if any candidate lacks support.
- **Sticky Turns:** Bounded sticky cursor for round-robin rotation.

### E. RTK Token Optimizer (`src/token-saver.js`)
- **Filters:**
  - `gitDiff`: Hunk truncation (capping hunks at 100 lines), file header and summary (+x -y) retention.
  - `gitStatus`: Compacts long or porcelain status into count summaries.
  - `gitLog`: Omits commit bodies while retaining commit hash, author, date, and subject.
  - `grep`: Match caps per file (10) and total matches.
  - `directoryListing`: Strips noise directories (`node_modules`, `.git`, `__pycache__`, `.venv`, `.next`, etc.).
  - `smartTruncate`: Keeps 120 head lines and 60 tail lines for large outputs (>250 lines).
- **Prompt Shaping:** Caveman (concise bullet mode) and Ponytail (architecture-first diff mode).
- **Accounting:** Real-time and cumulative token savings metrics.

### F. Universal Gateway Listener (`src/forward.js`)
- **Local Listener:** Configurable port (default `8080`), toggleable LAN (`0.0.0.0`) access.
- **Protocols Supported:**
  - `GET /v1/models` (OpenAI format catalog)
  - `POST /v1/chat/completions` (OpenAI format completion)
  - `POST /v1/responses` (OpenAI responses format)
  - `POST /v1/messages` (Anthropic messages wire)
  - `POST /v1/messages/count_tokens` (Anthropic token count)
- **Tool Hygiene:** Renumbers `tool_calls[].index` from 0 and suppresses internal `read`/`shell` decoys.

### G. 10 Standalone Account Channels (`vendor/channel-pack`)
- **Channels:** LobsterAI, Qoder, Qoder China, TRAE, Cline, Loomy, Raccoon, MiniMax Code, ZCode, Gemini Channel.
- **Implementation:** Pure JavaScript adapter framework without heavy binary dependencies.

### H. Hardware Budget & Binary Exclusion (`vendor/magpie`)
- **Host Hardware Profile:** AMD Ryzen 7 5700U (8 Cores, 16 Threads, 8 GB System RAM).
- **Architectural Decision:** The 68MB embedded Magpie binary (`vendor/magpie/bin/magpie-win32-x64.exe`) was excluded from execution to prevent RAM starvation and CPU contention. ULTRON runs pure Node.js ES modules with strict memory budgeting.
