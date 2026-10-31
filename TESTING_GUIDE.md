# ULTRON AI — Automated Testing & Verification Guide

> **Authoritative Testing Framework, Test Suites, and Verification Procedures**  
> Applicable to: **Google Antigravity** | **Claude Code** | **OpenAI Codex**

---

## 1. Testing Philosophy & Non-Negotiable Standards

1. **Deterministic by Default:** Unit and integration test suites run offline by default using mocked external dependencies to ensure fast, reproducible CI execution.
2. **Never Confuse Mocks with Live Verification:**
   - A passing mocked test proves that the internal logic, state handling, and error branches function correctly.
   - It does **not** prove live network reachability, third-party API quota availability, or cloud credentials.
3. **Evidence-Based Reporting:** In all test reports, clearly categorize tests into:
   - **PASSED:** Verified with explicit test assertions.
   - **SKIPPED:** Intentionally bypassed (e.g., opt-in live tests without credentials).
   - **BLOCKED:** Cannot proceed due to missing configuration or network restrictions.
   - **FAILED:** An assertion failed or threw an unexpected error.

---

## 2. Test Execution Commands

### A. Static Syntax & Type Checks
Runs Node's built-in syntax checker across all core modules and test files:
```bash
npm run check
```

### B. Core Server & Routing Tests
Verifies API server request dispatching, session handling, and parameter parsing:
```bash
node --test test/server.test.js
```

### C. Security & Infrastructure Tests
Verifies DNS-pinning, SSRF prevention, runtime readiness, and health report safety:
```bash
node --test tests/server-health.test.js tests/runtime-readiness.test.js tests/network-safety.test.js
```

### D. Full Automated Suite
Executes all unit tests in the repository:
```bash
npm test
```

---

## 3. Dedicated Diagnostic & Smoke Scripts

### 1. Read-Only Supabase Auth Diagnostics
Inspects public Supabase Auth settings without writing data or sending emails:
```bash
npm run diagnose:auth
```
- **Inputs:** `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`
- **Output:** Reports whether email signup, email confirmation, Google OAuth, and phone auth are enabled.

### 2. Live Model Provider Smoke Test (Opt-In)
Performs an isolated model completion check against OpenRouter or configured alternate providers:
```bash
npm run smoke:model
```
- **Inputs:** `OPENROUTER_API_KEY` (or alternate provider keys)
- **Output:** Redacted verification report proving live model inference without logging prompts or tokens.

### 3. Worker Integration Smoke Test (Opt-In & Guarded)
Validates task queue polling, task status progression, and cleanup:
```bash
ULTRON_CONFIRM_WORKER_SMOKE=YES \
SUPABASE_URL=https://opdjfhwepmcprbqojpat.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=YOUR_SECRET_KEY \
ULTRON_SMOKE_USER_ID=YOUR_TEST_USER_UUID \
npm run smoke:worker
```
- **Requirements:** Must supply `ULTRON_CONFIRM_WORKER_SMOKE=YES` and a disposable test-user UUID.

### 4. Supabase E2E Two-Account Isolation Test (Opt-In)
Validates cross-account data isolation and Row Level Security:
```bash
ULTRON_E2E_ALLOW_WRITES=CONFIRM_ULTRON_E2E_WRITES \
npm run test:supabase:e2e
```
- **Requirements:** Requires two distinct test accounts to prove that Account A cannot read or write Account B's conversations, messages, or memory items.

---

## 4. Test Directory Layout

```
tests/
 ├── agent-runtime.test.js               # Autonomous agent loop tests
 ├── agent-runtime-approval-guard.test.js # High-risk action approval tests
 ├── autonomy-policy.test.js              # Risk matrix classification
 ├── cognitive-memory.test.js             # Vault storage and retrieval
 ├── network-safety.test.js               # DNS-pinning and SSRF defenses
 ├── runtime-readiness.test.js            # Readiness probe verification
 ├── server-health.test.js                # Health check and commit exposure
 ├── document-storage.test.js             # Binary document storage & RLS
 ├── model-provider-fallbacks.test.js     # Multi-provider fallback logic
 ├── browser-use-model-proxy.test.js      # Browser Use proxy retries
 └── worker.test.js                       # Queue worker polling & execution
```

---

## 5. Pre-Merge Verification Checklist

Before submitting a Pull Request, verify:
- [ ] `npm run check` passes with exit code 0.
- [ ] `node --test test/server.test.js` passes 100% of tests.
- [ ] `node --test tests/server-health.test.js tests/runtime-readiness.test.js tests/network-safety.test.js` passes.
- [ ] New functionality is covered by at least one dedicated test file or suite.
- [ ] No temporary debugging code (`console.log`, hardcoded dummy values) remains.
- [ ] No secret values or sensitive tokens are stored in test fixtures.
