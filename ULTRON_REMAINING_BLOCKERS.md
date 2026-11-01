# ULTRON AI — Remaining Blockers

This file is the short pointer to the maintained, evidence-backed blocker register:

- **Current register:** [ULTRON_BLOCKERS.md](ULTRON_BLOCKERS.md)
- **Independent audit:** [ULTRON_POST_ANTIGRAVITY_AUDIT_2026-11-01.md](docs/ULTRON_POST_ANTIGRAVITY_AUDIT_2026-11-01.md)
- **Release gate:** [ULTRON_DEPLOYMENT_READINESS.md](ULTRON_DEPLOYMENT_READINESS.md)

As of 2026-11-01, the key blockers are live text/vision provider inference, background worker execution against disposable Supabase data, two-account isolation, the Supabase Auth leaked-password warning, target-PC voice/device E2E, durable paired-device storage, live paired-browser E2E, Docker runtime isolation, full media audio workflow, frontend/backend staging acceptance and Render observability.

Do not mark these resolved from unit tests or green build status alone. The candidate PR #440 remains open/unmerged and is not deployed to production.
