# ULTRON model provider setup: OpenRouter, Groq, and Google Gemini

ULTRON keeps OpenRouter as its primary model provider. It can automatically use Groq and Google Gemini as ordered fallbacks when their server-side API keys are set. Both providers use their documented OpenAI-compatible chat-completions endpoints, so they reuse ULTRON's existing timeout, fallback, tool-call guard, and response handling.

## Add the API keys

Use these provider consoles to create your own keys:

- **Groq API key:** https://console.groq.com/keys
- **Google Gemini API key:** https://aistudio.google.com/apikey

Set these environment variables in your private local `.env` file or the ULTRON backend's hosting secret settings:

| Variable | Default / purpose |
|---|---|
| `GROQ_API_KEY` | Secret Groq API key; enables the Groq fallback |
| `GROQ_BASE_URL` | `https://api.groq.com/openai/v1` |
| `GROQ_DEFAULT_MODEL` | `openai/gpt-oss-20b` |
| `GEMINI_API_KEY` | Secret Google Gemini API key; enables the Gemini fallback |
| `GEMINI_BASE_URL` | `https://generativelanguage.googleapis.com/v1beta/openai` |
| `GEMINI_DEFAULT_MODEL` | `gemini-3.8-flash` |

ULTRON tries eligible providers in this order: OpenRouter, Groq, Gemini, then any additional providers in `ULTRON_MODEL_PROVIDERS_JSON` by priority. Missing keys are skipped. A provider that returns a supported temporary, quota, authentication, missing-model, or server failure can fall through to the next eligible provider. Existing explicit providers remain supported.

The example model IDs are current defaults, not a guarantee that a given account or region can use them. Change the model variables to an ID currently available in your provider console. Pricing, free-tier eligibility, quotas, data retention, and rate limits are controlled by each provider and may change; confirm these before use.

## Security and privacy

- Never commit real API keys or place them in frontend/public variables.
- Do not send keys in a chat request body; ULTRON reads credentials only from the backend environment.
- Fallback sends the same relevant prompt/context to another provider. Do not enable a provider unless its data-use terms are appropriate for the content ULTRON may send.
- Provider configuration is not proof of connectivity. Run an intentional, harmless model check from a trusted environment after keys and account access are configured.

## What this does and does not enable

This adds **Gemini model inference** and Groq model inference for ULTRON chat and agent requests. Google Workspace APIs (such as Drive, Docs, Gmail, or Calendar) are separate OAuth/bridge integrations and are not enabled merely by adding a Gemini API key. Similarly, the keys do not create provider accounts, increase quotas, install local models, or guarantee successful live inference.

See [MODEL_PROVIDER_FALLBACK.md](MODEL_PROVIDER_FALLBACK.md) for routing behavior and the live-verification boundary.
