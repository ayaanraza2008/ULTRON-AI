# ULTRON AI

ULTRON AI is a modular, security-conscious personal AI ecosystem with a web client and a lightweight Windows companion.

## Current status

- **Repository:** `ayaanraza2008/ULTRON-AI`, default branch `main`.
- **Hosted web service:** https://ultron-ai-zvd7.onrender.com. The health endpoint and initial deployment were previously verified; real chat remains dependent on server-side provider and access secrets.
- **AI provider:** OpenRouter's OpenAI-compatible API, using `openrouter/free` to automatically select from currently available free models.
- **Dedicated database:** Supabase project `ULTRON-AI` in Mumbai (`ap-south-1`), project ref `opdjfhwepmcprbqojpat`. The quoted project creation cost was $0/month.
- **Database schema:** Initial migration creates conversations, messages, user preferences, user-controlled memory, agent tasks, and audit events, with Row Level Security enabled. The backend includes authenticated conversation, preference, memory CRUD, and task-record endpoints; live RLS behavior still requires end-to-end verification.
- **Isolation:** The existing `nox-ai` Supabase project was not modified.
- **Windows companion:** Electron shell and unsigned Windows NSIS workflow exist. The shell opens the hosted web client; a secure local automation agent is not yet implemented.

## Capability integration phase

Backend additions on the feature branch:

- `GET /api/capabilities`: reports configuration readiness without returning secret values.
- `GET /api/local/models` and `POST /api/local/chat`: optional Ollama-compatible local inference adapter. A cloud-hosted server cannot reach a user's PC-local `localhost`; use a future authenticated desktop bridge for that case.
- `POST /api/research`: uses Tavily when configured, otherwise a best-effort public DuckDuckGo HTML fallback. Public HTML search can break or be rate-limited; results are untrusted and need source verification.
- `GET /api/tasks`, `POST /api/tasks`, and `POST /api/tasks/:id/cancel`: per-user task records and audit events using Supabase RLS. Creating a record does **not** execute arbitrary tasks; worker orchestration and scoped tools must be added and verified separately.
- Cloud chat now attempts opt-in retrieval of a small set of active, user-owned memory items when account preferences permit it. Memory text is treated as untrusted context.
- `.env.example` and `render.yaml` document optional local model, research, speech, and desktop bridge settings.

These endpoints are backend building blocks, not a claim that all 20 requested capabilities are production-complete. Document parsing, a real background worker, coding sandbox, premium speech provider adapters, and Windows PC-control agent still require separate implementation and tests. The frontend is intentionally deferred to the final phase.

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

The `openrouter/free` router automatically selects a currently available free model and filters for capabilities needed by the request, including image input where supported. ULTRON's model discovery endpoint lists free model IDs available from OpenRouter; you can also select a specific model ending in `:free`. Free models have usage/rate limits and availability may change. Check provider terms before sending sensitive content to free endpoints.

## Verification policy

Features are not described as working until the relevant tests have actually passed. Mock tests are not proof of real provider connectivity, and a successful build is not proof of production deployment.

See `docs/FEATURE_REGISTRY.md`, `docs/IMPLEMENTATION_STATUS.md`, `docs/ARCHITECTURE.md`, `docs/TECHNICAL_DECISIONS.md`, and `docs/BLOCKERS.md` for the current record.
