# Model-provider fallback

ULTRON keeps OpenRouter as the primary provider. Configured OpenRouter free-model candidates are attempted before optional direct Groq and Google Gemini providers. Additional OpenAI-compatible providers can be registered through `ULTRON_MODEL_PROVIDERS_JSON`.

## Optional direct providers

| Provider | Variables | Default endpoint | Activation |
|---|---|---|---|
| Groq | `GROQ_API_KEY`, `GROQ_BASE_URL`, `GROQ_DEFAULT_MODEL`, `GROQ_PAID_FALLBACK_ENABLED` | `https://api.groq.com/openai/v1` | Requires the explicit flag `GROQ_PAID_FALLBACK_ENABLED=true` |
| Google Gemini | `GEMINI_API_KEY`, `GEMINI_BASE_URL`, `GEMINI_DEFAULT_MODEL` | `https://generativelanguage.googleapis.com/v1beta/openai` | Enabled when its server-side key is present |

Groq fallback is deliberately disabled by default because the selected model may incur charges. A Groq key and model name alone are insufficient; explicitly enable it only after checking model and account pricing. The Render Blueprint defaults the flag to `false`. OpenRouter's free candidates are attempted before Groq.

Gemini defaults to `gemini-3.8-flash` when configured. Availability and quota depend on the Google account and region. Provider URLs are validated as HTTPS before use.

## Security and privacy

Keep all provider keys in the private backend environment; never send them in chat payloads or expose them to browser code. Fallback may send the same prompt/context to the next provider. Only enable providers approved to receive that data.

## Verification

Automated tests use mocked HTTP responses and verify server-side Authorization headers, provider order, model selection, and that Groq is skipped unless explicitly enabled. They do not call real provider APIs; live smoke tests remain separate.
