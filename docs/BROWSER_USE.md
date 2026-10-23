# Browser Use integration

ULTRON routes interactive public website tasks to an optional Browser Use bridge; plain research stays on the existing research tool.

## Deploy and configure
Deploy `browser-use-bridge` as a separate Python web service with root directory `browser-use-bridge` and start command `uvicorn main:app --host 0.0.0.0 --port $PORT`. Configure `OPENROUTER_API_KEY` and a long random `ULTRON_BROWSER_USE_TOKEN` on the bridge. Configure `ULTRON_BROWSER_USE_URL` and the same token on the ULTRON backend. Never expose this token to browser/client code.

## Boundaries
This is optional and returns a clear blocked result until deployed/configured. It is limited to read-only public website interaction, rejects obvious private-network targets, and blocks consequential actions until a task-specific approval flow is implemented. Health checks do not prove browser/model readiness or successful task execution. Use only websites and accounts you are authorized to access.

Upstream: https://github.com/browser-use/browser-use (MIT). Review upstream dependencies and hosting costs before deployment.
