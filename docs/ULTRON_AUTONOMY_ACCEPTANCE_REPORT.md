# ULTRON Autonomy Acceptance Report

- **Authoring HEAD:** `f70bd483` · **Date:** 2026-11-04

## Acceptance evidence (paired with test names from the current suite, all green)

| Autonomy requirement | Mechanism | Test evidence |
|---|---|---|
| Task lifecycle (create→plan→permission→execute→verify→persist) | 11-stage orchestrated lifecycle + durable worker | `autonomous-task-lifecycle.test.js`, worker stage tests |
| Cancellation | mid-execution cancel; retry-discarded-on-cancel | suite ✔; real device: `{ cancelled: true, completedSteps: 1 }` (2026-11-04, OPPO CPH2127) |
| Timeouts | 408 provider fallback ✔; device timeouts | `worker falls back after a transient HTTP 408 provider timeout` |
| Duplicates | lease heartbeats skip overlapping ticks; 30s idempotency fences | `task lease heartbeat skips overlapping ticks` ✔ |
| Concurrency bounds | bounded active tasks; alternating poll starvation prevention | worker tests ✔ |
| Restart recovery | stale running-task recovery scoped to owner; durable state in Supabase | `recover_stale_running_tasks.sql` + scope test |
| Invalid tool arguments | registry payload validation; browser URL/fragment rejection | ✔ |
| Failure classification & retry limits | 6-class DLQ (`TIMEOUT`, `RATE_LIMIT`, `TRANSIENT_NETWORK`, `PERMISSION_DENIED`, `VALIDATION_ERROR`, `FATAL_CRASH`) with idempotency keys + recovery | `tests/agents-orchestrator.test.js` DLQ/recovery ✔ |
| Emergency stop | cancels queued/running tasks, non-bypassable, owner master-key reset | device live run ✔; orchestrator tests ✔ |
| Agent permission levels | autonomy-policy levels 0–5; per-agent `allowedTools` least privilege | `autonomy-levels.test.js` ✔ |
| Delegation | scoped subtask creation + explicit executor + audit entries | orchestrator tests ✔ |

## Truth-tier correction this session (commit `6ab5746e`)

`AgentOrchestrator.executeAgentAction` previously returned **fabricated outcomes** for all 18 agent lanes (e.g. `navigated: true, elementsCount: 15`, `safe: true, auditApproved: true`, invented `ramUsagePercent: 45.2`, fabricated scheduled `jobId`, `paired: true, notificationSent: true`).

Fixed result: every executor-less call now returns `{ simulated: true, executionMechanism: "ORCHESTRATOR_TEST_DOUBLE", evidence: null, note: … }`; the default case reports `status: "not_executed"`. Regression assertions added to `tests/agent-matrix-18.test.js` (all 18 lanes must be labeled; must not claim completed status) and `tests/agents-orchestrator.test.js` (no fabricated booleans). 14/14 orchestrator tests pass; full suite re-run on `6ab5746e`: 1,537 tests, 1,531 pass, 0 fail, 6 skipped.

The durable worker lane and `resumeTask(executor)` lane remain the real-execution paths — unchanged and verified.

## Honest classification

- Autonomy engine: **TESTED — production-grade in its durable-worker lane.**
- Agent-lane dispatch: **labeled test double; convert lanes by wiring executors** (work available, not yet performed — do not claim it exists).
- Physical autonomy (Windows/Android device actuation): verified only for the documented device MCP commands (see cross-device acceptance).
