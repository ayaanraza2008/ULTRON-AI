# Blockers

| ID | Blocker | Impact | Required resolution | Can independent work continue? |
|---|---|---|---|---|
| BLK-001 | Live cloud-model inference is not yet verified end-to-end | Health reporting that a provider is configured does not prove a real prompt succeeds | Run an authorized text request and image request using the configured OpenRouter key/model; verify response and safe fallback behavior | Yes: tests and non-provider backend work continue |
| BLK-002 | Supabase Auth signup/sign-in, recovery email delivery, and reset flow need end-to-end verification | Mocked tests do not prove a real user's session, email delivery, or password reset works | Verify Auth email settings and redirect URL; test signup, confirmation, sign-in, recovery email, password reset, and session renewal using a test account | Yes: recovery API and regression tests are merged; live email/reset verification remains |
| BLK-003 | Conversation persistence and account isolation need live verification | History may fail to save/read or RLS may be misconfigured despite schema and mocked tests | Verify conversation create/read and message insert/read, then confirm cross-user denial with two test accounts | Yes: schema, APIs, and mocked tests are present |
| BLK-004 | Web research, speech, and voice providers need live verification | Adapter tests do not prove external provider reachability, quality, quotas, or live failure handling | Run real research, text-to-speech, and speech-to-text requests where credentials are configured; treat browser-native speech as best-effort | Yes: adapters and safe fallbacks can be improved |
| BLK-005 | External integrations need deployment, model, hardware, and license checks | A configured URL does not prove the service works or that models/hardware are available; source licenses may limit reuse | Review each dependency and model license; verify provider health and workflow execution before claiming integration complete | Yes: documented adapters can continue |
| BLK-006 | Account-scoped memory retrieval needs live-user verification | Memory may be stored but not consistently recalled or isolated across users | Test memory preference, capture/retrieval, and cross-account isolation end-to-end | Yes: memory APIs and mocked tests are present |
| BLK-007 | Windows PC control requires a paired, authenticated desktop companion | A cloud Render service cannot directly control a user's local Windows desktop; installer behavior is not verified on physical Windows hardware | Install and pair the companion on Windows; verify authentication, action allowlist, visible status, and recovery behavior | Yes: cloud-side adapter and diagnostics can continue |
| BLK-008 | Restricted Python sandbox source is implemented but deliberately disabled pending host verification | Coding assistance is not equivalent to executing untrusted code autonomously; the production host must prove Docker isolation, image provenance, and daemon cleanup | Configure an approved digest-pinned Python image on a dedicated local/worker host, verify network isolation, filesystem isolation, resource caps, timeout/container cleanup, and owner authorization; keep `ULTRON_CODE_SANDBOX_ENABLED=false` until all checks pass | Yes: sandbox code and CI tests can continue |
| BLK-009 | Consequential production changes remain confirmation-gated | Automated agents must not silently deploy, restart, spend, publish, or change production configuration | Keep independent task-specific confirmation for each consequential capability. A scoped Chrome click approval flow is implemented on feature branch `feature/scoped-approvals-and-code-sandbox-20261031`; it is not merged or live-verified. Deploy/configuration actions remain separately gated | Yes: read-only diagnostics and safe changes can continue |
| BLK-010 | Render previously reported a high-severity npm advisory; latest CI audit does not reproduce it | The exact cause of the earlier Render warning is not yet identified | Compare the exact Render build log and resolved dependency tree before changing versions; do not run blind `npm audit fix` | Yes: latest CI found 0 vulnerabilities in both the install audit and `npm audit --omit=dev --audit-level=high` |
| BLK-011 | Resolved: Supabase anonymous table privileges revoked and verified | Anonymous clients should not have direct table-level access to private conversation, memory, and task tables | Migration `revoke_anon_public_table_privileges` is recorded in live migration history; a read-only privilege query confirmed `anon` has no SELECT, INSERT, UPDATE, or DELETE grants on the seven public base tables checked | No further action for this specific grant issue; authenticated RLS isolation still needs end-to-end tests |
| BLK-012 | Resolved for current `main`: the three main services deploy successfully in `Ultron core` | Older quota-exhaustion events stopped earlier deploys; current quota availability can still change | Render reports `ultron-ai-core`, `ultron-rea-gateway` and `ultron-browser-use-core` live at `e608485b609e7d8f51d93dd4d033e636efd44975`; CI run `41173106830` passed. Production-revision health verification run `41172839283` passed for preceding commit `145ac4e648b0ce4bd7805e3420d4ddc92345b665`; obtain a fresh exact-revision health check for `e608485`. Monitor free-tier usage and do not upgrade solely to chase quota. | Yes: continue source and live-flow verification; future quota limits may block later deploys |
| BLK-013 | DNS-pinned outbound transport still needs a controlled live request | A successful deployment/revision check confirms the code is present, not that every outbound destination or upstream workflow behaves correctly | Run a controlled request to an approved public endpoint through the deployed transport, inspect the result without exposing secrets, and retain network-egress restrictions as a separate defence layer | Yes: `network-safety.js` is the default transport in `server.js` and regression tests run in source CI |
| BLK-015 | Full Windows and Android device control is not verified | Cloud services cannot directly access a personal device, and unrestricted remote control would be unsafe | Pair the signed Windows companion on physical hardware, then verify a least-privilege Android companion/app and device authorization; expose only allowlisted actions with per-action confirmation | Yes: companion protocol, diagnostics and Android bridge design can continue |\n| BLK-014 | Supabase Auth leaked-password protection is disabled | Users may choose passwords known to appear in breach datasets; this is an Auth security setting, separate from database RLS | Project owner must enable Leaked Password Protection in Supabase Auth password-security settings, then rerun the Security Advisor. The current integration cannot change this Auth dashboard setting. | Yes: source work and other auth tests can continue; keep signup acceptance provisional until enabled |

## Verification discipline

- Configuration means configured, not healthy. A real provider request or task completion is required before marking a feature verified.
- Latest merged backend security changes include commit `dbd9058b0594f9124859e5aafa7c3e347f309b72` (bounded model-provider response buffering) and `cdc5d1aecf12acff06d36000434dd1d38e999b51` (per-IP auth endpoint rate limiting). CI passed syntax checks, automated tests, the deployed `/api/health` smoke test, and the pinned God’s Eye bridge build.
- The CI install reported 0 vulnerabilities, and `npm audit --omit=dev --audit-level=high` also reported 0 vulnerabilities on that run. This does not prove the earlier Render warning was false; its exact dependency/build context still needs investigation.
- The deployed health endpoint reported `status: ok`, with provider, access, and Supabase configured. This is configuration/startup evidence only, not proof of live model inference or user data flows.
- Live Supabase verification on 2026-10-24 confirmed migration `20261024085626_revoke_anon_public_table_privileges` is recorded and `anon` has no table-level SELECT/INSERT/UPDATE/DELETE privileges on the seven public base tables checked. This does not replace two-user RLS isolation tests.
- Auth signup, sign-in, and recovery now share a bounded in-process per-IP limiter (10 attempts per 15-minute window). Multi-instance deployments should add shared edge/store throttling as well.
- Do not paste credentials into chat or source control. Use Render's private environment settings.
- Current production checkpoint (2026-10-31): Render reports `ultron-ai-core`, `ultron-rea-gateway` and `ultron-browser-use-core` live at `main` commit `e608485b609e7d8f51d93dd4d033e636efd44975` in `Ultron core`. Main CI run `41173106830` passed. Production-revision workflow `41172839283` passed exact health/config/revision checks for preceding commit `145ac4e648b0ce4bd7805e3420d4ddc92345b665`; get a fresh exact-revision health check for `e608485`. The separately hosted `ultron-core-interface` remains live on its feature branch, but browser-to-API E2E is unverified. Render logs returned 503 and direct public-host DNS checks were unavailable from this execution environment.

## DNS-pinned outbound transport (PR #293)

The security branch adds a transport that resolves public hostnames, rejects any private/reserved DNS answer, pins validated addresses into the actual outbound socket lookup, blocks unvalidated redirects, and honors aborts while resolving DNS. It is not live until merged and deployed. This is application-layer defence in depth; deployment-level outbound egress controls remain recommended.


## Paid integration spend controls

- OpenSEO paid lookup authorization is enforced server-side from the current user's explicit prompt and bounded credit ceiling. Model-generated tool arguments cannot authorize spend. Agent-level tests and full CI passed on feature head (run 41115578469); live upstream billing behavior and account quota remain unverified. Do not treat mocked MCP responses as a live account check.


## Chrome DevTools consequential action approval

- Model-generated `confirmExternalAction` is no longer passed to the local Chrome bridge; the ULTRON agent always sends false. The bridge's local operator flag remains an additional guard, not evidence of user consent.
- Consequential external clicks remain blocked until a task-bound user approval flow can display the exact host, selector/action and intended effect, then issue a one-time authenticated approval bound to that operation.


## Chrome DevTools consequential action approval (PR #430, 2026-10-31)

- Model-generated `confirmExternalAction` has been removed from the agent tool schema and cannot be supplied by model tool arguments. Agent dispatch always forces false, and the autonomy policy blocks consequential clicks before local bridge access.
- Source and agent-level regression tests passed in full CI run 41116829247. This does not prove a live Chrome bridge or physical browser workflow.
- PR #430 adds a task-bound, owner-only, one-use approval phrase and exact target revalidation. The flow is not merged or live-verified; keep the local bridge gate off until CI and a real local browser E2E pass. The in-memory challenge store also requires a single backend instance; horizontal scaling needs a shared atomic store before enabling.


## Geo-Sleuth reverse-image sharing consent

- Model-generated `includeReverseSearch: true` must never authorize sending image-derived information to external reverse-image providers.
- The agent schema no longer exposes that flag. The dispatcher derives opt-in from the current user-authored message using an exact canonical approval phrase; ordinary mention, negation, contradictory suffixes and non-exact wording default to off.
- Regression tests added; CI pending. Keep reverse-image search disabled by default and do not treat source tests as proof of provider behavior or location accuracy.


## Geo-Sleuth reverse-image sharing consent (updated 2026-10-31)

- PR #419 merged as `33a9df4`. The model-visible opt-in flag is removed; the dispatcher derives consent only from the exact canonical approval phrase at the start of the current user message.
- Ordinary mention, explicit denial, contradictory trailing text, missing input and non-exact wording default to no external image sharing.
- Full CI run `41119660470` passed (662 passed, 0 failed, 1 skipped; dependency audits clean; pinned World Intelligence build green).
- No external image search was performed. Live provider behavior and geolocation accuracy remain unverified.


- Post-merge verification for Geo-Sleuth consent merge `33a9df4` is green: CI runs `41119784359` (test/build) and `41119785946` (production revision verification) succeeded. No deployment was triggered.


## Voice cloning consent provenance

- The former broad phrase checks could accept vague text such as "my voice" or "I have permission" and could match negated statements.
- Model-visible `consentBasis` has been removed. Server-side consent must now match one of two exact current-user attestations at the start of the raw prompt.
- Parser tests added; CI pending. Until CI passes, do not claim the new consent gate is verified. Live VoiceStudio profile creation/attestation remains unverified.
