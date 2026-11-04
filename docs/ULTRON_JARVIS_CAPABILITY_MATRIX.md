# ULTRON JARVIS Capability Matrix

- **Authoring HEAD:** `f70bd483` (branch `feat/ultron-remaining-gaps-completion` = PR #441 head series)
- **Date:** 2026-11-04
- **Method:** fresh inspection of actual modules and today's live runs; classifications are evidence-backed, not aspirational.

Status vocabulary: `IMPLEMENTED` (code exists + unit tests), `TESTED` (suite evidence), `VERIFIED` (real-world execution evidence this session), `BLOCKED` (external dependency), `NOT_INTEGRATED` (no real transport).

| Capability | Status | Subsystems | Evidence |
|---|---|---|---|
| Intent recognition (Hinglish + English) | TESTED | `agent-runtime.js` regex normalization (incl. "background mein chala karo" → enqueue_employee_task) | suite green |
| Model routing + provider abstraction | TESTED, BLOCKED for live use | `core/brain-router.js`, `core/zero-cost-ai.js`, `scripts/model-provider-smoke.mjs` | fail-closed `NO_ELIGIBLE_PROVIDER`; Gemini credential root-caused |
| Multi-step planning / decomposition | TESTED | `core/autonomous-orchestrator.js`, `agents/orchestrator.js` (DAG, DLQ, retries) | `agents-orchestrator.test.js` 14/14 today |
| Tool ecosystem | TESTED | `core/tool-registry.js` — 44 tools with adversarial inventory | `adversarial-autonomy-hardening.test.js` |
| Browser control | VERIFIED | REAL_CDP driver + opt-in env | 4/4 live CDP tests today (launch, live DOM, real fill round-trip) |
| Windows control | TESTED | `system/windows-automation.js`, `computer-control.js` truth-tier + destructive gate | suite; truth-tier `UNSUPPORTED_HARDWARE` on non-Windows |
| Memory | TESTED, BLOCKED live-DB | `tests/cognitive-memory*.test.js`, `memory-api-user-scope.test.js`, Supabase storage | suite green; live-DB persistence gate |
| Voice (TTS pipeline) | TESTED | `voice/edge-tts-adapter.js`, kokoro engine | `voice-pipeline-completion.test.js` |
| Wake word | TESTED | `voice/wake-word.js` (cooldown, reconnect state machine), Android companion | suite; physical-device mic round-trip NOT verified |
| Vision (camera) | TESTED (code), BLOCKED hardware | `vision/vision-engine.js`, `ultron-eyes-manager.js` | unit-level; no camera E2E this session |
| Hand gestures | TESTED (code) | `vision/gesture-recognizer.js` — UI-scoped (pinch/open-palm/holographic scale), **no destructive gesture pathway** | `gesture-recognizer.test.js` |
| Autonomous task engine | TESTED | durable worker: leases, retries, backoff, DLQ, graceful shutdown | full worker test set green today |
| Multi-agent orchestration | TESTED (truth-tier corrected today) | `agents/orchestrator.js` `executeAgentAction` now labeled `ORCHESTRATOR_TEST_DOUBLE`, fabricated outcomes removed | commit `6ab5746e`, 14/14 tests |
| Proactive intelligence | **IMPLEMENTED today** + TESTED | `/jarvis/notifications` transport; **quiet-hours policy** `system/notification-policy.js` | 3/3 tests incl. live route gate (`f70bd483`) |
| Research / world intelligence | TESTED | autonomous research workflow, content provenance (`intelligence/content-provenance.js`) | suite; live research provider-gated |
| Mobile integration | VERIFIED | Mobile MCP + durable paired devices + telemetry migration | OPPO CPH2127 live today: launch+foreground verify, cancel, emergency stop, cross-user denial, anti-replay |
| Security | TESTED | secret scanning, SSRF guard, destructive-command gate, autonomy levels 0–5 | suite + adversarial inventory |
| Self-diagnostics UI states | TESTED | health/readiness endpoints; UI backend-driven | deployment health probe HTTP 200 |
| Cross-device continuity (PC↔phone shared task state) | PARTIAL | device hub command queue, telemetry sync | command lifecycle tested e2e (pair→command→complete); real cross-device task handoff not verified |
| Telephony / robotics / spatial | NOT_INTEGRATED | code present (`telephony/`, `robotics/`, `spatial/`) | no hardware; do not claim |
