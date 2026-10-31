# ULTRON AI — BLOCKERS & DEPENDENCY REGISTER
## PROJECT CODENAME: ULTRON ETERNAL
### EVIDENCE-BACKED REGISTER OF EXTERNAL DEPENDENCIES & REMAINING BLOCKERS
**Audit Date:** 2026-11-01T01:00:00+05:30  
**Source of Truth:** Repository `ayaanraza2008/ULTRON-AI`

---

## 1. ACTIVE EXTERNAL BLOCKERS & HARDWARE BOUNDARIES

| ID | Category | Item Description | Type | Status | Exact Blocker Detail & Required Action |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **BLK-001** | LLM Gateway | Live Model Completion (`smoke:model`) | `EXTERNAL_CREDENTIAL` | `BLOCKED` | `npm run smoke:model` reports `NO_ELIGIBLE_PROVIDER`. Requires operator to set `OPENROUTER_API_KEY` or valid `ULTRON_MODEL_PROVIDERS_JSON` in environment. |
| **BLK-002** | Vision (EYES) | Live Vision Inference (`smoke:vision`) | `EXTERNAL_CREDENTIAL` | `BLOCKED` | `npm run smoke:vision` reports `OPENROUTER_API_KEY_REQUIRED` when `ULTRON_CONFIRM_VISION_SMOKE=YES`. Requires valid `OPENROUTER_API_KEY` for live multimodal visual Q&A. |
| **BLK-003** | Autonomous Worker | Background Worker Execution (`smoke:worker`) | `EXTERNAL_CREDENTIAL` | `BLOCKED` | `scripts/worker-smoke.mjs` requires `ULTRON_CONFIRM_WORKER_SMOKE=YES`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and a disposable `ULTRON_SMOKE_USER_ID`. |
| **BLK-004** | Authentication | Two-Account Live Database Isolation E2E | `EXTERNAL_CREDENTIAL` | `BLOCKED` | `tests/supabase-isolation.e2e.test.js` is intentionally skipped. Requires 2 dedicated disposable test accounts (`ULTRON_E2E_USER_A_EMAIL/PASSWORD` and `B`), plus `ULTRON_E2E_ALLOW_WRITES=CONFIRM_ULTRON_E2E_WRITES`. |
| **BLK-005** | Security Advisor | Supabase Leaked Password Protection | `PLATFORM_PLAN` | `BLOCKED` | Supabase Security Advisor advisory `Leaked Password Protection Disabled`. Supabase documents this as a Pro-tier feature. Organization `Ayaan` is on the Free tier. Requires manual owner review or plan upgrade. |
| **BLK-006** | Hardware (EYES) | Render Cloud Direct Webcam Access | `PHYSICAL_BOUNDARY` | `BLOCKED_BY_DESIGN` | Headless Linux Render container cannot directly access physical laptop webcams. Camera feed is captured client-side in the browser via `navigator.mediaDevices.getUserMedia()` and streamed to `/api/jarvis/eyes/frame`. |
| **BLK-007** | Telephony | Live PSTN Telephony Inbound/Outbound | `EXTERNAL_CREDENTIAL` | `BLOCKED` | Live phone calling requires active Twilio or SIP gateway credentials (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`). |
| **BLK-008** | Desktop Automation | Unrestricted Local PC Execution | `SECURITY_BOUNDARY` | `BLOCKED_BY_DESIGN` | PC control is restricted to allowlisted executables and safe path containment. Arbitrary shell commands are blocked by design. Coding sandbox requires verified Docker daemon. |
| **BLK-009** | Robotics | Physical Motor & Actuator Hardware | `PHYSICAL_BOUNDARY` | `OUT_OF_SCOPE` | Physical robotics hardware is explicitly out-of-scope for this phase. Software HAL, kinematics, geofencing, and latching e-stop are verified in simulation mode. |

---

## 2. REQUIRED OPERATOR ACTIONS CHECKLIST

1. **Model Provider Credentials (Optional for Live Cloud Calls):**
   - Provide `OPENROUTER_API_KEY` in environment to enable live cloud model completions and multimodal visual perception inference.
2. **Dedicated Test Accounts for Live Supabase E2E (Optional):**
   - Create 2 disposable test users in Supabase Auth and set `ULTRON_E2E_USER_A_EMAIL`, `ULTRON_E2E_USER_A_PASSWORD`, `ULTRON_E2E_USER_B_EMAIL`, `ULTRON_E2E_USER_B_PASSWORD`, and `ULTRON_E2E_ALLOW_WRITES=CONFIRM_ULTRON_E2E_WRITES` to unskip `tests/supabase-isolation.e2e.test.js`.
3. **Supabase Leaked Password Protection Decision:**
   - Review whether to upgrade Supabase plan to Pro for automated HaveIBeenPwned leaked password protection, or retain Free tier with existing robust client/server password complexity validation.
4. **Production Deployment Approval:**
   - Render deployment must remain on current stable commit `b00c2e81` until operator explicitly grants approval to merge and deploy feature branches.

---

## 3. VERIFIED AUTOMATED SOFTWARE BASELINE

- **Automated Tests:** **1,047 Total — 1,046 PASS, 0 FAIL, 1 SKIP**
- **Syntax Verification:** **270 / 270 Files Clean**
- **Active Code Defects:** **0**
- **Security Regressions:** **0**
