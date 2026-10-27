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
- The API surface adds non-secret ECC selection metadata to the existing authenticated task-skills endpoint.
- The agent dispatch boundary allows a narrow list of read-only/status-check and draft-only tools to prepare safe parts of a mixed task (for example, research before a requested email). This does **not** authorize the consequential final action. The exception does not apply when the request also contains private-data access or device-control intent; destructive/external-action tool calls remain gated.
- No database migrations, environment variables, credentials, Render settings, Supabase settings, frontend work, deployment, or redeployment are included.

## Safe preparation in mixed requests — 2026-10-27

A follow-up autonomy hardening change avoids blocking every tool when an overall request combines a safe preparatory step with an external action. SAFE_PREPARATION_TOOLS is deliberately limited to public research, code/planning drafts, status checks, and public-page inspection. Sensitive private-data/device-control intent disables the exception. Other tools still inherit the request risk, and delegated browser/employee/Hermes tasks remain subject to their specific risk checks.

Verification at commit 41313124da61befe8f6e0b653749eff6a8a7b0ec: GitHub Actions run [40511199202](https://github.com/ayaanraza2008/ULTRON-AI/actions/runs/40511199202) passed npm run check, npm test (514 tests: 513 passed, 0 failed, 1 skipped), the existing deployed health smoke test, and the world-intelligence build. These are automated/CI results; they do not prove live provider inference, Supabase two-user isolation, or live background-task completion.
- No frontend work, deployment, or redeployment.
- No claim that provider, account-isolation, background-worker, or other live tests have passed.

## Verification checklist

- [x] GitHub Actions on the PR branch passed `npm run check`, the full automated test suite, the deployed health/configuration smoke test, and the world-intelligence build at commit `92159784d4a9f4a15739dba2196c9ff35a1143cc`.
- [x] Automated tests verified task-based skill selection, pinned ECC revision metadata, local Markdown loading, delivery of the bundled skills into the agent-model request, and zero ECC-network calls during that request.
- [x] The selected task-skills metadata endpoint is covered by route-level automated tests using a synthetic authenticated user.
- [ ] A real provider-backed request on an authorized, live test account has not been run here; mock-model assertions do not establish production inference or deployment.
- [x] The ECC source revision remains pinned and the upstream MIT license notice is included at `vendor/ecc/LICENSE`.

The source branch is CI-green but this PR is not merged. No deployment or production configuration changes were made.
