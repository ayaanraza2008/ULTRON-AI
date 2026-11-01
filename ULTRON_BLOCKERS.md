# ULTRON AI — BLOCKERS & DEPENDENCY REGISTER
## PROJECT CODENAME: ULTRON ETERNAL
### EVIDENCE-BACKED REGISTER OF EXTERNAL DEPENDENCIES & REMAINING BLOCKERS
**Audit Date:** 2026-11-01T15:58:00+05:30  
**Source of Truth:** Repository `ayaanraza2008/ULTRON-AI`

---

## 1. ACTIVE EXTERNAL BLOCKERS & RESOLUTION MATRIX

| ID | Category | Item Description | Type | Status | Exact Resolution & Mitigation Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **BLK-001** | LLM Gateway | Live Model Completion (`smoke:model`) | `EXTERNAL_CREDENTIAL` | `BLOCKED` | `npm run smoke:model` reports `NO_ELIGIBLE_PROVIDER` when credentials absent. Upgraded runner to auto-detect `GROQ_API_KEY`, `GEMINI_API_KEY`, and `CEREBRAS_API_KEY` directly from environment in addition to OpenRouter. |
| **BLK-002** | Vision (EYES) | Live Vision Inference (`smoke:vision`) | `EXTERNAL_CREDENTIAL` | `BLOCKED` | `npm run smoke:vision` reports `OPENROUTER_API_KEY_REQUIRED` when `ULTRON_CONFIRM_VISION_SMOKE=YES`. Requires valid `OPENROUTER_API_KEY` for live multimodal visual Q&A. |
| **BLK-003** | Autonomous Worker | Background Worker Execution (`smoke:worker`) | `EXTERNAL_CREDENTIAL` | `BLOCKED` | `scripts/worker-smoke.mjs` requires `ULTRON_CONFIRM_WORKER_SMOKE=YES`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and a disposable `ULTRON_SMOKE_USER_ID`. |
| **BLK-004** | Authentication | Two-Account Live Database Isolation E2E | `EXTERNAL_CREDENTIAL` | `BLOCKED` | `tests/supabase-isolation.e2e.test.js` is intentionally skipped. Requires 2 dedicated disposable test accounts (`ULTRON_E2E_USER_A_EMAIL/PASSWORD` and `B`), plus `ULTRON_E2E_ALLOW_WRITES=CONFIRM_ULTRON_E2E_WRITES`. |
| **BLK-005** | Security Advisor | Supabase Leaked Password Protection | `PLATFORM_SETTING` | `PLATFORM_WARNING_ACTIVE` | Live Supabase Security Advisor still reports `Leaked Password Protection Disabled`. Application-side HaveIBeenPwned k-anonymity checks are additional mitigation for covered signup/password-change paths; they do **not** enable Supabase Auth's platform setting or clear the warning. Keep open until the platform toggle is enabled on an eligible plan or the limitation is explicitly accepted. |
| **BLK-006** | Windows Host Daemon | Windows Companion Installation & Physical Voice/Control E2E | `PARTIALLY_VERIFIED` | `DEVICE_E2E_PENDING` | Install/uninstall scripts and CI build exist; earlier host diagnostics cover vitals and local state transitions. The actual wake-to-dictation patch awaits new Windows CI, and physical microphone capture, a durable paired-device token, remote command dispatch, and authorised PC-action round-trip are not verified. |
| **BLK-007** | Browser Automation | Browser-Use Bridge & Scoped Actions | `SOFTWARE_VERIFIED` | `RESOLVED` | Browser session management, DOM extraction, and navigation implemented in `browser-use-bridge/`. Consequential actions (purchases, emails) gated behind intent verification. |
| **BLK-008** | Coding Sandbox | Isolated Containerized Code Execution | `SOFTWARE_VERIFIED` | `RESOLVED` | Implemented `tools/sandbox/coding-sandbox.js` with Docker daemon discovery, resource limits (`--memory=256m`, `--cpus=0.5`), network isolation (`--network none`), read-only root, and timeout handling. Verified fail-closed security boundary when Docker is absent and container limits when Docker is present (`tests/coding-sandbox.test.js`). Deterministic across local and CI environments. |
| **BLK-009** | Physical Robotics | Simulation & Hardware-in-the-Loop (HIL) | `SOFTWARE_VERIFIED` | `RESOLVED` | Implemented `robotics/simready-simulation-engine.js` with NVIDIA SimReady 3D asset discovery, OpenUSD (USDA) export, joint PID effort controllers, synthetic depth camera point clouds, training scenarios, datasets (JSON/CSV), and ROS 2 HIL bridge. Verified across 14 automated tests (`tests/robotics-simulation.test.js` & `tests/robotics-twin-sim.test.js`). |
| **BLK-010** | Operator Authorization | Cryptographic Operator Modification Gate | `SOFTWARE_VERIFIED` | `RESOLVED` | Implemented `security/operator-authorization.js` and mounted `/api/jarvis/evolution/challenge` and `/api/jarvis/evolution/apply`. Single-use HMAC-SHA256 tokens bound to owner, file path, and modification digest. Immutable paths strictly blocked. Replay attacks prevented. Verified across unit and integration tests. |
| **BLK-011** | Device Pairing & Hub | Durable Companion Pairing Lifecycle & Token Provisioning | `PARTIALLY_IMPLEMENTED` | `BLOCKED` | Encrypted local-file persistence, SHA-256 token hashing, rotation/revocation, owner binding and atomic writes are implemented and covered by lifecycle tests. Persistence is enabled only with an explicit `ULTRON_DEVICE_STORE_PATH` plus a dedicated `ULTRON_DEVICE_SIGNING_SECRET` (32+ characters); pairing routes now fail closed without both. The Supabase migration is prepared with service-role-only pending pairing rows, but the live migration is not applied and `DeviceHub` does not yet use the Supabase tables. Render volume persistence and live device pairing/Windows round-trip remain unverified. |

---

## 2. REQUIRED OPERATOR ACTIONS CHECKLIST

1. **Model Provider Credentials (Optional for Live Cloud Calls):**
   - Provide `OPENROUTER_API_KEY`, `GROQ_API_KEY`, or `GEMINI_API_KEY` in environment to enable live cloud model completions and multimodal visual perception inference.
2. **Dedicated Test Accounts for Live Supabase E2E (Optional):**
   - Create 2 disposable test users in Supabase Auth and set `ULTRON_E2E_USER_A_EMAIL`, `ULTRON_E2E_USER_A_PASSWORD`, `ULTRON_E2E_USER_B_EMAIL`, `ULTRON_E2E_USER_B_PASSWORD`, and `ULTRON_E2E_ALLOW_WRITES=CONFIRM_ULTRON_E2E_WRITES` to unskip `tests/supabase-isolation.e2e.test.js`.
3. **Docker Installation for Coding Sandbox Execution (Optional):**
   - Install Docker Desktop on Windows (`winget install Docker.DockerDesktop`) and pull `node:20-alpine` and `python:3.11-alpine` to enable containerized code execution. Sandbox currently fails closed safely by design.
4. **Production Deployment Approval:**
   - Render deployment must remain on current stable commit `b00c2e81` until operator explicitly grants approval to merge PR #440 and trigger production deployment.

---

## 3. VERIFIED AUTOMATED SOFTWARE BASELINE (AUDITED PR HEAD)

- **Automated Tests:** **1,184 Total — 1,183 PASS, 0 FAIL, 1 SKIP** on PR head `7e2d2b9b56595c67d2bb69d91e745b8c47093659` (GitHub Actions run 41323133858). The only skipped test is live two-account Supabase isolation; it requires disposable accounts and `ULTRON_E2E_ALLOW_WRITES=CONFIRM_ULTRON_E2E_WRITES`.
- **Syntax Verification:** **304 / 304 Files Clean** on PR head `7e2d2b9b56595c67d2bb69d91e745b8c47093659`.
- **Windows Companion:** .NET 8 standalone win-x64 compile/publish and artifact upload passed.
- **Skipped:** live two-account Supabase isolation E2E only. The FFmpeg integration test now executes in CI with FFmpeg installed and successfully renders/validates a real MP4.
- **Security snapshot:** prior native report listed zero findings, but external scanners (Semgrep, Trivy/OSV, Gitleaks and ESLint security plugins) were unavailable; not an independent certification.
- **Live model, vision, worker, two-account RLS, durable device pairing and physical Windows voice/control remain unverified or blocked.
