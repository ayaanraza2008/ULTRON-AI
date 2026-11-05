# ULTRON model provider setup

OpenRouter is the primary provider. Its configured free-model list is attempted first. Groq and Google Gemini are optional direct fallbacks.

## Configure optional providers

Set values only in the private backend environment:

| Variable | Default | Purpose |
|---|---|---|
| `GROQ_API_KEY` | unset | Groq credential |
| `GROQ_BASE_URL` | `https://api.groq.com/openai/v1` | HTTPS-compatible chat API base |
| `GROQ_DEFAULT_MODEL` | `openai/gpt-oss-120b` in candidate template | Explicit model selection |
| `GROQ_PAID_FALLBACK_ENABLED` | `false` | Must be explicitly set to `true` to allow Groq requests |
| `GEMINI_API_KEY` | unset | Enables Gemini fallback |
| `GEMINI_BASE_URL` | `https://generativelanguage.googleapis.com/v1beta/openai` | Gemini OpenAI-compatibility endpoint |
| `GEMINI_DEFAULT_MODEL` | `gemini-3.8-flash` | Override with a model available to your account |

A Groq API key and model are not enough to activate fallback. The separate paid-fallback flag must be deliberately enabled after you review the current model price and account quota. Keep the flag false to ensure Groq is never called. OpenRouter's free-model candidates stay ahead of Groq.

Do not put keys in frontend variables or request JSON. ULTRON never reads provider keys from chat payloads. Gemini quota and availability depend on the Google account and region. Additional providers remain supported with `ULTRON_MODEL_PROVIDERS_JSON`, which stores metadata and the environment-variable name—not secret values.

## Verification boundary

Automated tests use mocked provider responses. They verify fallback ordering and backend-only credentials, but do not verify real account access. Live smoke testing is separate and may consume quota; it has not been run.
