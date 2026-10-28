# ECC-Style Engineering Workflow for ULTRON AI

## Purpose and scope

Use this loop for every backend, provider, security, worker, storage, or integration change:

**Inspect → Plan → Baseline test → Implement → Independent review → Verify → Record blockers → Improve.**

This workflow adapts the plan/test/implement/review/verify discipline from Everything Claude Code (ECC) to the existing ULTRON AI repository. It does not replace the application with ECC, require paid services, or authorize deployment. Preserve the current architecture and unrelated branches.

Current guardrails:
- Backend and local/dev/test work only unless a task explicitly changes scope.
- No deployment, redeployment, production setting changes, or production writes as part of routine verification.
- Never place secrets, access tokens, service-role keys, personal test data, or raw provider responses in source control or logs.
- Treat live external services, models, and hardware as unverified until a real, authorized test succeeds.
- Do not report a feature as complete based solely on configuration, mocks, syntax checks, or a green CI run.

## Required engineering loop

### 1. Inspect before editing
- Read `README.md`, `docs/ARCHITECTURE.md`, `docs/TECHNICAL_DECISIONS.md`, `docs/FEATURE_REGISTRY.md`, `docs/IMPLEMENTATION_STATUS.md`, and `docs/BLOCKERS.md` as relevant.
- Inspect the target implementation, its callers, tests, configuration examples, migrations, and current CI workflow.
- Check the target branch and current diff; preserve existing changes and avoid unrelated refactors.
- Identify trust boundaries: authenticated user, model/provider, worker, browser/desktop bridge, database/storage, and external integration.

### 2. Plan a small, reviewable change
Record:
- Intended behavior and explicit non-goals.
- Acceptance criteria that can be tested.
- Security/privacy risks and failure modes.
- Expected files and compatibility concerns.
- Which checks are offline/mock tests and which require external credentials, test accounts, hardware, or explicit live-test approval.

Prefer a narrow patch over broad rewrites. Avoid new dependencies unless necessary and license/resource checked.

### 3. Establish a baseline before implementation
Run the existing checks in a local development checkout with supported Node.js (the package declares Node >=20; CI currently uses Node 24):

```bash
npm install --ignore-scripts
npm run check
npm test
```

For the Python browser-use bridge, also run the exact checks used by CI:

```bash
python -m py_compile browser-use-bridge/main.py browser-use-bridge/navigation_policy.py browser-use-bridge/test_navigation_policy.py
python browser-use-bridge/test_navigation_policy.py
```

Record the command, result, and pre-existing failures. Run dependency audit when dependencies change or as part of the CI-equivalent review:

```bash
npm audit --omit=dev --audit-level=high
```

Do not claim these commands passed unless they were run and the results were observed. This document records the process; it is not itself evidence that tests were run.

### 4. Implement incrementally
- Add or update a regression test with each bug fix or behavior change.
- Keep API contracts and existing user data compatible unless a migration is necessary and documented.
- Validate inputs at the server boundary; authorize each resource against the authenticated owner.
- Use timeouts, bounded response/body sizes, cancellation, sanitized errors, and safe defaults for outbound/provider calls.
- Treat model output, retrieved documents, web pages, and integration payloads as untrusted input.
- Keep consequential actions behind explicit, task-specific approval. A plan/draft is not execution.
- Never silently enable optional integrations or download large models.

### 5. Review independently
Review the patch as if authored by someone else:
- Correctness, edge cases, empty/malformed responses, retries, timeouts, and cancellation.
- Authentication, account isolation, RLS/storage ownership, secret handling, SSRF/DNS rebinding, redirects, and URL validation.
- Worker idempotency, duplicate delivery, terminal states, and cleanup on timeout.
- Backwards compatibility, migrations, error semantics, observability, dependency license, and resource usage on modest hardware.
- Tests that could pass while the real capability remains unavailable.

### 6. Verify after implementation
Run focused tests first, then the relevant full checks. Inspect the final diff and ensure tests cover both success and failure paths. For API changes, verify unauthenticated access, owner access, cross-user denial, malformed inputs, and provider/service failure where applicable.

Use the following evidence levels in status reports:
- **Source checked:** code and contracts reviewed.
- **Automated verified:** named tests actually passed.
- **Live verified:** a real external request or end-to-end flow succeeded in an authorized test environment.
- **Blocked:** the test requires unavailable credentials, test accounts, provider quota, hardware, migrations, or approval.
- **Not verified:** no sufficient evidence yet.

A skipped test is not a pass. A configured integration is not a healthy integration. A health endpoint is not proof of model inference, account isolation, or task completion.

### 7. Update durable project records
For meaningful changes, update the relevant registry/status/blocker/architecture document in the same patch. Close a blocker only when its stated acceptance criteria are evidenced; otherwise record the exact missing prerequisite and a safe next action. Do not inflate percentages or relabel pending work as complete.

### 8. Improve the loop
When a failure repeats, add a regression test, a deterministic local check, or a concise runbook. Keep CI reproducible and avoid live writes in default CI. Live smoke tests must be opt-in, narrowly scoped to disposable test data, explicitly confirmed, and redact secrets and generated content.

## Current priority queue

1. **Baseline CI parity:** run `npm run check`, `npm test`, Python bridge checks, and runtime dependency audit from a local checkout; preserve actual outcomes.
2. **Provider adapters:** verify validation, timeouts, bounded responses, fallback behavior, vision compatibility, and sanitized errors with deterministic tests; run real text/vision smoke tests only with authorized provider credentials.
3. **Authentication and isolation:** keep mock tests in CI; run opt-in two-account Supabase E2E only with dedicated disposable accounts and explicit write confirmation.
4. **Worker/task lifecycle:** test queue, claim, cancellation, retry, terminal state, result retrieval, and cleanup deterministically; run the opt-in plan-only live worker smoke test only in a trusted test environment.
5. **Document storage and outbound networking:** test migration contracts and ownership boundaries; verify live storage only with authorized test accounts. DNS-pinned transport tests do not prove the currently hosted service is running the latest source.
6. **External integrations and Windows companion:** track each service/model/license/hardware prerequisite separately; do not claim full operation based on adapter readiness.
7. **Release gate:** deployment remains a separate, explicitly authorized phase after local verification and review.

## Change report template

For each engineering iteration, report:
- **Goal / acceptance criteria**
- **Files changed**
- **Baseline checks and results**
- **Implementation and regression coverage**
- **Independent review findings**
- **Post-change verification results**
- **Live checks:** passed / blocked / not run, with reason
- **Remaining blockers and smallest next step**
- **Deployment:** not performed unless separately authorized
