# ULTRON AI — DSH-GOD Feature Capability Matrix

## 1. Core Feature Inventory

| Capability ID | Feature Name | Upstream Module | ULTRON Native Module | Status | Verification |
|---|---|---|---|---|---|
| **FEAT-01** | 76-Provider Model Registry | `src/providers/registry.json` | `integrations/dsh-god/provider-registry.js` | Complete & Active | Verified via `dsh-provider-registry.test.js` |
| **FEAT-02** | OpenCode Zen v2 Free Wire | `src/upstream.js` | `integrations/dsh-god/open-code-gateway.js` | Complete & Active | Verified via `dsh-free-gateways.test.js` |
| **FEAT-03** | Kilo AI Free Pool Gateway | `src/kilo.js` | `integrations/dsh-god/kilo-gateway.js` | Complete & Active | Verified via `dsh-free-gateways.test.js` |
| **FEAT-04** | Aggregate Multi-Wire Dispatcher | `src/aggregate.js` | `integrations/dsh-god/aggregate-providers.js` | Complete & Active | Verified via `dsh-aggregate-providers.test.js` |
| **FEAT-05** | Virtual Combo Routing Chains | `src/combos.js` | `integrations/dsh-god/combo-router.js` | Complete & Active | Verified via `dsh-combo-router.test.js` |
| **FEAT-06** | RTK Token Optimizer Filters | `src/token-saver.js` | `integrations/dsh-god/token-optimizer.js` | Complete & Active | Verified via `dsh-token-optimizer.test.js` |
| **FEAT-07** | Prompt Shaping (Caveman & Ponytail) | `src/token-saver.js` | `integrations/dsh-god/token-optimizer.js` | Complete & Active | Verified via `dsh-token-optimizer.test.js` |
| **FEAT-08** | Universal Local HTTP Gateway | `src/forward.js` | `integrations/dsh-god/gateway-manager.js` | Complete & Active | Verified via `dsh-gateway-compatibility.test.js` |
| **FEAT-09** | 10 Account Channels Framework | `vendor/channel-pack` | `integrations/dsh-god/account-channels.js` | Complete & Active | Verified via `dsh-account-channels.test.js` |
| **FEAT-10** | Usage Monitor & Diagnostics | `src/probe.js`, `src/failure.js` | `integrations/dsh-god/usage-monitor.js` | Complete & Active | Verified via `dsh-usage-diagnostics.test.js` |
| **FEAT-11** | Fast Local Heuristic Answers | `src/local-optimize.js` | `integrations/dsh-god/local-answers.js` | Complete & Active | Verified via `dsh-brain-integration.test.js` |
| **FEAT-12** | ULTRON Brain Dynamic Fallback | `core/brain-router.js` | `core/brain-router.js` | Complete & Active | Verified via `dsh-brain-integration.test.js` |
| **FEAT-13** | Cyber-HUD UI Panel | `public/index.html` | `public/index.html`, `public/app.js` | Complete & Active | Verified via UI inspection & events |
| **FEAT-14** | Management REST API | Custom | `integrations/dsh-god/management-api.js` | Complete & Active | Verified via `dsh-facade-routes.test.js` |

---

## 2. Capability Details

### A. OpenCode Zen v2 Fingerprint
- Inverted descending hex timestamps with 48-bit layout `~(ts_ms << 12 | counter)`.
- Verified UA `opencode/latest/2.0.26/cli`.
- Injected official `read` and `shell` tool schema bypasses.
- Refusal of `tool_choice: "none"`.

### B. Virtual Combos
- Virtual prefix `combo:`.
- 5 Routing strategies: `fallback`, `round-robin`, `smart`, `usage`, `pace`.
- Enforces capability intersection: lowest context window, false vision if any candidate lacks it.

### C. RTK Token Optimizer
- Tool output compaction: `gitDiff` hunks capped, `gitStatus` count summaries, `gitLog` bodies omitted, `grep` matches capped per file, noise directories omitted, smart head/tail truncation.
- Cumulative savings ledger and metrics reporting.
