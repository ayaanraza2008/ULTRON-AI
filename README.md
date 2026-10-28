# ULTRON AI

ULTRON AI is an API-first assistant runtime with a responsive cinematic command center in `public/`. Express serves the UI and `/api/*` routes from the same origin. UI indicators reflect actual API responses and configured capability gates; source presence is not proof of live provider availability or production deployment.

## Current status

- **Repository:** `ayaanraza2008/ULTRON-AI`, default branch `main`.
- **Hosted API service:** https://ultron-ai-zvd7.onrender.com. The API health endpoint is available; model-dependent chat and integrations depend on their server-side configuration.
- **AI provider:** OpenRouter's OpenAI-compatible API, using `openrouter/free` to automatically select from currently available free models.
- **Dedicated database:** Supabase project `ULTRON-AI` in Mumbai (`ap-south-1`), project ref `opdjfhwepmcprbqojpat`. The quoted project creation cost was $0/month.
- **Database schema:** Initial migration creates conversations, messages, user preferences, user-controlled memory, agent tasks, and audit events, with Row Level Security enabled. The backend includes authenticated conversation, preference, memory CRUD, and task-record endpoints; live RLS behavior still requires end-to-end verification.
- **Isolation:** The existing `nox-ai` Supabase project was not modified.
- **Frontend status:** the command-center source is included under `public/` and served by Express at `/`. CI checks its shell contracts and syntax; live-browser and deployed-revision verification remain separate.

## Capability integration and verification phase

Backend additions on the feature branch:

- `GET /api/capabilities`: reports configuration readiness without returning secret values.
- `GET /api/local/models` and `POST /api/local/chat`: optional Ollama-compatible local inference adapter. A cloud-hosted server cannot reach a user's PC-local `localhost`; use a future authenticated desktop bridge for that case.
- `POST /api/research`: uses Tavily when configured, otherwise a best-effort public DuckDuckGo HTML fallback. Public HTML search can break or be rate-limited; results are untrusted and need source verification.
- `GET /api/tasks`, `POST /api/tasks`, `POST /api/tasks/:id/approve`, and `POST /api/tasks/:id/cancel`: per-user task records, explicit confirmation gates, and audit events using Supabase RLS. The database-polled worker handles only allowlisted research and AI Employee draft/review/report workflows; approval does **not** execute PC commands or arbitrary external actions.
- Cloud chat now attempts opt-in retrieval of a small set of active, user-owned memory items when account preferences permit it. Memory text is treated as untrusted context.
- `GET /api/preferences` and `PUT /api/preferences`: persist supported language, voice, memory, personality, model-provider, and voice-selection preferences per account.
- `POST /api/speech/synthesize` and `POST /api/speech/transcribe`: optional OpenAI-compatible TTS/STT adapters using server-only keys; browser-native speech remains the free fallback. Premium routes require a compatible provider and are not enabled until configured.
- `POST /api/documents/extract`: bounded text extraction for TXT, Markdown, CSV, JSON, HTML, PDF, and DOCX. Extraction is transient; signed-in users can explicitly save up to 20,000 characters of extracted text as an account-scoped `document_reference` in the Memory Vault.
- Private binary document storage is implemented in source with `GET /api/documents`, `POST /api/documents/upload`, `GET /api/documents/:id/download`, and `DELETE /api/documents/:id`. The additive migration creates a private 5 MB bucket, owner-scoped Storage/table RLS, UUID-only object paths, SHA-256/size verification on download, and immutable metadata permissions. Apply `supabase/migrations/20261027181000_private_document_storage.sql` before enabling these endpoints; original files remain private and are stored only after an explicit user action.
- `.env.example` and `render.yaml` document optional local model, research, speech, and desktop bridge settings.

These endpoints are backend building blocks, not a claim that all requested capabilities are production-complete. The allowlisted database-polled worker exists, but real queued-task completion, retries, and result retrieval still need live verification. The private original-file storage implementation requires its additive Supabase migration to be applied and live upload/download/delete E2E verification. A hardened coding sandbox, Windows PC-control action runner, live external-account integrations, and real provider/database end-to-end tests remain incomplete. Premium speech endpoints need a compatible provider configuration. The user-facing frontend and full Windows PC-control UI remain deferred. The current Render Blueprint is the source of truth for which separate services are intended to be provisioned; previously created duplicate services must be reviewed against that configuration before use.

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

The `openrouter/free` router automatically selects a currently available free model and filters for capabilities needed by the request, including image input where supported. When `ULTRON_AVAILABLE_MODELS` lists additional model IDs ending in `:free`, ULTRON can try those same-key models as bounded plain-chat fallbacks after the configured provider/router fails; it excludes paid IDs and does not assume unknown models support tool calls. The scheduled AI Employee worker uses the same list for text-only plan/report tasks. ULTRON's model discovery endpoint lists free model IDs available from OpenRouter; you can also select a specific model ending in `:free`. Free models have usage/rate limits and availability may change. Check provider terms before sending sensitive content to free endpoints.

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

A task-matched capability registry covers 31 upstream repository domains. ULTRON adds relevant domain guidance automatically and exposes authenticated readiness at `GET /api/agent/repositories` (optional `?task=...` shows matches). This is not a claim that every upstream app is installed: missing services, hardware runtimes, licenses, models and credentials remain explicitly marked. See [the repository capability map](docs/REPOSITORY_CAPABILITY_MAP.md). Owner-scoped read-only tools also cover Chatwoot conversations, OpenProject projects/work packages and Cal.diy/Cal.com-compatible availability. The new Obscura MCP adapter inspects public HTTPS pages, while Cactus can act as an optional local-first model provider with confidence-based fallback; Cactus/Needle model weights and all desktop services must be installed/run separately. Keep Cactus cloud handoff off unless separately approved, and put remote Obscura/Cactus services behind authenticated HTTPS gateways. ULTRON does not send support replies, mutate projects, book meetings, bypass website access controls, or download local model weights automatically. Paperclip's optional read-only governance connector can retrieve the owner-configured agent roster, dashboard counts, and cost/utilization summary from a separate Paperclip instance; it never creates, wakes, pauses, terminates, assigns, or changes budgets for agents. Hermes Agent is also available as an optional owner-scoped delegated runtime with task-matched routing, model/capability checks, persistent-memory/session-key support, and its upstream toolsets, skills, subagents, cron and MCP plugins when configured. Configure the separate Hermes API server and keep its terminal backend sandboxed; external messaging/cron actions are not enabled automatically.


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

## Explicit live model smoke check

Use this command only when you intentionally want ULTRON to send a tiny real completion to configured model providers:

~~~bash
npm run smoke:model
~~~

The command reads only server-side environment variables (OPENROUTER_API_KEY, optional OPENROUTER_BASE_URL and OPENROUTER_DEFAULT_MODEL, and optional ULTRON_MODEL_PROVIDERS_JSON entries with their named key environment variables). It makes a small non-streaming chat-completion request, applies a timeout and response-size limit, and tries eligible fallback providers after a failed, rate-limited, invalid, or empty response. HTTPS is required except for loopback development URLs. It rejects URL credentials, query strings, and fragments.

The report includes only pass/fail status, provider/model labels, attempt count, and sanitized error codes. It does **not** print credentials, raw upstream error messages, or generated response text. A blocked result means no safe configured provider/key was eligible; a failed result means all eligible providers failed. A passing result proves the expected `ULTRON_SMOKE_OK` challenge token was returned by one eligible provider at the time of this explicit check; it does not prove future calls will always work. The command is never run automatically during app startup or normal CI, and it may consume a small amount of provider quota. If `ULTRON_AVAILABLE_MODELS` lists additional free IDs, the smoke check tries those same-key alternatives after a failed primary; paid and invalid IDs are excluded.

## Explicit live worker smoke check

The command below creates one uniquely labeled AI Employee **plan-only** task in the configured Supabase project and polls it for a terminal state, then deletes it. On timeout, it conditionally cancels the task only while it is still `QUEUED` or `RUNNING`; the row is deleted only after cancellation is confirmed. If a competing state transition wins the race, it preserves the row for inspection and reports a cleanup warning. It does not send messages, publish, execute commands, change production settings, or return the stored task result.

Run only in a trusted environment with the real Supabase service-role key and a valid existing test-user UUID:

~~~bash
ULTRON_CONFIRM_WORKER_SMOKE=YES \
SUPABASE_URL=https://YOUR_PROJECT.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_SIDE_SECRET \
ULTRON_SMOKE_USER_ID=YOUR_EXISTING_TEST_USER_UUID \
npm run smoke:worker
~~~

Use the shell's protected secret environment (or your hosting provider's environment-variable UI); never put a service-role key in source control or chat. This is an explicit write test, requires the exact confirmation value, and consumes one task/model attempt. Its redacted output reports the task state and cleanup result only. A successful worker test also requires the worker to be enabled, a valid model provider and usable model quota. A timeout can leave a task requiring manual cleanup if Supabase becomes unreachable during polling/deletion. Do not point this smoke test at a production account unless intentionally approved.

## Read-only Supabase Auth configuration diagnostic

Run this in a trusted environment with the existing Supabase project URL and its public publishable/legacy anon key:

~~~bash
npm run diagnose:auth
~~~

It reads only the public Auth runtime settings endpoint. It does not create users, send confirmation emails or SMS, attempt sign-in, modify settings, or return API keys. The report shows whether email signup, email confirmation, Google OAuth, and phone authentication are enabled in the running Auth configuration. It explicitly marks email delivery as **not verified** because runtime settings cannot prove SMTP delivery.

The script accepts SUPABASE_URL plus SUPABASE_PUBLISHABLE_KEY (or the legacy SUPABASE_ANON_KEY). It rejects non-HTTPS/non-Supabase project URLs. Do not copy any service-role secret into this command or chat. For missing confirmation emails, a successful settings report is only the first diagnosis: SMTP delivery, provider rate limits, message templates, redirects, and spam filtering still require separate checks.

## Resend signup confirmation email

The backend exposes a rate-limited \`POST /api/auth/resend-confirmation\` endpoint. Send JSON \`{"email":"user@example.com"}\`. It does not accept redirect destinations from the request body; an optional owner-configured \`ULTRON_AUTH_REDIRECT_URL\` is validated and sent as \`options.emailRedirectTo\`. Supabase also requires that destination to be on its Auth redirect allow-list.

For account-enumeration resistance, invalid input is rejected, but upstream errors such as an already-confirmed/nonexistent email get the same generic success response. Throttling and upstream outages receive sanitized error responses. The endpoint does not bypass confirmation or SMTP requirements; it only asks Supabase Auth to resend the message.

## Opt-in live Supabase isolation test

`npm run test:supabase:e2e` runs the two-account conversation, message, memory, and row-level-security test. It is skipped unless dedicated, confirmed test accounts and all required variables are supplied, including `ULTRON_E2E_ALLOW_WRITES=CONFIRM_ULTRON_E2E_WRITES`. It is hard-scoped to the configured ULTRON Supabase project and creates/deletes temporary test rows. Read `docs/SUPABASE_E2E_ISOLATION.md` first. Do not use personal/admin accounts or commit secrets. A skipped test is not evidence that live data isolation works.
