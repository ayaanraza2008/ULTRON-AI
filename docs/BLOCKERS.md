# Blockers

This list separates code/deployment evidence from end-to-end capability verification. Status reflects the last available repository and Render evidence; re-check before relying on it.

| ID | Blocker | Impact | Required resolution | Can independent work continue? |
|---|---|---|---|---|
| BLK-001 | Live cloud-model inference is not verified; provider key/model may be missing, invalid, quota-limited, or inaccessible | ULTRON cannot be certified to answer arbitrary prompts or vision requests reliably | Check the authenticated readiness endpoint, privately configure `OPENROUTER_API_KEY` and a valid `OPENROUTER_DEFAULT_MODEL` in Render if needed, then run real text and image requests and a fallback test | Yes: provider adapters, error handling, and tests can continue |
| BLK-002 | Supabase Auth signup/sign-in, recovery email delivery, reset flow, and session renewal need end-to-end verification | Mocked tests do not prove real sessions, email delivery, or password reset | Verify Auth email settings and redirect URLs; test signup, confirmation, sign-in, recovery, reset, and session renewal using a test account | Yes |
| BLK-003 | Conversation persistence and account isolation need live verification | History could fail to save/read or RLS could be misconfigured | With two test accounts, verify conversation create/read, message insert/read, and cross-user denial | Yes |
| BLK-004 | Web research, speech, and optional voice providers need live verification | Adapter tests do not prove provider reachability, quotas, or output quality | Run real research, STT, and TTS requests; verify graceful failures and usage limits | Yes |
| BLK-005 | External integrations need deployment, model, hardware, and license checks | A configured URL does not prove a service works or can run on target hardware | Verify provider health and an actual workflow; review upstream license/model requirements | Yes |
| BLK-006 | Account-scoped memory retrieval needs live-user verification | Stored memory may not be recalled correctly or isolated | Test memory write/read and cross-account denial using separate accounts | Yes |
| BLK-007 | Windows control requires a paired, authenticated desktop companion | A cloud service cannot directly control the user's local desktop | Install and pair on physical Windows hardware; verify authentication, action allowlist, user-visible status, and recovery | Yes |
| BLK-008 | Arbitrary code execution remains intentionally unavailable without a hardened sandbox | Coding assistance is not equivalent to safe autonomous execution | Build an isolated runner with CPU/memory/time limits, restricted filesystem/network access, auditing, and approval gates before enabling execution | Yes |
| BLK-009 | Consequential production operations remain confirmation-gated | Agents must not silently deploy, restart, or change production configuration | Keep task-specific authorization and confirmation; regression-test new action phrasing | Yes |
| BLK-010 | Render reported one high-severity npm vulnerability in logs during the 2026-10-24 deployment; the affected package and dependency path have not yet been identified | The production dependency risk is not understood well enough to fix safely | Reproduce `npm audit --omit=dev --audit-level=high` in a controlled branch, identify the direct/transitive dependency and fixed version, update deliberately, run tests, and deploy only after review. Do not blindly run `npm audit fix` in production | Yes, but treat the vulnerability as unresolved until the audit output is reviewed |
| BLK-011 | A Supabase privilege-revocation migration was committed, but application to the live database has not been confirmed | Repository migration files alone do not change the database | Apply migrations through the authorized Supabase migration workflow and verify intended grants/RLS with a safe read-only check; then test authenticated access | Yes |

## Verification discipline

- Configuration means configured, not healthy. A real provider request or completed task is required before marking a capability verified.
- CI passing proves only the tested revision and assertions. It does not prove live provider inference, account isolation, physical-device pairing, or end-to-end task completion.
- Render logs previously confirmed that the service process started on port 10000 and the deployment became live. This proves process startup only, not model inference or all endpoints.
- The last available `package.json` has runtime dependencies but no `package-lock.json` was found at the repository root. CI currently uses `npm install --ignore-scripts`; dependency resolution may therefore be less reproducible. Confirm repository state and generate/commit a lockfile using a trusted Node/npm environment before switching CI/deploy to `npm ci`.
- Do not paste credentials into chat or source control. Use Render's private environment settings.
- Keep the frontend deferred until backend capability and security verification are substantially complete.
- Keep destructive actions, private-data access, device control, and external side effects behind task-specific authorization/confirmation.
- Do not enable arbitrary code execution without a hardened sandbox.