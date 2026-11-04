# ULTRON Intelligence Architecture

- **Authoring HEAD:** `f70bd483` · **Date:** 2026-11-04

## Layer map (actual modules, verified to exist)

```
Signal producers
  voice (wake-word → STT), chat (public UI/agent-runtime), mobile MCP (paired device),
  browser (CDP), scheduled AI Employees (autonomous-orchestrator/worker)
        │
Intent & routing layer
  agent-runtime.js — language normalization (English/Hinglish), intent classification,
  capability routing, tool gating (agent-runtime-tool-intent-guard tests)
  core/brain-router.js — provider chain: primaries → gemini-flash → local CPU tier;
  circuit breakers per provider
        │
Reasoning & execution
  core/ultron-core.js (session core) → core/tool-registry.js (44 tools, permissioned)
  worker.js — durable tasks: leases, heartbeats, attempt fences, retries, DLQ
        │
Agents
  agents/catalog.js — 18 specialized agents, least-privilege allowedTools per role
  agents/orchestrator.js — DAG w/ Kahn sorting, cycle detection, checkpoints,
  inter-agent delegation, explicit-executor execution, DLQ classification (6 root causes),
  emergency stop (non-bypassable), autonomy levels 0–5 via autonomy-policy.js
        │
Truth tier (enforcement)
  REAL_CDP / HTTP_FETCH_PREVIEW / simulated:true (browser driver)
  ORCHESTRATOR_TEST_DOUBLE { simulated, executionMechanism, evidence: null }
    (agents/orchestrator.js, commit 6ab5746e — fabricated outcome claims removed)
  UNSUPPORTED_HARDWARE truth-tier brightness; NO_ELIGIBLE_PROVIDER fail-closed
```

## Key properties

1. **One context layer.** Voice, chat, mobile, and scheduled tasks all terminate in the same tool registry and permission gates; no side channel bypasses `agent-runtime` guards or autonomy levels.
2. **Honest provider degradation.** When no provider credential is valid, the system returns a classified, actionable error (`NO_ELIGIBLE_PROVIDER` / `CREDENTIAL_MISMATCH_*`) and never a fabricated answer. Verified live this session.
3. **Simulation is labeled, never claimed.** The 18-agent action sweep cannot assert outcomes it did not observe; bound results carry `simulated: true` + `evidence: null`.
4. **Fail-stop autonomy.** Emergency stop cancels queued/running tasks across agents; DLQ preserves root-cause classes with idempotency keys for safe recovery.

## Deliberate design boundaries

- Local CPU fallback exists but no heavy models are auto-downloaded (8 GB RAM host).
- `executeAgentAction` remains wiring-ready: adding an executor to a lane converts that lane from test-double to real results with the same call signature.
