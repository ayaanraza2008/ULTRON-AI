# ULTRON — INTEGRATION ACCEPTANCE MATRIX (L0–L5 evidence levels)

Evidence levels: L0 not implemented · L1 implemented in code · L2 configuration present ·
L3 connection verified · L4 real operation verified · L5 failure recovery + security verified.

| Component | Level | Local test coverage | Physical verification | Notes |
|---|:--:|---|---|---|
| GitHub (git/CI/PR) | L4 | n/a | n/a | Push/fetch/PR/CI interacted with live |
| OpenCode dev environment | L4 | n/a | n/a | Primary environment, verified |
| Tool registry (40 tools) | L4 | adversarial + per-tool suites | n/a | tools.size verified 40 |
| EGO-Lite HTTP preview driver | L4 | real-world suite (real network fetch) | n/a | Honest `HTTP_FETCH_PREVIEW` labeling |
| EGO-Lite direct CDP control | L1–L0 | type-level placement only | no | Interaction reports simulated honestly |
| Browser-use bridge | L2 | suite presence | no | Requires runtime browser install |
| Windows companion (build/pair) | L2 | C# code + Program tests | no | Executable not installed/verified on host |
| Mobile MCP (software stack) | L4 | 33/33 category tests | **no device** | adb absent; physical gate impossible |
| Voice TTS (edge-tts adapter) | L2–L3 | adapter + unit tests | not verified | Physical mic verification NOT performed |
| Wake-word; audio devices | L1 | code-level only | no | Local capability; no physical acceptance |
| Camera / vision | L1 | smoke scripts exist | no | No camera attached/verified |
| ComfyUI / OmniVoice | L1 | adapter code only | no | External runtime not connected |
| Supabase (auth + DB) | L2 | isolation/migration test files | no dashboard access | Owner-gated; rollback reviewed |
| PostgreSQL-backed workers | L1 | 4 suites skipped (no real PG) | CI executes them | Documented skips |
| Render deployment | L2 | render.yaml reviewed | no dashboard access | Owner-only DEPLOY path |
| OpenRouter / Groq / Cerebras providers | L2 | fallback chain unit-tested | not connected | Keys NOT_CONFIGURED |
| Gemini provider | L2 | fallback tested | **AUTH_FAILED** HTTP 401 | Needs valid key rotation |
| Hermes Agent / ECC / OpenViking / AgentMemory | L1–L2 | adapters present | not connected | Past 56-repo integration work |
| Chatwoot / Cal.com / OpenProject / AppFlowy | L1 | adapter code only | not connected | Free-first, per-core integrations |
| Handy / Geo-Sleuth / YT Automation Agent | L1 | scripts/adapters only | not connected | — |
| Obscura / Cactus Compute | L1 | referenced in matrices | not connected | — |
| YouTube / research extraction | L3 | real-world suite fetches example.com | example.com reachable | Bounded, SSRF-guarded |

Rules honored:
- No fabricated connectivity: absent dashboard access, keys, or hardware yields L1/L2 maximums.
- Levels recorded in `docs/ULTRON_OPENCODE_CONNECTION_MATRIX.md` (audit branch) remain consistent; this file supersedes it with session-dated evidence.
