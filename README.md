# ULTRON AI

ULTRON AI is currently in a backend-only implementation phase. Frontend and Windows desktop UI work are deferred until the backend capabilities and integrations are complete and verified.

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

Optional cross-provider fallback is available through `ULTRON_MODEL_PROVIDERS_JSON`. It accepts a JSON array of OpenAI-compatible providers with `name`, HTTPS `baseUrl`, `apiKeyEnv` (the name of a server-side environment variable holding the key), `model`, and optional numeric `priority`. The OpenRouter entry is tried first; additional providers are ordered by priority. A provider marked `supportsVision: true` may receive images; otherwise image attachments are not sent to it. ULTRON validates URLs and keys and never returns provider secrets to the client. This only configures fallback routing: model access, quotas, model IDs, and real connectivity must still be verified with the provider.

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


## Automatic tool routing

The authenticated `POST /api/agent/run` endpoint lets ULTRON select bounded tools from the user's request. `GET /api/agent/tools` lists readiness without exposing credentials. Available tools include public web research, AI Employee planning/drafting, coding assistance, integration readiness, live ComfyUI status, optional OmniVoice speech, optional HeyGem talking-avatar jobs, optional Handy desktop transcription, and explicitly confirmed ComfyUI workflow submission.

Example request body:

```json
{ "prompt": "Research the latest developments in open-source voice models" }
```

The endpoint requires a signed-in Supabase user. Model-selected tool calls are validated server-side; web results are treated as untrusted input. Plans and code remain drafts. Explicitly requested background AI Employee tasks are automatically queued when the worker and storage are configured; they are limited to draft-only plans, reviews, and reports. ComfyUI generation requires the exact workflow to be attached and `confirmExternalAction: true`. HeyGem requires `media.imageBase64` and `media.audioBase64`; Handy requires `audioBase64` and a reachable authenticated desktop bridge. OmniVoice, HeyGem, and Handy require explicit compatible endpoint paths and working external services. Readiness does not imply those services are deployed or live-verified. This API is a backend capability; a user-facing frontend is still deferred.


## Automatic AgentMemory

ULTRON can automatically recall relevant prior project decisions and coding context from a separately hosted [AgentMemory](https://github.com/rohitg00/agentmemory) service. Recall runs only for relevant continuation, repository, coding, and memory-context tasks; bounded durable decisions/preferences are captured automatically when the service is configured. ULTRON respects the existing account memory preference and isolates project namespaces by authenticated user. Configure `AGENTMEMORY_URL` and `AGENTMEMORY_SECRET` on the backend, then follow [docs/AGENTMEMORY_INTEGRATION.md](docs/AGENTMEMORY_INTEGRATION.md). The service must be deployed with persistent storage; configuration alone is not proof of live connectivity.


## VoiceStudio speech integration

ULTRON now has an authenticated adapter for a separately running [VoiceStudio](https://github.com/debpalash/VoiceStudio) instance. It supports live service/model readiness, voice listing, text-to-speech audio generation, and audio transcription through VoiceStudio's documented OpenAI-compatible speech API. The agent's existing `synthesize_speech` tool now automatically prefers VoiceStudio when configured; `transcribe_audio` also uses VoiceStudio when audio is supplied, otherwise it retains the existing provider fallback. The adapter does not vendor or silently install VoiceStudio, download multi-gigabyte models, or claim the service is reachable until the status endpoint succeeds.

Configure on the ULTRON backend only:

- `VOICESTUDIO_BASE_URL=http://localhost:3900` when ULTRON and VoiceStudio run on the same machine.
- `VOICESTUDIO_BASE_URL=https://your-secured-voicestudio-host` plus `VOICESTUDIO_API_KEY` for a remote service. VoiceStudio must be configured with a matching API key; do not expose it to the browser.
- `GET /api/integrations/voicestudio/status` checks the discovery document and model list.
- `GET /api/integrations/voicestudio/voices` lists available profiles.
- `POST /api/integrations/voicestudio/synthesize` accepts `{ "text": "...", "voice": "default", "format": "wav" }` and returns base64 audio.
- `POST /api/integrations/voicestudio/transcribe` accepts base64 audio, MIME type, and optional language.

All endpoints require a signed-in Supabase user. Audio inputs are capped at 8 MB and generated audio responses at 12 MB. Remote HTTP endpoints are rejected; no arbitrary URL is accepted from a request body.

**Important deployment boundary:** the public Render service cannot connect to `localhost:3900` on your Windows PC. For a PC-local VoiceStudio installation, ULTRON needs a later authenticated Windows companion/bridge to call the local service. Alternatively, use a secured, reachable HTTPS VoiceStudio host. Do not expose VoiceStudio's admin API to the public internet. VoiceStudio is AGPL-3.0; if modified VoiceStudio is provided over a network, comply with its source-offer obligations. Voice/model weights and voice likeness permissions have separate terms. See [VoiceStudio license notice](https://github.com/debpalash/VoiceStudio/blob/main/LICENSE-NOTICE.md).


## Explicit live worker smoke check

The command below creates one uniquely labeled AI Employee **plan-only** task in the configured Supabase project, polls it for a terminal state, then deletes it (or cancels it first only if it remains queued after timeout). It does not send messages, publish, execute commands, change production settings, or return the stored task result.

Run only in a trusted environment with the real Supabase service-role key and a valid existing test-user UUID:

~~~bash
ULTRON_CONFIRM_WORKER_SMOKE=YES \
SUPABASE_URL=https://YOUR_PROJECT.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_SIDE_SECRET \
ULTRON_SMOKE_USER_ID=YOUR_EXISTING_TEST_USER_UUID \
npm run smoke:worker
~~~

Use the shell's protected secret environment (or your hosting provider's environment-variable UI); never put a service-role key in source control or chat. This is an explicit write test, requires the exact confirmation value, and consumes one task/model attempt. Its redacted output reports the task state and cleanup result only. A successful worker test also requires the worker to be enabled, a valid model provider and usable model quota. A timeout can leave a task requiring manual cleanup if Supabase becomes unreachable during polling/deletion. Do not point this smoke test at a production account unless intentionally approved.
