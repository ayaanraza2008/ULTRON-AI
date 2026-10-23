# Browser Use integration

ULTRON routes interactive public website tasks to an optional Browser Use bridge; plain research stays on the existing research tool.

## Deploy and configure
The `ultron-browser-use` Render service runs the Python bridge. Configure its `ULTRON_BROWSER_USE_TOKEN` to the same long random secret as the ULTRON backend, set `OPENROUTER_API_KEY` on the bridge to that same shared token (it is used as the bearer credential for ULTRON's model proxy, not as a provider key), and set `OPENROUTER_BASE_URL=https://ultron-ai-zvd7.onrender.com/api/internal/browser-use/v1`. The main ULTRON server keeps the real OpenRouter API key and proxies only authenticated chat-completion requests for approved models. Never expose the shared token to browser/client code.

## Boundaries
The bridge is limited to read-only public website interaction, rejects obvious private-network targets, and blocks consequential actions until a task-specific approval flow is implemented. Health checks do not prove browser/model readiness or successful task execution. Use only websites and accounts you are authorized to access.

Upstream: https://github.com/browser-use/browser-use (MIT). Review upstream dependencies and hosting costs before deployment.
