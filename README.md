# ULTRON AI

ULTRON AI is being built as a modular, security-conscious personal AI ecosystem with a web client and a lightweight Windows companion.

## Project status

The repository was confirmed empty during the initial audit (no files, branches, or commits were present). This initial commit establishes the requirements and verification records before application implementation.

- **Current phase:** Phase 1 — Audit and Baseline
- **AI provider:** NaraRouter documented as an OpenAI-compatible gateway; a valid key and chosen model are still required for real inference tests.
- **Hosting:** No Render service is currently linked to this repository. Do not reuse or repoint another project's service without an explicit decision.
- **Database:** A Supabase project is accessible, but it is named for a different application. It will not be connected to ULTRON until the intended data ownership and isolation are confirmed.
- **External integrations:** All five source repositories require separate compatibility, hardware, and license review before integration.

## Windows companion

The Electron companion source is in `desktop/`. The GitHub Actions workflow builds an unsigned Windows NSIS installer and publishes it as a workflow artifact. The desktop shell opens the hosted web client; it does not yet provide local desktop automation.

## Configuration

Copy `.env.example` to `.env` for local development and populate secrets locally. Never commit `.env` or expose API keys to browser code.

## Hosted preview

Render service: https://ultron-ai-zvd7.onrender.com. The app requires server-side `APP_ACCESS_PASSWORD`, `SESSION_SECRET`, `NARA_ROUTER_API_KEY`, and a model alias available to the key before it can be used for chat. Do not paste secrets into source files or commit them.

## Verification policy

Features are not described as working until the relevant tests have actually passed. Mock tests are not proof of real provider connectivity, and a successful build is not proof of production deployment.

See `docs/FEATURE_REGISTRY.md`, `docs/IMPLEMENTATION_STATUS.md`, `docs/ARCHITECTURE.md`, `docs/TECHNICAL_DECISIONS.md`, and `docs/BLOCKERS.md` for the current record.