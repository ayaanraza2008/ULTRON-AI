# ECC-inspired workflow integration (backend-only)

## Decision and scope

ULTRON AI adopts a small, repository-local verification workflow inspired by the public [Everything Claude Code (ECC)](https://github.com/affaan-m/ECC) project. This is a selective adaptation, not a wholesale installation of ECC and not a runtime dependency of the ULTRON API.

The reusable workflow is at `.agents/skills/ultron-backend-verification/SKILL.md`. It focuses on test-first changes, provider failure modes, authentication and tenant isolation, background-task safety, security review, and evidence-based completion reports.

## Licensing

The ECC repository identifies its open-source code as MIT-licensed. MIT generally permits use, modification, and redistribution subject to preserving the applicable copyright and permission notice. See the upstream [repository](https://github.com/affaan-m/ECC) and its [license file](https://github.com/affaan-m/ECC/blob/main/LICENSE).

This ULTRON workflow is newly written and ECC-inspired; it does not vendor upstream implementation files. Before copying any upstream code, skills, scripts, hooks, or other assets into ULTRON, review the exact file's license/notice and preserve required attribution. Do not infer that third-party tools, model weights, external services, or every dependency share ECC's license.

## Compatibility assessment

- The workflow uses portable Markdown skill conventions and should be usable by agent hosts that discover project-local `.agents/skills/<skill-name>/SKILL.md` files.
- It is guidance for the coding agent, not executable application code. It adds no Python/Node runtime package, no network service, no new secret, no model download, and no production configuration.
- Host discovery and actual invocation have not been verified in this repository's runtime. Treat this as an available repository asset, not proof that every IDE or agent host automatically loads it.
- ECC has host-specific adapters and capability differences; do not copy Claude-specific hooks or assume they work in Codex, Copilot, or the ULTRON server runtime.

## What it changes

- Requires inspection before edits and narrowly scoped, test-first changes.
- Distinguishes mocked tests from real provider connectivity and opt-in live end-to-end tests.
- Calls out auth ownership/RLS, worker allowlists, idempotency, cancellation, secret redaction, bounded external calls, and DNS-rebinding limitations.
- Requires a diff review and reports passed, failed, skipped, and blocked verification separately.

## Deliberately not included

- No full ECC checkout or bulk copy of its agents, skills, hooks, rules, or scripts.
- No new runtime dependencies or automated shell hooks.
- No changes to API behavior, database migrations, environment variables, credentials, Render, or Supabase settings.
- No frontend work, deployment, or redeployment.
- No claim that provider, account-isolation, background-worker, or other live tests have passed.

## Verification checklist

- [ ] Confirm the selected agent host discovers this skill.
- [ ] Run a representative backend task using the workflow and confirm it inspects code/tests before editing.
- [ ] Run repository tests and review the final diff before merging.
- [ ] If future work vendors upstream ECC files, record the exact upstream revision and preserve license notices.
