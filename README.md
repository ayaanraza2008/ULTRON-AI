# ULTRON AI

ULTRON AI is an API-first assistant runtime. This repository exposes the existing backend APIs and integrations, plus a first-party local-first Video Studio workspace at `/studio`. The root URL is not a general-purpose chat frontend.

## Current status

- **Repository:** `ayaanraza2008/ULTRON-AI`, default branch `main`.
- **Hosted API service:** https://ultron-ai-zvd7.onrender.com. The API health endpoint is available; model-dependent chat and integrations depend on their server-side configuration.
- **AI provider:** OpenRouter's OpenAI-compatible API, using `openrouter/free` to automatically select from currently available free models.
- **Dedicated database:** Supabase project `ULTRON-AI` in Mumbai (`ap-south-1`), project ref `opdjfhwepmcprbqojpat`. The quoted project creation cost was $0/month.
- **Database schema:** Initial migration creates conversations, messages, user preferences, user-controlled memory, agent tasks, and audit events, with Row Level Security enabled. The backend includes authenticated conversation, preference, memory CRUD, and task-record endpoints; live RLS behavior still requires end-to-end verification.
- **Isolation:** The existing `nox-ai` Supabase project was not modified.
- **UI status:** `/studio` provides the Video Studio production board. It is a focused production workspace, not a replacement for the full general-purpose ULTRON chat interface.

## Backend-only capability integration phase

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

## Video Studio — local-first video production

The integrated Video Studio workspace is served by the same ULTRON API at `http://127.0.0.1:10000/studio`. It creates a persistent project board, generates three creative directions and a timed script/scene plan, analyzes local reference clips with FFmpeg/FFprobe, can search optional Pexels/Pixabay stock catalogs, creates SRT caption sidecars, can request a configured voiceover service, and renders an MP4 with local FFmpeg after explicit plan and final-render approvals.

### Local quick start

1. Install Node.js 20+ and install the project dependencies with `npm install`.
2. Copy `.env.example` to `.env`. Fill in provider keys privately only when needed. The local launcher reads `.env`; the file is ignored by Git.
3. Install FFmpeg (which includes `ffmpeg` and `ffprobe`) and ensure both commands are on `PATH`. Install `yt-dlp` only if you want optional metadata extraction for reference URLs.
4. Run `npm run studio:local` and open `http://127.0.0.1:10000/studio`.

Projects and assets default to `.local/video-studio/`. The local runner binds to `127.0.0.1`, and local unauthenticated mode rejects non-loopback Host requests. Do not expose it through a tunnel, reverse proxy, or public network. Set `ULTRON_VIDEO_STUDIO_DIR` to change the data directory.

### Optional providers

- AI planning uses the configured OpenRouter/Groq/Gemini or other OpenAI-compatible providers. With no usable provider key, the app uses a local template planner and does not claim it called a model.
- `TAVILY_API_KEY` enables live research. If it is absent, the app records that research was not run.
- `PEXELS_API_KEY` and `PIXABAY_API_KEY` enable stock-media search. Each result retains a source link and creator/source metadata; check the current terms/licence before publishing.
- Voiceover uses a separately installed local VoiceStudio endpoint or a configured compatible endpoint using the existing `TTS_API_BASE_URL`, `TTS_API_KEY`, `TTS_MODEL`, and `TTS_DEFAULT_VOICE` settings. Local reference transcription is available when VoiceStudio or an OpenAI-compatible STT endpoint (`STT_API_BASE_URL`, `STT_API_KEY`, `STT_MODEL`) is configured; otherwise paste the transcript manually.

### Current boundaries

- A link alone does not reveal full scene cuts or reliably provide a transcript. Upload an authorized local clip to inspect duration, dimensions and scene-change timestamps. If an STT/VoiceStudio endpoint is configured, the board can extract up to 210 seconds of audio locally and request a transcript; otherwise paste one manually. `yt-dlp` metadata access is opt-in in local mode only when the user confirms rights; the app does not automatically download the source video.
- Local reference clip and direct local asset uploads are capped at 8 MB per file in this UI; stock media imports are capped at 40 MB. Short samples are recommended.
- The renderer uses licensed/imported footage and still images. Stills receive a slow zoom/pan effect; imported motion footage is cut to fit the requested duration. Captions are an editable/downloadable `.srt` sidecar and are not burned into the MP4. No video/image generation service is silently installed or called.
- Cost values are estimates based on optional user-configured unit rates. Provider quota, commercial usage terms, music/media licences and third-party generation costs remain separate and may be unknown.
- The final renderer is disabled until the plan is approved, visual media exists, and final-render approval is explicitly recorded.

See [docs/VIDEO_STUDIO.md](docs/VIDEO_STUDIO.md) for setup details, workflows, supported sources, and verification limits.

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



## REA reverse-engineering integration

ULTRON has an optional, owner-scoped adapter for [REA — Reverse Engineer Anything](https://github.com/morluto/rea). It can use a separately running REA MCP service to gather evidence about authorized application and software artifacts. The adapter stays disabled until explicitly enabled; having the code and tests in this repository does **not** mean an REA service, decompiler, or native analysis engine is installed or reachable.

Available agent tools include:

- `rea_investigate_application_feature`: analyze an authorized JavaScript/Electron app or ASAR, then trace a named feature in the same MCP session.
- `rea_analyze_application`, `rea_inspect_artifact`, and `rea_inspect_desktop_application`: bounded application/package inspection.
- `rea_inspect_native_code` and `rea_inspect_binary_layout`: read-only header, section, symbol, relocation and disassembly inspection when caller-installed providers are available.
- `rea_inspect_wasm_artifact`, `rea_inspect_firmware_regions`, `rea_inspect_model_artifact`, `rea_inspect_managed_artifact`, `rea_inspect_android_package`, and `rea_inspect_apk_signature`: format-specific static analysis.
- `rea_inspect_web_network_capture`: offline analysis of supported saved network captures; it does not replay or contact recorded URLs.
- `rea_search_guidance` and `rea_list_guided_workflows`: discover REA-provided workflow guidance.

Configure these backend-only environment values on the ULTRON host:

- `REA_MCP_ENABLED=true` to opt in.
- `REA_MCP_URL` pointing at the REA server's `/mcp` endpoint.
- `REA_ANALYSIS_ROOT` set to a dedicated absolute directory on the REA host, containing targets that are authorized for inspection.
- `ULTRON_INTEGRATION_OWNER_USER_ID` set to the allowed ULTRON owner's Supabase user UUID.
- For remote use, `REA_MCP_TOKEN` must be validated by a private HTTPS gateway in front of REA. Loopback HTTP is allowed only when ULTRON and REA are on the same host.

ULTRON accepts only relative target paths beneath the configured root, allowlists exposed operations, bounds response sizes and timeouts, and treats returned evidence as untrusted. It does not download targets, install optional REA providers, expose generic MCP tools, or execute inspected artifacts. REA itself supports additional tools and workflows that are **not yet exposed through this ULTRON adapter**, so this is a selective integration rather than full feature parity. Verify the installed REA version and provider prerequisites on the REA host before use. Configuration status is not proof of live connectivity; run a controlled end-to-end check against a disposable, authorized target before relying on results.



### Self-hosted authenticated REA gateway

The repository also contains `rea-gateway/`, a small gateway intended for a separate Render web service. It launches REA's own HTTP MCP listener on loopback only and exposes only `/mcp` through a bearer-token check. Render supplies HTTPS at the public edge; the REA listener itself is not exposed directly. The gateway rejects requests without the token, rejects query/path aliases, limits request bodies, forwards MCP session headers, and does not forward the gateway credential to REA.

To configure the gateway service, use the ULTRON repository on the `main` branch, runtime Node.js, build command `cd rea-gateway && npm install --omit=dev`, and start command `cd rea-gateway && npm start`. Set `NODE_VERSION=24.22.1`, `REA_CHILD_PORT=49321`, and a newly generated random URL-safe `REA_MCP_TOKEN` of at least 32 characters in the gateway's secret environment. Keep the token out of source control. The service's `/healthz` endpoint stays unavailable until a startup self-test completes an MCP initialization, confirms the required tool catalog, statically analyzes the bundled `demo-app` fixture, and traces its `search results` feature. This check does not execute target code. Wait for it to report `ok` before configuring ULTRON.

On ULTRON's backend service, set `REA_MCP_ENABLED=true`, `REA_MCP_URL=https://YOUR-REA-GATEWAY.onrender.com/mcp`, and the exact same `REA_MCP_TOKEN`. Keep the existing `ULTRON_INTEGRATION_OWNER_USER_ID` configured to your own Supabase user UUID. Never point ULTRON directly at an unauthenticated REA HTTP listener. The gateway only makes the transport reachable; target files and optional analysis providers still need to exist on the REA host. The free Render build-pipeline quota may prevent deployment, in which case health and end-to-end calls remain unverified until a build succeeds.

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


## Local Hugging Face model tooling

The optional [ULTRON Model Lab](tools/model-lab/README.md) Python CLI benchmarks decoding presets on benign-task and safety-boundary checks, produces a local calibration profile, and offers terminal chat, unchanged local model snapshots, and Hugging Face profile publishing. It does not modify model weights. Inference dependencies are optional and are not needed by the Node.js API service.

```bash
python -m pip install -r tools/model-lab/requirements.txt
python tools/model-lab/ultron_model_lab.py doctor
python -m unittest discover -s tools/model-lab -p 'test_*.py'
```

Use a small model first on low-memory hardware. 4-bit bitsandbytes inference requires a compatible CUDA/ROCm setup; CPU fallback does not provide 4-bit acceleration. Calibration metrics are heuristic and must not be treated as safety certification.

## Fish Audio speech integration

ULTRON's authenticated speech endpoints support Fish Audio's native REST API for **both voice synthesis and speech recognition**. Configure `FISH_API_KEY` on the backend and keep it secret. The requested voice/reference model ID is set to `7a18a1851d2649108c48ec9f2c80eb2c`; TTS defaults to the `s2.1-pro-free` engine, while STT defaults to `transcribe-1`. A Fish Audio key takes priority over the optional legacy OpenAI-compatible speech settings.

See [docs/FISH_AUDIO_INTEGRATION.md](docs/FISH_AUDIO_INTEGRATION.md) for Render/local environment settings, the two endpoints, browser recording fallback, security limits, and live verification guidance. The backend includes mocked API-contract tests; live requests still require a valid server-side key and account quota.
