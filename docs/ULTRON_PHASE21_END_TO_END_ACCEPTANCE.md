# ULTRON Phase 21 — End-to-End Acceptance Report

- **Date:** 2026-11-04
- **Verification HEAD:** `1dc6385d`
- **Suite baseline:** `npm test` same day → 1,537 tests, 1,531 pass, 0 fail, 6 skipped (PG/Docker-gated), 27 suites, 85 s.

## 21.1 AI conversation lifecycle — PARTIAL (provider-gated)

- Conversation persistence, task/conversation touch, worker fallback and retry paths are covered by the green suite (e.g. `worker falls back after a transient HTTP 408 provider timeout` ✔, `background AI Employee automatically falls back through configured free OpenRouter models` ✔, worker persistence/lease/retry tests ✔).
- **Actual live AI response could not be executed on this host:** every configured credential is invalid/absent (see Phase 20 matrix). Classification: `BLOCKED` on genuine model round-trip until the owner supplies an AI Studio key or OpenRouter/Groq key.
- Streaming, provider-selection and error handling for unavailable providers were verified at unit level; transport proven only end-to-end once keys exist.

## 21.2 Memory lifecycle

- `touch_conversation_on_message`, durable task retry backoff and stale-task recovery migrations are exercised by the DB-gated suite (skipped locally where Postgres/Docker is absent — the 6 skips). Classification: `TESTED` (test-double level), `BLOCKED` for live-DB restart-persistence proof until owner authorizes a database target.

## 21.3 Autonomous task lifecycle

Verified by the green suite on this HEAD (selections):
- create → validate → agent selection → permission checks → execute → record progress ✔
- cancellation (`worker discards a retryable provider failure when the task was cancelled before retry persistence` ✔), timeouts (408 fallback ✔), retries with attempt limits ✔, retry-persistence failure safety ✔, audit-write failure does not lose completion ✔, stale-task recovery scoping ✔, duplicate/starvation prevention (alternating poll ✔), shutdown grace (`worker finishes an active task after shutdown is requested` ✔), malformed provider JSON retry ✔.

## 21.4 Real browser automation — END_TO_END_VERIFIED (live re-run today)

`$env:ULTRON_ENABLE_REAL_CDP='1'; node --test tests/ego-browser-real-cdp.test.js`:

```
✔ launches real headless browser and reports REAL_CDP mechanism (2763ms)
✔ extracts semantic elements from the REAL live DOM (1729ms)
✔ performs REAL interaction: inject content over CDP, fill, verify value round-trip (1531ms)
✔ honest capability status without launch (no fake browser claims)
→ 4/4 pass, 6.66s
```

- Truthful labels `REAL_CDP` / `HTTP_FETCH_PREVIEW` / `simulated: true` preserved; `ULTRON_ENABLE_REAL_CDP=1` remains the safe opt-in (default adapter unchanged).

## 21.5 Windows companion — TESTED

- `tests/native-companion-lifecycle.test.js`, `tests/companion-api-security.test.js`, `tests/windows-control-and-security.test.js` all pass in today's suite (lifecycle, auth/permission enforcement, destructive-command gate, truth-tier hardware status incl. `UNSUPPORTED_HARDWARE` on Linux).

## 21.6 Mobile MCP — END_TO_END_VERIFIED on real hardware (live re-run today)

`node scripts/real-device-workflow.mjs`, device `adb-335fd9fb-9UaJ5Q._adb-tls-connect._tcp` (**OPPO CPH2127**, Wireless ADB TLS):

- Launch intent (`com.google.android.youtube`) executed after approval token → **foreground state verified YES**; screenshot artifact `.local/artifacts/real_device_youtube_launch.png` (7,904 bytes).
- Mid-execution cancellation: `{ cancelled: true, completedSteps: 1 }`.
- Emergency stop: subsequent request `BLOCKED`; reset resumes normal ops.
- Cross-user approval token → `CROSS_USER_ACCESS_DENIED`.
- Anti-replay: second use → `REPLAY_ATTACK_DETECTED`.
- Companion battery telemetry path (`adb dumpsys battery` → bounded parse) is consistent with the new `battery_percent` CHECK(0–100) column.

## 21.7 Voice and vision

- Voice: TTS pipeline tests (`tests/voice-pipeline-completion.test.js`) and `edge-tts-adapter` (multilingual telemetry) pass in today's suite. Live microphone/wake-word round-trip requires audio hardware interaction on the host → classified `TESTED` (unit), not live-verified today.
- Vision: no fabricated claims; vision model list is configuration (`ULTRON_VISION_MODELS`) and real inference remains provider-gated (`BLOCKED` until keys).

## Phase 21 exit verdict

- Core AI live round-trip: `BLOCKED` (owner credentials) — everything around it verified.
- Memory persistence: `TESTED` locally; live-DB proof `BLOCKED` (owner authorization).
- Task lifecycle, real browser control, device integration: verified.
- Voice/vision: honest statuses; no invented functionality.
