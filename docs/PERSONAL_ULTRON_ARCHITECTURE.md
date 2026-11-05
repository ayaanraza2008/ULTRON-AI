# Personal ULTRON: Single-Owner Product and Architecture Contract

**Status:** Accepted product direction, implementation contract  
**Owner model:** One human owner; no public or multi-tenant product  
**Baseline:** Existing `main` branch; preserve current working capabilities and deployed boundaries  
**Release scope:** Software ULTRON first. Physical robotics remains a later, separately scoped project.

## Product decision

ULTRON is a private personal AI operating system for its sole owner. Its primary purpose is both:
1. A persistent, voice-first personal companion with reasoning, planning, recall and multimodal understanding.
2. A practical computer operator that can work across the owner's PC, browser, files and approved applications.

This is not a public SaaS, chatbot marketplace, team assistant or multi-customer platform. Do not add public onboarding, tenant administration, customer billing, public API plans or social features unless the owner explicitly changes this decision.

## Identity, access and privacy

- Exactly one owner identity is authorized to use the private ULTRON instance.
- Keep the existing authentication and account-scoped data model unless a reviewed migration is necessary. Do not replace working authentication as a shortcut.
- Enforce the owner allowlist on the server for every authenticated API, websocket, worker task, device-pairing flow, integration and data operation. A hidden UI or client-side check is not authorization.
- Provision the owner account through a controlled, documented bootstrap path. Disable public self-registration where the existing auth provider supports it safely; if that cannot be proven from live configuration, keep the service gated and record the blocker rather than claiming exclusivity.
- Continue row-level security and per-owner scoping as defense in depth. Never trust a client-supplied owner ID.
- Do not create test accounts, change live Auth settings, migrate production databases, or alter production secrets as part of ordinary implementation. Use disposable test identities and explicit opt-in acceptance tests.
- Do not expose conversation history, memories, files, camera data, device tokens or integration credentials to other accounts.
- The source repository's visibility is a separate owner decision; do not change repository visibility as part of this product contract.

## Capability priorities

### P0 — reliable personal core
- One owner identity and server-side authorization.
- Chat and voice interaction with clear listening/thinking/speaking/executing states.
- Persistent, owner-scoped conversation history and memory with inspect/delete controls.
- Model-provider abstraction, free-first routing and explicit opt-in for any billable fallback.
- Task lifecycle that distinguishes planned, queued, running, completed, failed and cancelled work.
- Auditable tool calls, bounded permissions, safe error handling and recovery.
- Health/readiness reporting that distinguishes configured, reachable, tested and production-accepted states.

### P1 — computer operation
- Browser research and navigation through allowlisted, authenticated adapters.
- File/document understanding and bounded local file operations.
- Windows companion with explicit action approvals, least privilege and a visible audit trail.
- Device pairing with durable storage, revocation and owner-bound tokens.
- Background workers that demonstrably execute tasks, not merely start successfully.

### P2 — perception and ecosystem
- Camera/vision and hand-gesture interaction with explicit camera/session indicators.
- Android companion and secure device-to-core communication.
- Optional integrations only when their service, license, security boundary, cost and live readiness are verified.
- Robotics/simulation as a future project; do not imply that software ULTRON already controls a physical robot.

## Autonomy and permission model

Autonomy means ULTRON can plan, perform bounded reversible work, verify results and report failures. It does not mean unrestricted authority.

- Read-only research and analysis may run within configured limits.
- Drafts, plans and local reversible changes may be automated within approved workspaces.
- External side effects (sending, publishing, purchases, bookings, deleting user data, changing account/security settings, deploying, or controlling physical devices) require explicit, action-specific confirmation.
- Destructive or irreversible operations require a preview, exact target, confirmation and audit event.
- Secrets remain server-side and must never be included in prompts, logs, test fixtures or client bundles.
- All integrations are disabled until their required credentials, owner scope, network boundary and health checks are verified.
- No automatic paid model use, paid service, model download or infrastructure upgrade without owner approval.

## Hardware and cost constraints

The owner's current development PC is a Ryzen 7 5700U with integrated AMD graphics, 8 GB RAM and 512 GB SSD. Prefer lightweight remote/free-first inference and browser-native or small local components. Do not assume CUDA, dedicated VRAM or large local model downloads. Preserve the existing infrastructure and use Cloudflare or other services selectively; do not migrate infrastructure without evidence and approval.

## Architecture guardrails

- Continue work in the existing `ayaanraza2008/ULTRON-AI` repository. No replacement demo or wholesale rewrite.
- Preserve the existing ULTRON/NAYA experience, history, memory, auth, configuration and working integrations.
- Keep backend authorization authoritative; UI affordances are not security controls.
- Keep optional providers and integrations behind explicit configuration and readiness checks.
- Separate source/CI verification from live provider, worker, Supabase, Render and device acceptance.
- Prefer small, independently reviewable changes and focused regression tests.
- Do not deploy, merge a release branch, run production migrations, or change live infrastructure without a separate explicit release authorization.

## Definition of done

ULTRON is not "100%" because code exists or CI passes. The owner-only product is ready only when all applicable evidence exists:

1. **Exclusive access:** a permitted owner session succeeds; a second disposable non-owner account is denied across API, websocket, task, memory, device and integration surfaces.
2. **Data isolation:** RLS and server-side ownership checks prevent cross-account reads/writes; deletion and revocation behavior is tested.
3. **Core experience:** chat, voice, history and memory work end-to-end with the configured providers and the actual client.
4. **Autonomous tasks:** a real disposable plan-only task is queued, executed by a worker, reaches a truthful terminal state and is safely cleaned up.
5. **Computer operation:** each enabled adapter passes a scoped live acceptance test; unconfigured integrations remain clearly unavailable.
6. **Security:** no exposed secrets, unsafe public signup, missing owner checks, unreviewed high-risk dependencies or unapproved side-effect paths.
7. **Operations:** deployed service health, correct service routing, migrations, worker execution, backups/recovery and monitoring are verified against the actual target environment.
8. **Release:** exact-head CI passes; review and merge are explicit; deployment occurs only after owner authorization.

A skipped test, mocked provider, configured URL, process startup, green build or stale status document is not live acceptance evidence.

## Immediate engineering sequence

1. Reconcile the current main branch, open backend/UI candidates and the current blocker/evidence register.
2. Review the consolidated backend candidate and its dependent UI candidate without merging either automatically.
3. Verify owner authorization coverage and registration/bootstrap behavior before changing auth or schema.
4. Close the highest-risk release blockers: unapplied device-pairing migration, Supabase Auth leaked-password protection, worker live execution, real provider inference, Render Blueprint/health drift and missing branch protection.
5. Run the appropriate isolated tests and collect exact-head evidence for each change.
6. Keep deployment and production mutations gated for explicit owner approval.

## Current evidence snapshot (2026-11-05)

The repository's open review candidates describe:
- Backend PR #473: owner-scoped task APIs, paired-device fail-closed behavior, browser/provider diagnostics, memory deletion semantics and worker readiness counters. Its latest described exact-head CI run passed, but provider calls were mocked and live Supabase/worker/model acceptance remains outstanding.
- UI PR #474: task drawer integrated with the employee task API. It depends on #473 and targets the separately deployed Living Core UI branch; merging can trigger deployment of that UI.
- Documentation PR #466: refreshed release evidence and outstanding operational blockers.

These are review candidates, not merged or deployed capabilities. Re-check their live PR state and exact heads before acting on them.
