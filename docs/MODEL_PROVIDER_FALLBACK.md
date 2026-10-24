# Model-provider fallback

ULTRON can route normal chat and agent requests through an ordered registry of OpenAI-compatible providers. Set `ULTRON_MODEL_PROVIDERS_JSON` in the server environment to a JSON array. Each entry needs a unique `name`, an HTTPS `baseUrl`, an `apiKeyEnv` naming a separate server-side environment variable, a `model` ID, and optionally numeric `priority`. Keep credentials out of this registry and repository.

The OpenRouter provider is attempted first when configured. Other providers are tried by ascending priority. Entries with invalid URLs or missing credentials are ignored. Alternative providers receive image attachments only when explicitly marked `supportsVision: true` and their model supports images.

A configuration entry does not prove provider access or availability. Model IDs, account entitlements, quotas, endpoint compatibility, and live responses still require verification. Free model access and rate limits are controlled by the provider. For a live check, make a safe authenticated chat request after configuring the keys; use sanitized Render logs for diagnosis. Streaming failover can only occur before response data has been sent to the client.
