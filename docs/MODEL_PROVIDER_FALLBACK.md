# Model-provider fallback

ULTRON keeps OpenRouter as its primary provider, followed by built-in optional Groq and Google Gemini providers when their dedicated backend keys are present. Additional OpenAI-compatible providers can still be registered using `ULTRON_MODEL_PROVIDERS_JSON`.

## Provider order and configuration

The standard order is:

1. OpenRouter, using `OPENROUTER_API_KEY` and `OPENROUTER_DEFAULT_MODEL`.
2. Groq, when `GROQ_API_KEY` is set. Its default endpoint is `https://api.groq.com/openai/v1` and default model is `openai/gpt-oss-20b`.
3. Google Gemini, when `GEMINI_API_KEY` is set. Its default endpoint is `https://generativelanguage.googleapis.com/v1beta/openai` and default model is `gemini-3.8-flash`.
4. Other configured providers in ascending priority, including configured OpenRouter fallback model entries.

Use `GROQ_BASE_URL`, `GROQ_DEFAULT_MODEL`, `GEMINI_BASE_URL`, and `GEMINI_DEFAULT_MODEL` to override the defaults. Missing keys are skipped. Each provider uses a server-side credential, HTTPS validation, bounded request timeouts, and ULTRON's existing response parsing and fallback policy. Model/tool compatibility, account entitlement, quota, and endpoint availability still vary.

`ULTRON_MODEL_PROVIDERS_JSON` remains available for other OpenAI-compatible endpoints. Each entry requires a unique name, HTTPS `baseUrl`, `apiKeyEnv` naming a server-side key, and model ID; optional `priority` controls order and `supportsTools: false` excludes a provider from tool-calling requests. Never store secret values in this JSON registry.

Fallback can send the same prompt and context to a different provider. Only configure providers approved to receive that content. Model IDs and free-tier availability can change; check provider documentation and your account's current model catalog.

## Verification boundary

Automated tests use mocked providers and verify routing, authorization headers, and fallback order. They do not prove a real API key works. After configuring keys, run the existing explicit check:

~~~bash
npm run smoke:model
~~~

This command sends a small, non-streaming request to eligible configured providers and returns a sanitized result without provider keys or generated response text. It is an intentional live request and may consume quota. A successful check proves one real completion worked at that time; it does not guarantee future availability or production deployment.

See [PROVIDER_SETUP.md](PROVIDER_SETUP.md) for the exact environment variables.
