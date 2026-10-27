# ULTRON frontend implementation gate: backend/API contract review

**Reviewed branch:** `main`  
**Reviewed at:** 2026-10-27  
**Purpose:** Establish the capability gate before frontend implementation. This is a source review, not a live E2E verification and not a declaration that the backend is complete.

## Repository and serving architecture

- Existing runtime is Node.js 20+ with Express (`server.js`); the existing service serves static assets from `public/`.
- The default branch has no `public/index.html`, no React/Vite entry point, and no frontend package/build configuration. Only `public/world-intelligence-bridge.js` exists in the public directory.
- Keep the existing Express API and backend implementation. A first frontend can use the existing same-origin static-serving path to avoid changing API services or introducing a separate demo.
- Deployment is intentionally deferred while current Render build/quota blockers and the existing deployment pause remain unresolved. Do not merge to `main` or trigger deployment from this branch.

## Existing API contracts found in source

All API routes below are read from the existing source. A route being present does **not** prove that its providers, credentials, database policies, worker, or downstream service are live.

| Capability | Existing routes / source contracts | Frontend treatment |
|---|---|---|
| Basic service health | `GET /api/health` | Show only returned health fields; do not infer provider availability from HTTP health alone. |
| Session / auth | `GET /api/session`; `POST /api/auth/signup`; `POST /api/auth/signin`; `POST /api/auth/signout`; resend confirmation; Google OAuth routes; phone OTP; recovery | Use cookie-based same-origin requests. Render auth errors verbatim only after safe text rendering. Never store secrets in localStorage. |
| Model discovery and chat | `GET /api/models`; `POST /api/chat` (supports JSON when `stream:false` and SSE when `stream:true`) | Real requests only. If provider/configuration fails, show the returned blocked/error state. Do not fake streaming, completion, or provider identity. |
| Conversations and history | `GET/POST /api/conversations`; `GET /api/conversations/:id/messages`; `POST /api/conversations/:id/messages` | Requires signed-in Supabase user. Only use returned conversation/message records. |
| Memory | `GET/POST /api/memory`; `PATCH/DELETE /api/memory/:id` | Requires signed-in user; deletion/update only after explicit UI confirmation. No cross-user data or mock memory. |
| Preferences | `GET/PUT /api/preferences` | Persist supported options only; handle unsupported locales or failed writes. |
| Capabilities/readiness | `GET /api/capabilities`; `GET /api/runtime/readiness`; `GET /api/worker/status` | Separate “configured” from “verified/live”. Readiness and health are indicators, not proof of provider response or task completion. |
| Autonomous tasks | `GET /api/tasks`; `GET /api/tasks/:id`; `GET /api/tasks/:id/progress`; `POST /api/tasks`; approve/cancel endpoints | Display real IDs/status/steps. Approval must send the required explicit confirmation and must never imply that approval grants arbitrary PC execution. |
| Research and coding assistance | `POST /api/research`; `POST /api/coding/assist`; allowlisted agent/runtime routes | Display returned source attribution and explicit provider errors. Research results are untrusted source material. Coding endpoint is assistance, not a verified isolated execution sandbox. |
| File/document intelligence | `POST /api/documents/extract` | Extraction is transient-only for supported text/PDF/DOCX types with bounds. Persistent upload/storage is not implemented; do not label as cloud file storage. |
| Speech | `POST /api/speech/synthesize`; `POST /api/speech/transcribe`; optional VoiceStudio routes | Browser-native speech may be used only with browser support and permission. Premium/VoiceStudio adapters are optional and must report blocked/unconfigured conditions honestly. |
| Integrations | `GET /api/integrations/catalog`; provider-specific routes; Geo-Sleuth; agent tools and desktop-companion status | Show per-adapter live status from backend. Some credentials/tools are owner-scoped; do not expose API keys. Do not surface destructive actions unsupported by existing policy. |
| System/workers | `GET /api/worker/status`; `GET /api/runtime/readiness` | Show only authorized response fields. No fabricated uptime, CPU, queue or worker metrics. |

## Known blockers and unverified capabilities

The repository's current README and development-state notes explicitly identify the following as outstanding:

1. Live text/vision provider inference depends on server-side provider credentials, quota and currently available compatible models; configuration does not prove a successful model response.
2. Supabase account login, row-level security and two-account isolation require dedicated disposable test accounts and an authorized E2E run. The opt-in isolation test is not proof until actually executed against the intended environment.
3. Real queued-task completion, retries, result retrieval and worker state require an explicit trusted-environment smoke run with a test user, server-side service-role key and a running worker.
4. Supabase leaked-password protection requires owner-side Auth configuration.
5. URL validation does not guarantee DNS-rebinding resistance unless DNS resolution is pinned/revalidated at connection time.
6. Persistent document uploads/storage, a hardened coding sandbox, a Windows PC-action runner, and live optional external-account integrations are incomplete or unverified.
7. Premium speech endpoints and VoiceStudio require compatible configured providers. A cloud service cannot reach a user's PC-local `localhost`.
8. Existing Render deploy attempts were blocked by build/pipeline quota exhaustion; logs previously returned a 503. No frontend deployment is claimed or triggered by this branch.

## UI integration rules

- Use same-origin `/api` endpoints and `credentials: "same-origin"`; use the existing cookie/session flow.
- Never put service-role keys or provider credentials in browser code.
- Sanitize untrusted backend text by using text nodes; do not inject model output with `innerHTML`.
- Avoid claiming that a message, file, approval, or task completed before a successful API response confirms it.
- Expose unsupported areas as unavailable/incomplete with a clear backend reason.
- Living Energy Core colors must be driven only by client-observed events (e.g. an active request can mean “thinking”; only a successful response can pulse “success”). It cannot claim server/worker state unless the corresponding API confirms it.
- Provide a reduced-motion / low-quality fallback and keep core rendering from blocking chat/navigation.
- A successful build, accessibility pass, backend integration tests and live deployment check remain required acceptance gates.

## Gate outcome

The source-level backend contract review is documented and the user has authorized frontend work. Implementation may proceed in an isolated feature branch. Backend capabilities listed as unverified above remain unverified and must not be re-labelled as complete to unblock the UI. Production merge/deployment remains separately gated by tests, the existing deployment pause, and resolving the Render quota/build blocker.
