# Model-provider fallback

ULTRON can route normal chat and agent requests through an ordered registry of OpenAI-compatible providers. Set `ULTRON_MODEL_PROVIDERS_JSON` in the server environment to a JSON array. Each entry needs a unique `name`, an HTTPS `baseUrl`, an `apiKeyEnv` naming a separate server-side environment variable, a `model` ID, and optionally numeric `priority`. Keep credentials out of this registry and repository.

The OpenRouter provider is attempted first when configured. Other providers are tried by ascending priority. Entries with invalid URLs or missing credentials are ignored. Alternative providers receive image attachments only when explicitly marked `supportsVision: true` and their model supports images.

Each model-routing call has a shared total time budget across its provider fallback chain. `ULTRON_MODEL_TOTAL_TIMEOUT_MS` defaults to `90000` and is clamped to 15,000–120,000 ms; each individual provider attempt retains its 45-second timeout. When the total budget expires, ULTRON stops fallback attempts instead of restarting the budget in plain-chat mode. This bounds provider routing, not the full duration of every tool or multi-step agent request.

A configuration entry does not prove provider access or availability. Model IDs, account entitlements, quotas, endpoint compatibility, and live responses still require verification. Free model access and rate limits are controlled by the provider. For a live check, make a safe authenticated chat request after configuring the keys; use sanitized Render logs for diagnosis. Streaming failover can only occur before response data has been sent to the client.
