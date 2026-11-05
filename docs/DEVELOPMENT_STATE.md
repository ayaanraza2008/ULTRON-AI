# ULTRON AI — Development Checkpoint

Last reviewed: 2026-10-24

This record is an evidence-based checkpoint, not a declaration that ULTRON is complete. Re-check repository and deployment state before relying on time-sensitive entries.

## Verified repository state

- Backend is a Node.js ES-module service; package engine is Node.js >=20.
- CI runs syntax checks, Node's test suite, a high-severity runtime dependency audit, a deployed health smoke test, and a pinned external globe build/bridge check.
- PR #120 merged: CI now fails on high-severity runtime dependency advisories instead of tolerating them.
- Recent backend hardening includes bounded upstream response readers, bounded worker/provider buffers, cancellation-aware task processing, bounded in-process rate limits, and more accurate readiness classification.
- Frontend work remains deferred; preserve frontend source and data.

## Verification boundaries

- A passing CI suite and `/api/health` response prove only the checks they actually perform. They do not prove successful live model inference, account signup/recovery, persistent conversation writes, cross-account RLS isolation, speech quality, or desktop companion pairing.
- OpenRouter configuration is not proof that a real model request succeeds. Verify with an authorized live request and ensure provider/model fallback behavior is exercised.
- Optional integrations remain unverified until the external service, credentials, model/license requirements, and a real workflow are checked.
- Arbitrary untrusted code execution remains disabled until a hardened sandbox with resource/network/filesystem restrictions and explicit approval gates exists.
- Production actions with consequential effects must remain approval-gated.

## Active blockers

1. **Live model inference and fallback:** verify the configured OpenRouter model with a real request; safely port and test the stale multi-provider fallback work rather than merging conflicting history.
2. **Supabase auth and data isolation:** test confirmation/recovery/reset with a test account and verify two-user RLS isolation without using real user data.
3. **Persistent memory and conversations:** verify authenticated write/read/retrieval and cross-user denial.
4. **Research and voice:** verify real configured provider calls, timeouts, quotas, and failure paths.
5. **Windows companion:** install and pair on physical Windows hardware; verify authentication, allowlists, visible status, and emergency stop.
6. **Runtime dependency provenance:** investigate any Render-specific audit warning against the actual build log and resolved dependency tree; do not apply blind dependency upgrades.

## Next action

Inspect the current main-branch provider request path and tests; implement a small, test-backed reliability improvement for model/provider failure handling, then verify CI and deployment before claiming live behavior.

## Safe operating rules

- Never commit secrets or paste them into chat.
- Never claim a test, deployment, provider request, or integration succeeded unless the corresponding evidence was observed.
- Prefer small reviewable PRs, bounded memory/response sizes, cancellation, explicit timeouts, and secure defaults.
