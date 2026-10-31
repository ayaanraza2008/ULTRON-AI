# ULTRON AI — Universal System Architecture Blueprint

> **Universal Architecture Reference for Antigravity, Claude Code, and OpenAI Codex**  
> Target Ecosystem: **GitHub (`ayaanraza2008/ULTRON-AI`) × Supabase (`opdjfhwepmcprbqojpat`) × Render (`ULTRON CORE`)**

---

## 1. Architectural Overview

ULTRON AI is engineered as an enterprise-grade, resilient, multi-agent AI runtime. It decouples the core API, background processing, client interfaces, and multi-provider intelligence into distinct, independently scalable modules.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             CLIENT INTERFACES                               │
│  ┌────────────────────────┐  ┌───────────────────────┐  ┌────────────────┐  │
│  │ Ultron Core Interface  │  │   Android Companion   │  │Windows Companion│ │
│  │ (PWA on Render)        │  │   (Local Wake-Word)   │  │(Local Status)  │  │
│  └────────────────────────┘  └───────────────────────┘  └────────────────┘  │
└─────────────────────────────────────┬───────────────────────────────────────┘
                                      │ HTTPS / JWT Auth
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          RENDER CLOUD ENVIRONMENT                           │
│                          (Workspace: ULTRON CORE)                           │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                        ultron-ai-core                               │   │
│   │  ┌──────────────────────┐  ┌──────────────────┐  ┌────────────────┐ │   │
│   │  │   Express API Server │  │  Agent Runtime   │  │ Network Safety │ │   │
│   │  │   (server.js)        │  │ (agent-runtime)  │  │ (DNS-Pinned)   │ │   │
│   │  └──────────────────────┘  └──────────────────┘  └────────────────┘ │   │
│   │  ┌──────────────────────┐  ┌──────────────────┐  ┌────────────────┐ │   │
│   │  │  Autonomy Policy     │  │ Cognitive Memory │  │ AI Employees   │ │   │
│   │  │  (Risk Gate)         │  │ Vault Manager    │  │ Catalog Router │ │   │
│   │  └──────────────────────┘  └──────────────────┘  └────────────────┘ │   │
│   └───────────────────────────────────┬─────────────────────────────────┘   │
│                                       │                                     │
│   ┌─────────────────────────────────┐ │ ┌───────────────────────────────┐   │
│   │       ultron-rea-gateway        │ │ │   ultron-browser-use-core     │   │
│   │   (REA Integration Service)     │ │ │   (Browser Automation)        │   │
│   └─────────────────────────────────┘ │ └───────────────────────────────┘   │
│                                       │                                     │
│   ┌───────────────────────────────────▼─────────────────────────────────┐   │
│   │                      Background Task Worker                         │   │
│   │       (worker.js: Polled Queue with Exponential Backoff)            │   │
│   └───────────────────────────────────┬─────────────────────────────────┘   │
└───────────────────────────────────────┼─────────────────────────────────────┘
                                        │
             ┌──────────────────────────┴──────────────────────────┐
             ▼                                                     ▼
┌─────────────────────────────────────────┐  ┌─────────────────────────────────┐
│           SUPABASE PROJECT              │  │      EXTERNAL PROVIDERS         │
│     (Ref: opdjfhwepmcprbqojpat)         │  │   (Secured via Server Keys)     │
│                                         │  │                                 │
│  • Auth Engine (OAuth, Email, Sessions) │  │  • OpenRouter (Free models)     │
│  • PostgreSQL with Row Level Security   │  │  • Secondary Fallback Providers │
│    - conversations & messages           │  │  • Tavily Web Research          │
│    - user_preferences                   │  │  • Document Parsing Engines     │
│    - memory_items (Vault)               │  │  • TTS / STT Voice Adapters     │
│    - agent_tasks & audit_events         │  │                                 │
│  • Storage (ultron-private-documents)   │  │                                 │
└─────────────────────────────────────────┘  └─────────────────────────────────┘
```

---

## 2. Request Lifecycle & Execution Pipeline

1. **Ingress & TLS Termination:** Requests enter via Render's managed reverse proxy at `https://ultron-ai-core.onrender.com`.
2. **Session & Security Validation:**
   - Pre-flight headers verified against strict CORS and CSP policies.
   - Authentication checked: caller must present a valid Supabase JWT or access session.
   - Missing or expired tokens are refreshed or rejected prior to downstream processing.
3. **Network Safety Gate (`network-safety.js`):**
   - All outbound network calls must pass DNS resolution pinning to defend against DNS-rebinding and SSRF attacks.
   - Non-routable IP ranges (RFC 1918, RFC 3927 loopback, multicast, link-local, `.example` domains) are blocked.
4. **Agent Runtime Execution (`agent-runtime.js`):**
   - User prompt is augmented with opt-in memory context retrieved from `memory_items`.
   - Tool intent is evaluated against the `autonomy-policy.js` risk matrix:
     - **Low Risk (Auto-Execute):** Read-only information retrieval, data formatting, internal drafts.
     - **High Risk (Confirmation-Gated):** Code execution, messaging, publishing, credential operations, file system modifications.
5. **Multi-Provider Fallback Dispatch:**
   - Dispatches prompt to primary OpenRouter model (`openrouter/free`).
   - If rate-limited (HTTP 429), unavailable (HTTP 5xx), or if payload is malformed, falls back to secondary registered models in `ULTRON_MODEL_PROVIDERS_JSON`.
6. **Persistence & Auditing:**
   - Conversation turns are written to `messages` and parent `conversations` updated.
   - High-risk decisions and approvals are recorded in `audit_events`.
   - Result is streamed or returned back to the client.

---

## 3. Database Architecture & Row Level Security (RLS)

All tables exist in the `public` schema of Supabase project `opdjfhwepmcprbqojpat` and strictly enforce RLS:

| Table | Primary Purpose | RLS Policy Rule |
|---|---|---|
| `conversations` | Conversation container | `user_id = auth.uid()` for SELECT, INSERT, UPDATE, DELETE |
| `messages` | Chat message records | `user_id = auth.uid()` AND conversation owner matches |
| `user_preferences` | User language, voice, settings | `user_id = auth.uid()` |
| `memory_items` | Long-term memory vault | `user_id = auth.uid()` |
| `agent_tasks` | Asynchronous job state | `user_id = auth.uid()` |
| `audit_events` | Immutable security log | `user_id = auth.uid()`, read & insert only |
| `documents` | Private document metadata | `user_id = auth.uid()`, no client UPDATE |

### Storage Bucket:
- **Bucket ID:** `ultron-private-documents`
- **Security:** Private (non-public), max 5 MiB file size cap.
- **Paths:** UUID-scoped storage paths tied to verified user IDs.
- **Integrity:** SHA-256 and size verification required on download.

---

## 4. Background Asynchronous Worker (`worker.js`)

The background worker handles deferred, long-running agent operations:
- **Polling Loop:** Configured via `ULTRON_WORKER_POLL_MS` (default 5,000 ms).
- **Allowed Task Types:** Research summaries, AI Employee drafts, bounded report generation.
- **Safety Boundary:** Does **not** execute arbitrary shell commands or access host OS files directly.
- **Retry Mechanism:** Exponential backoff with stale task recovery (`recover_stale_running_tasks`).
- **Gating:** Tasks in `WAITING_FOR_PERMISSION` cannot transition to `RUNNING` without a verified `/api/tasks/:id/approve` action from the owning user.

---

## 5. Render Service Topology (`ULTRON CORE`)

The production deployment runs within the **`ULTRON CORE`** Render workspace:

1. **`ultron-ai-core` (Primary API):**
   - Node.js runtime, starts via `npm start`.
   - Health check path: `/api/health`.
   - Environment variables: `NODE_ENV=production`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (sync: false), `OPENROUTER_API_KEY` (sync: false).
2. **`ultron-rea-gateway` (REA Integration):**
   - Express service bridging real estate and valuation intelligence.
3. **`ultron-browser-use-core` / `ultron-browser-use`:**
   - Python FastAPI runtime (`uvicorn main:app`) running Browser Use automation bridge with model proxy.
4. **`ultron-core-interface` (Frontend PWA):**
   - Independent service serving the Living Core UI and PWA shell at `https://ultron-core-interface.onrender.com`.
5. **`ultron-world-intelligence`:**
   - 3D geospatial visualization bridge based on God's Eye View with pinned source hash.

---

## 6. Multi-Agent Development Integration

The three authorized coding agents coordinate development of this architecture:

- **Google Antigravity:** Navigates architecture, conducts exploration, and prototypes frontend / client bridges.
- **Claude Code:** Architects backend services, hardens network and security layers, and refactors core logic.
- **OpenAI Codex:** Generates regression suites, conducts automated code reviews, and verifies CI compliance.
