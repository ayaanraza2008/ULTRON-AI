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


## Expanded owner requirement: PC + Android + phone-call presence

The owner explicitly wants the same personal ULTRON identity available on both their Windows PC and Android phone, with the ability to contact the owner and perform approved work across devices.

### Cross-device system shape

- **ULTRON Core:** the existing backend remains the source of truth for identity, memory, task orchestration, policy, audit events and device sessions.
- **Windows companion:** a signed, least-privilege local agent for approved desktop actions, screen/context capture only during an explicitly enabled session, local wake-word handling where feasible, and secure pairing to ULTRON Core.
- **Android companion:** a native Android app for voice/text, push notifications, secure pairing, approved device actions, foreground microphone sessions and visible privacy controls.
- **Shared session and task model:** conversations and task state synchronize through authenticated owner-bound APIs. Each device has revocable credentials and a device-specific capability grant. A phone must not inherit unrestricted PC permissions, or vice versa.
- **Reachability:** use push notifications for reliable wake-up/alerts and a persistent foreground service only for user-visible, user-enabled real-time functions. Do not promise that a normal Android app can silently run an always-on microphone in the background under all OEM/OS conditions.

### Owner-initiated and ULTRON-initiated calls

- The owner should be able to call ULTRON from Android using an in-app voice session; a supported telephony/VoIP route may be added for calling ULTRON like a normal contact.
- ULTRON may place outbound calls to the owner's verified number for explicitly configured reasons (for example, a scheduled briefing or urgent task alert). Every outbound call must be rate-limited, logged and controllable with quiet hours, a do-not-call switch and immediate revocation.
- Where a real telephone call is required, use a lawful telephony provider or supported device calling integration. Do not assume a web app can place carrier calls by itself, and do not make paid telephony accounts or incur per-minute charges without owner approval.
- For incoming SIM calls, Android integration must be evaluated against the actual device and Android release. The supported route is a user-approved default dialer implementation using Android Telecom `RoleManager.ROLE_DIALER` and `InCallService`, or a user-approved call-screening integration where that is sufficient. These roles have OS-defined requirements and must not be bypassed.
- Automated answering/conversation is an explicit opt-in mode, initially restricted to an owner-selected allowlist and clear rules (for example, answer only selected contacts when the owner is busy). Unknown callers should follow a safe default such as ring normally or go to voicemail, not be autonomously engaged.
- If ULTRON speaks to another person, it must identify itself as the owner's AI assistant when the context could otherwise mislead the caller. It must not impersonate the owner, make commitments, disclose private data, authenticate as the owner, or record/transcribe calls without appropriate notice and consent.
- Before enabling live call audio, verify applicable telecom provider terms, Android/OEM support, recording/transcription consent rules and local law. If any required capability is unavailable, provide an honest fallback (notification, missed-call summary, or ask the owner to answer).

### Call handling policy

1. **Owner calls ULTRON:** authenticate the owner through the paired app/session; start voice interaction and allow the owner to assign tasks.
2. **ULTRON calls owner:** only from a configured event or schedule; announce itself and the reason; provide an immediate stop/opt-out path.
3. **Incoming contact call:** apply the owner's explicit per-contact rule; no silent answering by default.
4. **Incoming unknown/urgent/service call:** do not auto-answer or share owner information by default; notify the owner.
5. **Emergency calls:** always leave emergency calling to the system dialer and never intercept or automate emergency calls.

### Revised implementation order

1. Build/verify owner-only device registration, per-device revocation and cross-device task/session synchronization.
2. Deliver a working Android companion for authenticated voice/text and push alerts.
3. Deliver Windows companion pairing and bounded desktop-control actions.
4. Add owner-initiated in-app calling to ULTRON.
5. Add optional outbound calls to the owner's verified number using an approved telephony provider, with costs and consent controls.
6. Prototype incoming-call integration on the owner's actual Android device; request default dialer/call-screening roles only if the implementation fully satisfies Android requirements.
7. Add tightly scoped, opt-in AI call answering for selected contacts only after live device/provider/legal verification.

### Acceptance tests for this expanded requirement

- Owner can sign in on PC and Android; a second account cannot access either device session or shared data.
- Revoking a device invalidates its tokens and stops future task execution from that device.
- A task started on one device is visible on the other and has a consistent, auditable lifecycle.
- Owner can initiate a live voice session with ULTRON from Android.
- Outbound ULTRON call reaches only the verified owner number, obeys quiet hours/rate limits and can be stopped/revoked.
- Incoming-call behavior is tested on the actual Android model and OS version; unsupported states fall back safely.
- AI answering is off by default, limited to explicitly approved contacts/rules, identifies itself as AI and never impersonates the owner.
- No call recordings or transcripts are retained unless separately enabled with appropriate notice, consent and retention controls.
