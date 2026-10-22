# ULTRON AI

ULTRON AI is currently in a backend-only implementation phase. Frontend and Windows desktop UI work are deferred until the backend capabilities and integrations are complete and verified.



## Automatic cybersecurity skills

ULTRON automatically selects relevant defensive cybersecurity skill references when a request concerns secure coding, threat hunting, cloud/identity security, digital forensics, malware triage, compliance, attack-surface inventory, or AI-agent prompt-injection defense. Matching skill procedures are fetched on demand from [mukul975/Anthropic-Cybersecurity-Skills](https://github.com/mukul975/Anthropic-Cybersecurity-Skills), limited to three references and 10,000 characters per skill, then treated as untrusted reference data. Unrelated requests do not load security skills. The authenticated `GET /api/agent/security-skills?task=...` endpoint exposes the local selector's decision.

This is a selective runtime integration, not a vendored copy of the full upstream library. ULTRON does not automatically execute skill scripts, perform unscoped scans, exploit systems, collect credentials, or bypass approval boundaries. See [docs/CYBERSECURITY_SKILLS.md](docs/CYBERSECURITY_SKILLS.md).


## Automatic Diagram Design skill

When a request asks ULTRON to create or transform a diagram, it automatically selects a suitable diagram type and loads only the matching instructions from [cathrynlavery/diagram-design](https://github.com/cathrynlavery/diagram-design). It prefers self-contained HTML with inline SVG, preserves existing project branding where available, and avoids loading diagram references for unrelated tasks. The authenticated `GET /api/agent/diagram-skills?task=...` endpoint exposes the selector's decision. See [docs/DIAGRAM_DESIGN_SKILL.md](docs/DIAGRAM_DESIGN_SKILL.md).

## Current status

- **Repository:** `ayaanraza2008/ULTRON-AI`, default branch `main`.
- **Hosted API service:** https://ultron-ai-zvd7.onrender.com. The API health endpoint is available; model-dependent chat and integrations depend on their server-side configuration.
- **AI provider:** OpenRouter's OpenAI-compatible API, using `openrouter/free` to automatically select from currently available free models.
- **Dedicated database:** Supabase project `ULTRON-AI` in Mumbai (`ap-south-1`), project ref `opdjfhwepmcprbqojpat`. The quoted project creation cost was $0/month.
- **Database schema:** Initial migration creates conversations, messages, user preferences, user-controlled memory, agent tasks, and audit events, with Row Level Security enabled. The backend includes authenticated conversation, preference, memory CRUD, and task-record endpoints; live RLS behavior still requires end-to-end verification.
- **Isolation:** The existing `nox-ai` Supabase project was not modified.
- **Frontend status:** intentionally deferred. No web UI or Windows desktop app is built in this phase; focus is backend APIs, tools, integrations, worker reliability, and automated tests.

## Backend-only capability integration phase

Backend additions on the feature branch:

- `GET /api/capabilities`: reports configuration readiness without returning secret values.
- `GET /api/local/models` and `POST /api/local/chat`: optional Ollama-compatible local inference adapter. A cloud-hosted server cannot reach a user's PC-local `localhost`; use a future authenticated desktop bridge for that case.
- `POST /api/research`: uses Tavily when configured, otherwise a best-effort public DuckDuckGo HTML fallback. Public HTML search can break or be rate-limited; results are untrusted and need source verification.
- `GET /api/tasks`, `POST /api/tasks`, `POST /api/tasks/:id/approve`, and `POST /api/tasks/:id/cancel`: per-user task records, explicit confirmation gates, and audit events using Supabase RLS. Approval only records permission; it does **not** execute PC commands. A durable worker and scoped tools are still required.
- Cloud chat now attempts opt-in retrieval of a small set of active, user-owned memory items when account preferences permit it. Memory text is treated as untrusted context.
- `GET /api/preferences` and `PUT /api/preferences`: persist supported language, voice, memory, personality, model-provider, and voice-selection preferences per account.
- `POST /api/speech/synthesize` and `POST /api/speech/transcribe`: optional OpenAI-compatible TTS/STT adapters using server-only keys; browser-native speech remains the free fallback. Premium routes require a compatible provider and are not enabled until configured.
- `POST /api/documents/extract`: bounded text extraction for TXT, Markdown, CSV, JSON, and HTML. PDF/DOCX parsers and persistent uploads are not yet available.
- `.env.example` and `render.yaml` document optional local model, research, speech, and desktop bridge settings.

These endpoints are backend building blocks, not a claim that all requested capabilities are production-complete. Frontend build/deploy and the Windows UI are deliberately excluded from the current phase. PDF/DOCX parsing, a real background worker, coding sandbox, a Windows PC-control agent, live external-account integrations, and real provider/database end-to-end tests still require separate implementation. Premium speech endpoints need a compatible provider configuration. The frontend is intentionally deferred to the final phase. The standalone God’s Eye frontend service has been removed from the Render Blueprint; the existing Render service, if already provisioned separately, must be suspended separately to stop its running instance.

## Configuration

Copy `.env.example` to `.env` for local development and populate secrets locally. Never commit `.env`, provider keys, session secrets, or service-role keys. A Supabase publishable key may be used by a client only with appropriate authentication and RLS; privileged keys must remain server-side.

## Hosting configuration

The Render service is configured with the dedicated Supabase URL and publishable key for account sign-in and per-user chat persistence. Real AI responses require `OPENROUTER_API_KEY`; `OPENROUTER_DEFAULT_MODEL=openrouter/free` automatically selects an available free model. `APP_ACCESS_PASSWORD` is an optional legacy owner-only gate; it is not required for Supabase account login.

## Multi-model text and vision

The chat composer includes a model picker and image attachment support. The server validates selected model IDs and accepts up to two JPEG, PNG, WebP, or GIF images of up to 4 MB each. Image data is sent to the provider for that request and is not stored as image data in Supabase chat history.

OpenRouter configuration:

- `OPENROUTER_BASE_URL=https://openrouter.ai/api/v1`
- `OPENROUTER_API_KEY`: create a secret at https://openrouter.ai/keys and store it only in Render/local environment variables.
- `OPENROUTER_DEFAULT_MODEL=openrouter/free`
- `ULTRON_AVAILABLE_MODELS=openrouter/free`
- `ULTRON_VISION_MODELS` (optional): comma-separated OpenRouter model IDs with image/vision support; these are preferred automatically whenever a chat includes images.

The `openrouter/free` router automatically selects a currently available free model and filters for capabilities needed by the request, including image input where supported. ULTRON's model discovery endpoint lists free model IDs available from OpenRouter; you can also select a specific model ending in `:free`. Free models have usage/rate limits and availability may change. Check provider terms before sending sensitive content to free endpoints.

## Verification policy

Features are not described as working until the relevant tests have actually passed. Mock tests are not proof of real provider connectivity, and a successful build is not proof of production deployment.

See `docs/FEATURE_REGISTRY.md`, `docs/IMPLEMENTATION_STATUS.md`, `docs/ARCHITECTURE.md`, `docs/TECHNICAL_DECISIONS.md`, and `docs/BLOCKERS.md` for the current record.


## AI Employees-inspired role layer

A native role/routine planning layer inspired by [markfulton/ai-employees](https://github.com/markfulton/ai-employees) now includes persistent per-user schedule management and an allowlisted worker path. See [docs/AI_EMPLOYEES_INTEGRATION.md](docs/AI_EMPLOYEES_INTEGRATION.md).

- `GET /api/employees/roles`: eight role definitions and all 60 routine definitions from the upstream schedules.
- `GET /api/employees/routines?role=web-dev`: routine templates filtered by role.
- `POST /api/employees/plan`: authenticated model-backed plans/drafts/reviews/reports for a chosen role.
- `GET /api/employees/status`: non-secret scheduler readiness.
- `GET/POST /api/employees/schedules`, `PATCH/DELETE /api/employees/schedules/:id`: per-user recurring routines from the 60-entry catalog (60 minutes to 7 days). Run results are visible in `GET /api/tasks`.
- `GET /api/employees/status`: reports whether scheduling and required credentials are configured without exposing secrets.
- `GET/POST /api/employees/schedules`, `PATCH/DELETE /api/employees/schedules/:id`: manage per-user recurring routines (60 minutes to 7 days). Runs are recorded in the existing `agent_tasks` table and can be inspected with `GET /api/tasks`.

**Important:** the runtime supports recurring plans/drafts/reviews/reports, not arbitrary external actions. It does not execute PC commands, send messages, publish posts, submit forms, or spend money. Apply `supabase/migrations/20261022160000_ai_employee_scheduler.sql` and configure the server-only `SUPABASE_SERVICE_ROLE_KEY`, `OPENROUTER_API_KEY`, and `ULTRON_EMPLOYEES_ENABLED=true` in Render to enable the worker. Without these, schedule records can be managed but scheduled execution will not run.


## Harness engineering runtime

ULTRON now applies task-aware harness-engineering guidance automatically in its backend agent loop, based on patterns from [ai-boost/awesome-harness-engineering](https://github.com/ai-boost/awesome-harness-engineering). It classifies software-change, research, multi-step, memory/context, and consequential-action tasks, and applies verification, checkpoint, source-quality, and safety guidance without requiring the user to select tools. See [docs/HARNESS_ENGINEERING.md](docs/HARNESS_ENGINEERING.md). The source repository is a curated resource list, not a ready-to-install runtime dependency; this integration implements selected principles and does not copy the whole list.

## Automatic tool routing

The authenticated `POST /api/agent/run` endpoint lets ULTRON select bounded tools from the user's request. `GET /api/agent/tools` lists readiness without exposing credentials. Available tools include public web research, AI Employee planning/drafting, coding assistance, integration readiness, live ComfyUI status, optional OmniVoice speech, optional HeyGem talking-avatar jobs, optional Handy desktop transcription, and explicitly confirmed ComfyUI workflow submission.

Example request body:

```json
{ "prompt": "Research the latest developments in open-source voice models" }
```

The endpoint requires a signed-in Supabase user. Model-selected tool calls are validated server-side; web results are treated as untrusted input. Plans and code remain drafts. Explicitly requested background AI Employee tasks are automatically queued when the worker and storage are configured; they are limited to draft-only plans, reviews, and reports. ComfyUI generation requires the exact workflow to be attached and `confirmExternalAction: true`. HeyGem requires `media.imageBase64` and `media.audioBase64`; Handy requires `audioBase64` and a reachable authenticated desktop bridge. OmniVoice, HeyGem, and Handy require explicit compatible endpoint paths and working external services. Readiness does not imply those services are deployed or live-verified. This API is a backend capability; a user-facing frontend is still deferred.


## Automatic scientific research skills

ULTRON classifies scientific requests and selectively loads relevant procedures from [K-Dense Scientific Agent Skills](https://github.com/K-Dense-AI/scientific-agent-skills), such as literature lookup, scientific writing, statistics, experimental design, data analysis, visualization, and selected domain workflows. Only up to three relevant `SKILL.md` files are loaded on demand. Retrieved text is treated as untrusted reference material and does not install packages or make an unavailable scientific database operational. See [docs/SCIENTIFIC_AGENT_SKILLS.md](docs/SCIENTIFIC_AGENT_SKILLS.md). Authenticated discovery endpoint: `GET /api/agent/scientific-skills?task=...`.


## Automatic AgentMemory

ULTRON can automatically retrieve relevant prior project decisions and coding context from the optional [rohitg00/agentmemory](https://github.com/rohitg00/agentmemory) service. It queries memory only for relevant continuation, repository, coding, decision, and context tasks, then injects a small bounded set of results as untrusted context. Durable-context capture runs automatically for explicit, high-signal decisions/preferences when configured; ordinary conversations are not blindly persisted. Set `ULTRON_AGENTMEMORY_CAPTURE=false` to disable it. Existing per-user Supabase memory remains in place. Configure `AGENTMEMORY_URL` and `AGENTMEMORY_SECRET` on the backend, then see [docs/AGENTMEMORY_INTEGRATION.md](docs/AGENTMEMORY_INTEGRATION.md). The adapter is not live until the separate AgentMemory service is deployed and reachable.

## Automatic Browser Use

ULTRON routes interactive web UI tasks to the optional [Browser Use](https://github.com/browser-use/browser-use) Python bridge when configured. It is reserved for browser interactions such as clicking, typing, JavaScript-rendered pages, screenshots, and website testing; plain public information uses the lighter research tool. Read-only navigation is the default, and consequential external actions require explicit confirmation. Setup and security limits: [docs/BROWSER_USE.md](docs/BROWSER_USE.md).
