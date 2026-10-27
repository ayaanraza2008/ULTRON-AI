# ECC-inspired workflow integration (backend-only)

## Decision and scope

ULTRON AI adopts a selective, task-matched subset of the public [Everything Claude Code (ECC)](https://github.com/affaan-m/ECC) project. ULTRON does **not** install the entire ECC harness: it does not vendor all agents/commands/hooks or run external scripts. Instead, its existing backend agent runtime now selects relevant ECC skill references automatically and adds locally-authored fallback guidance to every matching request.

The repository-local coding-agent workflow is at `.agents/skills/ultron-backend-verification/SKILL.md`. The ULTRON API runtime selector is implemented in `task-aware-skills.js` and consumed by `agent-runtime.js`. The authenticated `GET /api/agent/task-skills?task=...` endpoint reports the automatically selected ECC skills and pinned source revision. The authenticated `POST /api/agent/run` path injects task-matched local fallback guidance plus the bundled ECC skill snapshots as **untrusted reference content**. It does not need to contact ECC at request time. The skill content is never executed as code.

## Runtime behavior

- ECC source revision is pinned to `25278e7d7b6cf6e6a4e7a6c8e10f14ff22f0eb5b` and mirrored locally under `vendor/ecc/skills/`; the runtime does not follow mutable upstream branches.
- Backend/API changes automatically select `backend-patterns` and `tdd-workflow`; security/authentication tasks select `security-review`; research tasks select `deep-research`; multi-step tasks can select `verification-loop`. At most two ECC skill snapshots are selected per request.
- The selector reads the pinned Markdown snapshots locally and limits each injected skill to 7,000 characters. Locally-authored fallback rules stay available even if a file is unexpectedly missing, so routine use does not depend on GitHub availability.
- Other non-ECC skill references already supported by ULTRON may still use bounded, read-only upstream requests. Those are separate from the ECC integration and remain untrusted optional context.
- Every retrieved skill remains untrusted reference data. It cannot override system policy, authorize tools, request secrets, install dependencies, or bypass dispatch-time autonomy checks.
- Safe read-only inspection and draft work can be selected automatically. Existing task-specific approval requirements for destructive changes, external effects, private-data access, and device control remain in force. ECC guidance is not a permission grant.

## Licensing

The ECC repository identifies its open-source code as MIT-licensed. MIT generally permits use, modification, and redistribution subject to preserving the applicable copyright and permission notice. See the upstream [repository](https://github.com/affaan-m/ECC) and its [license file](https://github.com/affaan-m/ECC/blob/main/LICENSE).

ULTRON vendors five selected upstream skill Markdown files (backend-patterns, tdd-workflow, security-review, verification-loop, and deep-research) as pinned text guidance under `vendor/ecc/skills/`. The complete upstream MIT license and a source/revision note are included in `vendor/ecc/LICENSE` and `vendor/ecc/README.md`. No ECC executable code, shell scripts, hooks, plugins, agents, or host-specific runtime is copied. Before adding future upstream assets, review each exact file's license and preserve applicable notices. Do not infer that third-party tools, model weights, external services, or every ECC dependency share MIT licensing.

## Compatibility assessment

- The repository-local `.agents/skills/ultron-backend-verification/SKILL.md` is guidance for compatible coding-agent hosts; whether a user's IDE discovers it depends on that host.
- ULTRON's own application runtime is separate: its backend selector reads the pinned ECC snapshots from the local repository and injects selected guidance into task-matched requests, with local fallback rules. This path does not rely on an IDE auto-discovering the repository-local skill or network availability.
- The runtime integration adds no Node/Python package, secret, model download, or production setting. ECC selection itself causes no external network request; other pre-existing task-guidance integrations may still retrieve their separate references.
- ECC has host-specific adapters and capability differences. Claude-only hooks and slash commands are not treated as executable features in ULTRON.

## What it changes

- Automatically selects pinned ECC backend/TDD/verification/security/research guidance according to task intent, with local fallback rules.
- Injects selected, locally bundled ECC skill Markdown as untrusted context only; no shell, hook, agent, or skill script is run by this mechanism.
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
- [ ] Run an authorized model-backed task and verify the locally bundled ECC skill text reaches model context; no live upstream skill fetch is required.
- [ ] Keep the source revision fixed and preserve `vendor/ecc/LICENSE` if the snapshots are redistributed or updated.
