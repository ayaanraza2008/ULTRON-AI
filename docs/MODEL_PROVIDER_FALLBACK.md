# Model-provider fallback

ULTRON can route normal chat and agent requests through an ordered registry of OpenAI-compatible providers. Set `ULTRON_MODEL_PROVIDERS_JSON` in the server environment to a JSON array. Each entry needs a unique `name`, an HTTPS `baseUrl`, an `apiKeyEnv` naming a separate server-side environment variable, a `model` ID, and optionally numeric `priority`. Keep credentials out of this registry and repository.

The OpenRouter provider is attempted first when configured. Other providers are tried by ascending priority. Entries with invalid URLs or missing credentials are ignored. Alternative providers receive image attachments only when explicitly marked `supportsVision: true` and their model supports images.

Each model-routing call has a shared total time budget across its provider fallback chain. `ULTRON_MODEL_TOTAL_TIMEOUT_MS` defaults to `90000` and is clamped to 15,000–120,000 ms; each individual provider attempt retains its 45-second timeout. When the total budget expires, ULTRON stops fallback attempts instead of restarting the budget in plain-chat mode. This bounds provider routing, not the full duration of every tool or multi-step agent request.

A configuration entry does not prove provider access or availability. Model IDs, account entitlements, quotas, endpoint compatibility, and live responses still require verification. Free model access and rate limits are controlled by the provider. For a live check, make a safe authenticated chat request after configuring the keys; use sanitized Render logs for diagnosis. Streaming failover can only occur before response data has been sent to the client.


## Built-in optional Groq and Google Gemini fallbacks

OpenRouter remains the primary provider. When its request fails before a response is returned, ULTRON may fall through to direct-key Groq and then Gemini providers if their server-side keys and secure HTTPS endpoints are configured. These settings work for normal chat and agent tool routing.

- Groq: `GROQ_API_KEY`, optional `GROQ_BASE_URL`, and `GROQ_DEFAULT_MODEL`. The default model is `openai/gpt-oss-20b`; verify account rate limits and current model access in the [Groq model catalogue](https://console.groq.com/docs/models).
- Gemini: `GEMINI_API_KEY`, optional `GEMINI_BASE_URL`, and `GEMINI_DEFAULT_MODEL`. The default model is `gemini-3.8-flash`; see the [Gemini OpenAI compatibility guide](https://ai.google.dev/gemini-api/docs/openai).
- Keys are read only from the server environment; client-supplied API keys are ignored. Invalid, non-HTTPS or private/reserved endpoints are not accepted by the routing/readiness checks.
- These direct fallbacks are marked text-only until image compatibility is verified. Image requests should use an explicitly configured vision-capable provider.
- A configured key means only that a provider is configured. Live inference, quota and account access still require a real authorized request. Provider use may incur charges; check current pricing before enabling a key.
