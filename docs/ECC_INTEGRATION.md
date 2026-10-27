# ECC-inspired workflow integration (backend-only)

## Decision and scope

ULTRON AI adopts a selective, task-matched subset of the public [Everything Claude Code (ECC)](https://github.com/affaan-m/ECC) project. ULTRON does **not** install the entire ECC harness: it does not vendor all agents/commands/hooks or run external scripts. Instead, its existing backend agent runtime now selects relevant ECC skill references automatically and adds locally-authored fallback guidance to every matching request.

The repository-local coding-agent workflow is at `.agents/skills/ultron-backend-verification/SKILL.md`. The ULTRON API runtime selector is implemented in `task-aware-skills.js` and consumed by `agent-runtime.js`. The authenticated `GET /api/agent/task-skills?task=...` endpoint reports the automatically selected ECC skills and pinned source revision. The authenticated `POST /api/agent/run` path injects the local guidance, then attempts a bounded, read-only fetch of selected upstream skill Markdown as **untrusted reference content**. The skill content is never executed as code.

## Runtime behavior

- ECC source revision is pinned to `25278e7d7b6cf6e6a4e7a6c8e10f14ff22f0eb5b`; task URLs do not follow the mutable `main` branch.
- Backend/API changes automatically select `backend-patterns` and `tdd-workflow`; security/authentication tasks select `security-review`; research tasks select `deep-research`; multi-step tasks can select `verification-loop`. A small cap limits external references per request.
- Local fallback rules are added by the deterministic selector, so the basic workflow remains available even when GitHub is offline, the upstream fetch times out, or a skill cannot be read.
- Upstream content is retrieved with redirects disabled, a 5-second timeout, a 200 KB response-read bound and a 7,000-character per-skill context bound. Fetch errors are non-fatal and do not expose response bodies or secrets.
- Every retrieved skill remains untrusted reference data. It cannot override system policy, authorize tools, request secrets, install dependencies, or bypass dispatch-time autonomy checks.
- Safe read-only inspection and draft work can be selected automatically. Existing task-specific approval requirements for destructive changes, external effects, private-data access, and device control remain in force. ECC guidance is not a permission grant.

## Licensing

The ECC repository identifies its open-source code as MIT-licensed. MIT generally permits use, modification, and redistribution subject to preserving the applicable copyright and permission notice. See the upstream [repository](https://github.com/affaan-m/ECC) and its [license file](https://github.com/affaan-m/ECC/blob/main/LICENSE).

This ULTRON workflow is newly written and ECC-inspired; it does not vendor upstream implementation files. Before copying any upstream code, skills, scripts, hooks, or other assets into ULTRON, review the exact file's license/notice and preserve required attribution. Do not infer that third-party tools, model weights, external services, or every dependency share ECC's license.

## Compatibility assessment

- The repository-local `.agents/skills/ultron-backend-verification/SKILL.md` is guidance for compatible coding-agent hosts; whether a user's IDE discovers it depends on that host.
- ULTRON's own application runtime is separate: its backend selector explicitly injects the pinned ECC skill references for task-matched requests, with local fallback rules. This path does not rely on an IDE auto-discovering the repository-local skill.
- The runtime integration adds no Node/Python package, secret, model download, or production setting. It does make bounded read-only public GitHub GET requests for selected reference text when available.
- ECC has host-specific adapters and capability differences. Claude-only hooks and slash commands are not treated as executable features in ULTRON.

## What it changes

- Automatically selects pinned ECC backend/TDD/verification/security/research guidance according to task intent, with local fallback rules.
- Injects selected upstream skill text as untrusted context only; no shell, hook, agent, or skill script is run by this mechanism.
- Preserves ULTRON-specific requirements for narrow changes, regression tests, auth ownership/RLS, worker allowlists, idempotency, cancellation, secret redaction, bounded external calls, and DNS-rebinding limitations.
- Requires evidence-based diff review and separate reporting of passed, failed, skipped, and blocked verification.

## Deliberately not included

- No full ECC checkout or bulk copy of its agents, skills, hooks, rules, or scripts.
- No new runtime dependencies or automated shell hooks.
- The only API-surface change is additive, non-secret ECC selection metadata from the existing authenticated task-skills endpoint; no tool permissions or execution behavior are widened. No database migrations, environment variables, credentials, Render, or Supabase settings are changed.
- No frontend work, deployment, or redeployment.
- No claim that provider, account-isolation, background-worker, or other live tests have passed.

## Verification checklist

- [ ] Confirm GitHub CI executes the new task-aware selector regression tests on the PR branch.
- [ ] Check selected ECC metadata through `GET /api/agent/task-skills?task=...` in an authorized test session.
- [ ] Run an authorized model-backed task to observe successful upstream skill retrieval; otherwise record retrieval as unverified while retaining the local fallback.
- [ ] If future work vendors upstream ECC files, record the exact upstream revision and preserve the applicable MIT copyright/permission notice.
