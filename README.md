# ULTRON AI

ULTRON AI is a modular, security-conscious personal AI ecosystem with a web client and a lightweight Windows companion.

## Current status

- **Repository:** `ayaanraza2008/ULTRON-AI`, default branch `main`.
- **Hosted web service:** https://ultron-ai-zvd7.onrender.com. The health endpoint and initial deployment were previously verified; real chat remains dependent on server-side provider and access secrets.
- **AI provider:** NaraRouter is documented as an OpenAI-compatible gateway. A valid key and an entitled model are required for real inference.
- **Dedicated database:** Supabase project `ULTRON-AI` in Mumbai (`ap-south-1`), project ref `opdjfhwepmcprbqojpat`. The quoted project creation cost was $0/month.
- **Database schema:** Initial migration applied and verified. It creates conversations, messages, user preferences, user-controlled memory, agent tasks, and audit events. All six tables have Row Level Security enabled. The application has not yet been wired to use Supabase.
- **Isolation:** The existing `nox-ai` Supabase project was not modified.
- **Windows companion:** Electron shell and unsigned Windows NSIS workflow exist. The shell opens the hosted web client; it does not yet provide local desktop automation.

## Configuration

Copy `.env.example` to `.env` for local development and populate secrets locally. Never commit `.env`, provider keys, session secrets, or service-role keys. A Supabase publishable key may be used by a client only with appropriate authentication and RLS; privileged keys must remain server-side.

## Hosting configuration

The Render service is configured with the dedicated Supabase URL and publishable key for account sign-in and per-user chat persistence. Real AI responses still require `NARA_ROUTER_API_KEY` and an entitled `NARA_ROUTER_DEFAULT_MODEL` as server-side environment variables. `APP_ACCESS_PASSWORD` is an optional legacy owner-only gate; it is not required for Supabase account login.

## Multi-model text and vision

The chat composer includes a model picker and image attachment support. The server validates selected model IDs and accepts up to two JPEG, PNG, WebP, or GIF images of up to 4 MB each. Image data is sent to the provider for that request and is not stored as image data in Supabase chat history.

Recommended OpenRouter configuration:

- `NARA_ROUTER_BASE_URL=https://openrouter.ai/api/v1`
- `NARA_ROUTER_API_KEY`: create a secret at https://openrouter.ai/keys and store it only in Render/local environment variables.
- `NARA_ROUTER_DEFAULT_MODEL=poolside/laguna-s-2.1:free`
- `ULTRON_AVAILABLE_MODELS=poolside/laguna-s-2.1:free,minimax/minimax-m3.1-flash:free,nvidia/nemotron-3.5-lightning:free`

Laguna S 2.1 and Nemotron 3.5 Lightning are text-only in the selected catalog; use MiniMax M3.1 Flash for image requests. ULTRON automatically routes image requests to MiniMax. Free model routes can change or be retired; verify current provider pricing before relying on them. Check each provider’s data-use terms before sending sensitive content to free endpoints.

## Verification policy

Features are not described as working until the relevant tests have actually passed. Mock tests are not proof of real provider connectivity, and a successful build is not proof of production deployment.

See `docs/FEATURE_REGISTRY.md`, `docs/IMPLEMENTATION_STATUS.md`, `docs/ARCHITECTURE.md`, `docs/TECHNICAL_DECISIONS.md`, and `docs/BLOCKERS.md` for the current record.
