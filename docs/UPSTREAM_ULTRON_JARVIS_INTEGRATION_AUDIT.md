# External ULTRON / JARVIS Repository Integration Audit

Date: 2026-11-07

## Scope and source revisions

This is a source-level compatibility and safety audit of two public repositories against the existing `ayaanraza2008/ULTRON-AI` codebase. It records selected, independently implemented capability adaptations and reuse decisions; it is not a claim that either upstream repository was wholesale merged or that the integration has passed runtime tests.

| Repository | Audited revision | Main stack | License finding |
|---|---|---|---|
| [AbuZar-Ansarii/Ultron](https://github.com/AbuZar-Ansarii/Ultron) | `1f16aa19e15e160fd434132c965aded489029a9d` | Python, PyQt6, OpenCV, SQLite, desktop actions | No root LICENSE file was present at the audited revision. Treat code as all-rights-reserved unless the owner confirms otherwise. Do not copy source files/assets. |
| [mohammedayanrafiq/JARVIS-ULTIMATE](https://github.com/mohammedayanrafiq/JARVIS-ULTIMATE) | `a1aea5cbc3b92831b51de2b01e07d7e1b26cd6aa` | Tauri v2, Rust, webview, Windows desktop | MIT. Preserve copyright and license notice for any copied substantial code. |
| [ayaanraza2008/ULTRON-AI](https://github.com/ayaanraza2008/ULTRON-AI) | base `a3041d35bf11eda88a19dbeb25a57c70536e0fad` | Node.js ESM, Express, web HUD, .NET Windows companion, Android companion | Existing project; preserve current interfaces and deployed behavior. |

## Capability mapping and integration decisions

| Upstream capability | Existing ULTRON overlap | Decision |
|---|---|---|
| Cerebro semantic graph / multi-hop recall | `cognitive-memory.js`, agentmemory integration, existing persistence and Supabase boundaries | Adapt graph semantics and relationship traversal behind the current memory interface. The live agent retrieval now fetches row IDs and user IDs under the existing Supabase user filter, then performs bounded two-hop recall from up to four direct query matches, then follows linked context only within that owner scope. Do not introduce a second independent user-memory database or bypass owner/account isolation. |
| OpenCV hand gesture control | `vision/`, Android companion and Windows companion/device command protocol | Reimplement as an opt-in, local companion capability. Require explicit camera permission, visible active state, cooldown, calibration, and a kill switch. Never map a gesture directly to destructive or security-sensitive actions. |
| Prometheus self-evolving tool generation | `self-improvement/`, `autonomy-policy.js`, task/agent runtime | Reuse the concept only. Generated code must be quarantined, statically checked, reviewed, tested in a sandbox, and explicitly approved before activation. No unrestricted hot-loading or self-granted permissions. |
| Chronos proactive context engine | Existing task scheduler, workers, autonomy runtime | ULTRON already has a lightweight `system/proactive-daemon.js` for battery/RAM alerts and a durable scheduled-task worker. Extend those existing services only where useful; do not add a second polling daemon or unsolicited conversational speech loop. |
| Offline voice / wake word | Existing ULTRON voice stack and Windows wake companion | Keep the exact wake phrase **Ultron**. Reuse only detector design patterns after latency, false-positive, privacy, and CPU tests. No silent mic capture or automatic model downloads. |
| Tauri floating orb, system tray, global hotkey | Existing black energy-core web HUD and .NET Windows companion | The existing `system/desktop-companion-manager.js` already provides orb position persistence, display-boundary clamping, HUD anchoring, tray actions, hotkey metadata, emergency stop, and native companion lifecycle. Reuse this implementation; do not add a second Tauri shell or duplicate orb. |
| JARVIS persistent task memory | Existing history, cognitive memory, task state | Already covered by ULTRON’s durable `agent_tasks` queue, worker leases, task status transitions, and existing conversation/memory persistence. Do not add JARVIS’s separate local JSON task store as a competing source of truth. |
| Windows system actions | Existing paired-device queue and signed allowlisted command executor | Reuse the existing authenticated command queue. Do not import arbitrary shell execution. |

## Security findings that block blind copying

1. The JARVIS `voice.rs` implementation shown at the audited revision triggers on an RMS audio-volume threshold (`rms > 0.08`); that is not wake-word recognition and can trigger on unrelated loud sounds. It must not replace ULTRON's wake-word detector.
2. JARVIS `commands.rs` accepts a caller-provided command string and invokes `cmd /C`; its destructive-command substring checks are not a sufficient security boundary. Do not import this command path. Keep ULTRON's signed, allowlisted device commands.
3. AbuZar's gesture implementation uses skin-colour segmentation and heuristic frame geometry. Lighting, skin-tone, background, and camera differences can cause false detections. Rebuild with robust landmark-based detection or prove acceptable precision on target hardware before enabling actions.
4. AbuZar's self-evolution module uses pattern checks and AST/compile validation. These checks do not sandbox generated code and do not prevent data exfiltration, privilege abuse, or unsafe imports. Do not enable direct self-authored code execution.
5. AbuZar's root repository had no LICENSE file at the audited revision. Its code, UI, avatar assets, and models must not be copied into ULTRON without explicit permission or a clear license from the owner.

## Implementation sequence

1. **Compatibility baseline:** retain current ULTRON backend, web HUD, NAYA, auth, memory, device pairing, and deployment configuration.
2. **Memory:** add graph relationships and multi-hop retrieval through the existing cognitive-memory contract; tenant/owner scope every query.
3. **Gesture companion:** add an opt-in local gesture service with explicit camera consent, visible camera status, calibration, debounce/cooldown, and safe action allowlist.
4. **Wake + voice:** keep “Ultron”; use the existing voice selection and response pipeline. Validate actual keyword detection rather than audio-level triggers.
5. **Desktop shell:** evaluate floating orb/tray/hotkey as an optional Windows companion feature using the existing pairing and command protocol.
6. **Self-improvement:** make proposed skills reviewable artifacts; sandbox tests and explicit owner approval before activation.
7. **Verification:** run syntax, unit, integration, security, Windows build, Android build, and live-device acceptance. Record failures honestly; do not mark untested capabilities complete.

## Verification status

- [x] Both source repositories and their default branches located.
- [x] Source tree and README files inspected.
- [x] Selected source modules inspected.
- [x] Existing ULTRON package stack and Windows companion boundaries inspected.
- [x] Cerebro-inspired bounded multi-hop recall is wired into the live agent memory retrieval path; existing Supabase user scoping remains mandatory.
- [x] JARVIS-style desktop orb/tray/position and durable task capabilities were confirmed to exist already in ULTRON; no duplicate runtime was added.
- [ ] No AbuZar source code/assets copied (no published license at audited revision).
- [ ] GitHub Actions test/build jobs for this integration have not completed yet; no runtime or physical-device acceptance is claimed.
- [ ] No deployment performed.

## Attribution

JARVIS-ULTIMATE is MIT-licensed, but no JARVIS source code or assets were copied; ULTRON's equivalent desktop-companion features pre-existed this integration. The MIT license text is retained in `THIRD_PARTY_NOTICES.md` for audit transparency. The AbuZar repository requires written permission or a published license before copying its source or assets.
