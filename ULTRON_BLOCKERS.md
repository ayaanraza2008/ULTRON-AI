# ULTRON AI — Active Blocker & Dependency Register

**Audit date:** 2026-11-02 (Asia/Kolkata)  
**Candidate:** [PR #441](https://github.com/ayaanraza2008/ULTRON-AI/pull/441) — OPEN, NOT MERGED  
**Target Render workspace:** **Ultron core** (`https://ultron-ai-core.onrender.com`)  
**Production base:** `main` at `b00c2e81d0ab930f81f0f680e4dc8213fb1b5281`  

**Safety rule:** Do not paste secrets into chat or commit them. Do not buy paid plans, write to production data, apply the Supabase migration, sync Render, merge or deploy without explicit owner approval.

| Priority | Area | Verified current truth | What still closes it |
|---|---|---|---|
| P0 | Live text inference | Multi-provider fallback, BrainRouter, Cerebras detection, and rate-limit recovery fully tested. Google AI Studio key validation in place. Live outbound request requires valid cloud key. | Supply valid `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `CEREBRAS_API_KEY`, or an `AIzaSy...` `GEMINI_API_KEY` in environment; run `npm run smoke:model`. |
| P0 | Vision / Eyes | Synthetic PNG generation, MIME allowlists, payload bounding, and multimodal request schemas tested. Dual fallback (OpenRouter + Gemini Flash) implemented. Live image Q&A requires cloud vision key. | Run `npm run smoke:vision` with an approved vision provider key and synthetic non-sensitive image. |
| P0 | Worker execution | Worker lifecycle, task leases, attempt fences, DLQ, and retry logic pass deterministic tests. Live worker requires Supabase credentials. | Execute bounded disposable-user worker smoke (`scripts/worker-smoke.mjs`) against test Supabase project. |
| P0 | Two-user RLS | RLS SQL schemas and unit tests verified. Live two-account E2E test safely skips without disposable credentials to avoid cloud pollution. | Configure two disposable Auth accounts with `ULTRON_E2E_ALLOW_WRITES=CONFIRM_ULTRON_E2E_WRITES`; run `node --test tests/supabase-isolation.e2e.test.js`. |
| P0 | Supabase Auth security | k-anonymity breached-password screening implemented locally. Remote Security Advisor reports leaked-password protection disabled. | Operator toggles leaked-password protection in Supabase Dashboard (Authentication -> Security). |
| P1 | Spatial Intelligence (Diorama) | Isolated multi-backend adapter, 3D scene graph, geometry export (OBJ/GLTF), WebGL/Canvas viewer, and hardware detector implemented (16/16 PASS). Local CPU fallback operational. | Full zero-shot CUDA inference requires connecting isolated remote GPU worker endpoint (`DIORAMA_REMOTE_ENDPOINT`) with 16GB+ VRAM or running local CUDA GPU. |
| P1 | Device pairing code | Owner REST routes, pairing codes, token revocation, token rotation, and HMAC-SHA256 command signing implemented in `jarvis-router.js` and `system/device-hub.js` (17/17 PASS). | Apply migration `20261101180000_durable_paired_devices.sql` to Supabase and set `ULTRON_DEVICE_SIGNING_SECRET` in Render. |
| P1 | Device storage | Paired-device metadata and encrypted tokens pass unit & storage tests. Production schema not yet applied to remote database. | Apply reviewed migration with owner approval; verify cross-tenant isolation. |
| P1 | Kokoro speech | Free-first voice pipeline active. Defaults to local Kokoro-82M ONNX (`am_onyx`) and browser SpeechSynthesis with Hindi/English support. | Verify local ONNX runtime and weights file on target Windows host; browser voice acts as transparent fallback. |
| P1 | Fish Audio retirement | Hardcoded Fish Audio removed from active voice path; isolated behind opt-in `ULTRON_ENABLE_FISH_AUDIO=true`. Blueprint contains 0 Fish env entries. | Fully verified. Zero action needed unless operator deliberately opts into legacy service. |
| P1 | Windows companion | Pairing UI, DPAPI storage, and system command allowlist implemented. CI x64 compile/publish passed. | Install standalone artifact on physical Windows PC; test microphone, wake word, and allowlisted command round-trip. |
| P1 | Android companion | Native Kotlin app, Keystore storage, and pairing routes implemented. CI APK build passed. | Install debug APK on physical Android device; test permissions, wake listener, and QR pairing. |
| P1 | Browser automation | Python Playwright bridge token auth, private IP blocking, redirect rejection, and SSRF guards tested. | Pair a disposable browser session; test navigation and consequential action approval gating. |
| P1 | Coding sandbox | Fail-closed tests and Docker execution gating verified. Target host container isolation requires Docker daemon. | Run resource/filesystem isolation checks on dedicated Docker host. |
| P1 | Render Blueprint | Reconciled `render.yaml` defines 4 existing services, correct URLs, health routes, `fromService` token sharing, and generated secrets. | Owner review and Blueprint sync in Render Dashboard only after PR #441 merge. |
| P1 | Render observability/staging | Production backend currently on `main` (`b00c2e8`); interface service on older feature branch. | Merge PR #441 and trigger deployment to restore unified staging/production parity. |
| P1 | Third-party dependencies | Pinned World Intelligence build passes; external devDependencies report 5 advisories. ULTRON runtime audit reports 0 vulnerabilities. | Static bundle runs in isolated iframe container with strict CSP (`frame-ancestors 'self'`); no backend exposure. |
| P1 | Media workflow | FFmpeg video/audio mixing and waveform processing pass tests (9/9 PASS). | Test user-provided clips, audio tracks, and H.264 playback in browser UI. |
| P2 | Robotics / HIL | ROS2 digital twin, IK solver, velocity bounds, and E-Stop pass simulation tests. | Physical HIL testing pending hardware connection in lab. |
| P2 | External integrations | Registry includes native, adapter, and fail-closed integrations. | Run scoped round-trip tests for specific external integrations as credentials are provided. |

## Latest automation evidence

- **Node Test Suite:** 1,286 tests — 1,285 passed, 0 failed, 1 skipped (`tests/supabase-isolation.e2e.test.js`).
- **Python Test Suite:** 17 tests — 15 passed, 0 failed, 2 skipped (`tests/test_harness2.py`).
- **Syntax Check:** 332 / 332 files clean (`scripts/check-syntax.mjs`).
- **Security Audit:** 0 vulnerabilities, 0 risks, 0 secrets (`npm run security:report`).
- **GitHub Actions Workflows (PR #441):**
  - Android Companion: [Run 41460327279](https://github.com/ayaanraza2008/ULTRON-AI/actions/runs/41460327279) — PASS
  - Windows Companion: [Run 41460327281](https://github.com/ayaanraza2008/ULTRON-AI/actions/runs/41460327281) — PASS
  - Test Suite (PR): [Run 41460327214](https://github.com/ayaanraza2008/ULTRON-AI/actions/runs/41460327214) — PASS
  - Test Suite (Push): [Run 41460327214](https://github.com/ayaanraza2008/ULTRON-AI/actions/runs/41460327214) — PASS
  - World Intelligence (PR): [Run 41460327214](https://github.com/ayaanraza2008/ULTRON-AI/actions/runs/41460327214) — PASS
  - World Intelligence (Push): [Run 41460327214](https://github.com/ayaanraza2008/ULTRON-AI/actions/runs/41460327214) — PASS
