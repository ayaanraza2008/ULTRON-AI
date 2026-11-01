# ULTRON AI — Master Acceptance Matrix (Evidence-Based)

**Audit date:** 2026-11-01  
**Code commit:** `e54103f27f2034ca4e890a24879fbc1cd96018d6`  
**PR #440:** open, unmerged  
**Important:** This is an acceptance matrix, not a declaration that all rows are complete.

| Domain | Software evidence | Live / release evidence | Status |
|---|---|---|---|
| Core API and architecture | Broad modules, tests and syntax CI pass | Full integrated operating scenario not demonstrated | PARTIAL |
| LLM text inference | Provider abstraction/fallback and test fixtures | Genuine current model smoke not verified | BLOCKED |
| Vision / EYES | Real vision adapter, fail-closed missing-provider behaviour | Live image-Q&A smoke requires approved credential | BLOCKED |
| Memory / history | Account-scoped routes and persistence code | Two-user isolation test skipped | PARTIAL |
| Background agents/workers | Queue lifecycle, leases, retries and deterministic tests | Live disposable Supabase task round-trip not verified | PARTIAL |
| Voice | Kokoro adapter; diagnostic tone rejected as speech; Fish legacy opt-in gate | Genuine target-PC speech and mic/wake E2E not verified | PARTIAL |
| Windows companion | .NET 8 x64 build/publish pass | Physical host integration not verified | BUILD VERIFIED |
| Browser automation | Python bridge tests and approval gates pass | Live authenticated paired-browser E2E not verified | PARTIAL |
| Coding sandbox | Fail-closed and resource-boundary configuration tests | Docker isolation on actual host not verified | PARTIAL |
| Cyber Recon | DNS lookup; fabricated port/TLS claims removed | No active port scanner/TLS handshake in passive module | PARTIAL |
| Cyber Scanner / Web | Input-analysis logic and evidence provenance now explicit | Caller data not independently probed | PARTIAL |
| Security quality gate | SAST/secret scanner + npm audit reports zero findings | No external penetration-test certification | AUTOMATED PASS |
| Media editing | Real FFmpeg fixture renders valid MP4 with audio mixing (AAC + H.264 streams) | Verified locally with FFmpeg probe | VERIFIED |
| Robotics simulation | CPU-oriented simulation, OpenUSD/export and scenario code | External simulator and physical HIL not validated | PROTOTYPE |
| Device pairing | AES-256-GCM local persistence tests, owner-scoping logic | Render persistence/restart and PC pairing unverified | PARTIAL |
| Frontend/backend integration | Reconciled PWA, WebGL living core, proxy gateway & 24/24 tests | Verified in local suite; staging deploy pending | VERIFIED |
| Production deployment | Candidate PR and CI verified | Candidate not merged/deployed; Render metrics/logs inconclusive | NOT READY |

## Quantitative gates

| Gate | Current result | Acceptance to call 100% |
|---|---|---|
| Node tests | 1,246 total; 1,245 pass; 0 fail; 1 skip | All tests pass; live gated E2E actually runs |
| Syntax | 318/318 | Current and clean on release commit |
| CI | ULTRON CI and Windows Companion pass | All required checks pass on exact release commit |
| Security | Native quality gate 0 findings; npm audit 0 | Add external security review as required by risk; no claim of absolute safety |
| Live model/vision | Not verified | Genuine provider responses |
| Worker + RLS | Partial; two-user test skipped | Real task persistence and cross-account denial |
| Hardware/device | Build/software tested | Actual PC mic, voice, pairing and allowlisted control |
| Staging | Not verified end-to-end | All key authenticated flows pass together |
| Production | PR open/unmerged | Explicit owner approval, deploy becomes live and post-deploy smoke passes |

## Score (estimate)

- Code / architecture: **90%**
- Automated CI: **99.9%** (1,200/1,201 passed; one gated skip)
- Live operational verification: **40%**
- Production readiness: **20%**
- **Overall: 63%** (30% code + 20% CI + 30% live operation + 20% release readiness).

The overall score is an engineering estimate, not a guarantee. Do not change any row to LIVE_VERIFIED without dated evidence from the real target environment.
