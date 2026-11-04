# ULTRON Cross-Device Acceptance Report

- **Authoring HEAD:** `f70bd483` · **Date:** 2026-11-04

## Live physical acceptance (repeated this session)

Device: **OPPO CPH2127** (`adb-335fd9fb-9UaJ5Q._adb-tls-connect._tcp`, Wireless ADB TLS), evidence artifacts from `node scripts/real-device-workflow.mjs`:

1. **Real command execution:** launch `com.google.android.youtube` via approval token → foreground state verified `.app.honeycomb.Shell$HomeActivity`; screenshot `.local/artifacts/real_device_youtube_launch.png` (7,904 bytes).
2. **Cancellation:** mid-execution cancel → `{ cancelled: true, completedSteps: 1 }`.
3. **Emergency stop:** request while halted → `BLOCKED`; reset resumed operations.
4. **Cross-user isolation:** foreign user's approval token → `CROSS_USER_ACCESS_DENIED`.
5. **Anti-replay:** second use of a consumed approval token → `REPLAY_ATTACK_DETECTED`.
6. **Telemetry:** battery level/charging read via bounded `dumpsys battery` parse → consistent with Supabase `battery_percent CHECK (0–100)` (migration `20261104110000`, rollback companion added `8ecf5fda`).

## Device trust architecture

- Pairing: request → approve → claim lifecycle with device token + owner-scoped storage (`integrations/device-hub.js`, 6-digit PIN verification).
- Transport: signed commands with per-device tokens; `sb_secret_` used strictly as API key, never bearer (worker tests ✔).
- Route-level security: `DEVICE_ID_MISMATCH` (device can only update its own telemetry), `DEVICE_TOKEN_REQUIRED`, owner-scoped listings — `tests/jarvis-device-routes.test.js` full lifecycle ✔.
- Proactive channel: `/jarvis/notifications` (owner-authenticated) with **quiet-hours policy added this session** (`f70bd483`): normal dispatch inside the window → explicit HTTP 409 `QUIET_HOURS_ACTIVE` (never silently dropped); urgent bypass; malformed config fails open.

## Honest boundaries (not claimed)

- **Cross-device task handoff** (start a task on PC, resume on phone) is architecturally present (shared owner-scoped task state + command queue) but was **not exercised as a real two-device workflow** this session — classify L3, not L5.
- Background push delivery on Android under Doze/lock screen: unverified physical behavior (documented in feature registry).
- Windows companion device: code + tests exist; physical wake-word/pairing validation remains outstanding (`tests/native-companion-lifecycle.test.js` covers lifecycle logic only).
- One compromised device cannot mint access to the other device's data (owner-scoped isolation), but no adversarial red-team of the device hub was run beyond the documented gates.
