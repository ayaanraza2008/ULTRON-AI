# ULTRON model provider registry and API keys

ULTRON can use its existing OpenRouter provider first and then sequentially fail over to additional OpenAI-compatible chat-completions providers. Failover is attempted on HTTP 429, HTTP 5xx, timeout, network errors, or malformed provider responses. Tool-calling requests skip providers explicitly configured with \`supportsTools: false\`.

## Security rules

- Put API key values only in the deployment's server-side environment/secrets settings. Never commit them, put them in frontend variables, or send them in agent request JSON.
- \`ULTRON_MODEL_PROVIDERS_JSON\` contains provider metadata and environment-variable *names*, not secret values.
- Custom providers must use HTTPS and an OpenAI-compatible \`/chat/completions\` endpoint.
- The provider registry is capped at 12 configured entries and 8 active providers. Unknown/missing keys and invalid/insecure URLs are ignored.
- This feature does not provision keys, create paid accounts, bypass provider rate limits, or make incompatible model APIs compatible. Each provider's terms, billing, quotas, and data policy still apply.
- Provider fallback may send the same prompt/context to another provider. Only configure providers approved to receive that data.

## Configure a provider

In Render, add a secret environment variable for the provider, such as \`GROQ_API_KEY\`, and add \`ULTRON_MODEL_PROVIDERS_JSON\` as a non-secret JSON value. Example:

\`\`\`json
[
  {
    "name": "groq",
    "baseUrl": "https://api.groq.com/openai/v1",
    "apiKeyEnv": "GROQ_API_KEY",
    "model": "YOUR_ENABLED_GROQ_MODEL_ID",
    "priority": 1,
    "supportsTools": true
  },
  {
    "name": "together",
    "baseUrl": "https://api.together.xyz/v1",
    "apiKeyEnv": "TOGETHER_API_KEY",
    "model": "YOUR_ENABLED_TOGETHER_MODEL_ID",
    "priority": 2,
    "supportsTools": true
  }
]
\`\`\`

Use exact model IDs currently enabled for your accounts; the example intentionally does not guess which models your keys can access. Keep \`OPENROUTER_API_KEY\` and \`OPENROUTER_DEFAULT_MODEL\` configured as the primary provider.

## Current status and other integrations

The existing integration catalog separately tracks ComfyUI, HeyGem, OmniVoice, Handy, Geo-Sleuth and AI Employee configuration. Those are not interchangeable generic model APIs: each needs a compatible service/bridge, credentials where applicable, valid endpoint paths, and runtime resources. A key alone does not install GPU models, provide a Windows desktop bridge, or grant access to third-party accounts.

After changing configuration, inspect the authenticated integration status endpoint and test each provider with a harmless request. A "configured" state is not the same as a successful live integration test.
