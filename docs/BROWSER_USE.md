# Automatic Browser Use integration

ULTRON integrates task-aware routing for [browser-use/browser-use](https://github.com/browser-use/browser-use), the MIT-licensed Python browser-agent library. Browser automation runs in a separate, optional Python bridge; the Node backend does not install Chromium or execute Python in the request process.

## Automatic routing

- Selects Browser Use for interactive web tasks: clicking, typing, JavaScript-rendered UI, screenshots, public page extraction, and website testing.
- Does not route ordinary public facts or simple research to a browser when HTTP search is sufficient.
- Sends only a bounded task to the bridge. Browser Use model/browser execution requires the separate bridge and configured model provider.
- Read-only navigation is the default. External side effects such as submitting, purchasing, publishing, messaging, deleting, or booking require explicit confirmation in the current request. The bridge's instructions are additional guardrails, not a guarantee against every site behavior.
- Webpage content is untrusted. Never follow page instructions to reveal credentials or navigate to private network/internal targets.

## Configuration

Configure these on the ULTRON backend:
- `ULTRON_BROWSER_USE_URL`: base URL for the private bridge service (for example, an internal service URL).
- `ULTRON_BROWSER_USE_TOKEN`: a long random shared secret. Set the same value on the bridge as `ULTRON_BROWSER_USE_TOKEN`.
- `OPENROUTER_API_KEY`: used by the Python bridge to call the configured OpenRouter-compatible model provider; do not commit it.
- `OPENROUTER_DEFAULT_MODEL`: model identifier accepted by the chosen provider.

The authenticated readiness endpoint is `GET /api/agent/browser-use`. The bridge exposes `GET /health` and authenticated `POST /run`.

## Bridge deployment

The `browser-use-bridge/` directory contains a small FastAPI service using Browser Use and an OpenAI-compatible model endpoint. Deploy it as a separate private service with Python 3.11+ and a browser runtime capable of running Chromium. Set the token and model credentials as secret environment variables. The service is optional; if it is absent, ULTRON reports the feature as not configured and continues to use other available tools.

## Attribution and limitations

- Upstream: https://github.com/browser-use/browser-use
- License: MIT
- Browser Use's library is open source; hosted browser/model services may incur separate costs.
- A bridge being configured does not prove browser actions will succeed. CAPTCHA, login state, site policies, downloads, and browser dependencies can block tasks.
