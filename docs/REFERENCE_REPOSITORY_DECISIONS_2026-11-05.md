# ULTRON — 51 Reference Repository Decision Matrix

**Date:** 2026-11-05  
**Purpose:** Decide what should be reused in the existing ULTRON system without importing 51 unrelated applications or overstating integration status.

> **Registry distinction:** ULTRON has a core `ToolRegistry` and a separate agent-runtime tool catalogue exposed at `/api/agent/tools`. Absence of a named tool from `core/tool-registry.js` does not prove the agent cannot call it: OpenViking, OpenSEO, Chatwoot, OpenProject and Cal.diy have agent-runtime tool schemas and dispatch paths in `agent-runtime.js`; AgentMemory is called internally for scoped recall/capture. AppFlowy and Immich agent tools are proposed in draft PR #448, not yet merged. Verify the actual schema, dispatch branch, owner gate and test before assigning a status. See [the independent evidence refresh](OVERNIGHT_AUDIT_2026-11-05.md).

> **Evidence boundary:** This is a source-tree and adapter-presence review, not a complete upstream source audit, license audit, or live acceptance test. “Adapter/code present” means a matching ULTRON source path exists; it does not prove that external credentials are configured or that a real provider/device action succeeded. Verify each upstream license and exact commit before copying third-party code.

## Decisions

| # | Reference repository | ULTRON decision | Evidence / integration boundary |
|---:|---|---|---|
| 1 | `0x4m4/hexstrike-ai` | Keep as guarded security adapter | `integrations/hexstrike-ai.js`; use only against explicitly authorized targets, with approval and sandbox boundaries. |
| 2 | `mohammedayanrafiq/JARVIS-ULTIMATE` | Reuse selected UX/voice ideas | No dedicated adapter identified. Do not replace the existing ULTRON/NAYA frontend or voice stack. |
| 3 | `AbuZar-Ansarii/Ultron` | Do not merge wholesale | PR #443 contains unique code with unsafe defaults (shared `default_user` memory, permissive Python/device actions, fake biometric success, and simulated IoT). Review individual ideas only. |
| 4 | `citrolabs/ego-lite` | Keep browser adapter | `integrations/browser/ego-lite/`; validate live CDP/browser actions separately. |
| 5 | `3dlg-hcvc/diorama` | Keep as optional spatial adapter | `spatial/diorama-adapter.js`; research/optional workload, not a default background process. |
| 6 | `mobile-next/mobile-mcp` | Keep; harden authorization | `mobile-mcp-client.js`, `mobile/`, and mobile tests. Draft security remediation is PR #447; do not treat it as merged until CI and review pass. |
| 7 | `garagehq/nightcrawler` | Defer | No dedicated adapter identified. Security reconnaissance must remain opt-in, target-scoped, and authorized. |
| 8 | `crackerghost/DSH-GOD` | Keep local-answer adapter | `integrations/dsh-god/local-answers.js`; verify answer quality and source provenance. |
| 9 | `tashfeenahmed/freellmapi` | Do not depend on it as a provider | No dedicated production adapter identified. Keep ULTRON's own provider abstraction; verify each free endpoint independently. |
| 10 | `mnfst/awesome-free-llm-apis` | Reference catalogue only | Useful for discovery; endpoint availability, limits, privacy, and terms change. Never treat a listing as a working key/provider. |
| 11 | `lyogavin/airllm` | Defer | No dedicated adapter identified. Large-model offload is a poor default for an 8 GB RAM integrated-GPU machine. |
| 12 | `Conway-Research/automaton` | Reject unrestricted autonomy | No integration. Do not add self-replication, unreviewed self-modification, or uncontrolled persistence. |
| 13 | `google-research/harness2` | Keep as test/evaluation tooling | `tools/harness2/`; CI/evaluation only, not a user-facing agent runtime. |
| 14 | `elder-plinius/G0DM0D3` | Research only / no production prompt bypass | No dedicated adapter identified. Do not weaken safety or tool permissions with jailbreak prompts. |
| 15 | `bilawalsidhu/gods-eye-view` | Reuse geospatial concepts selectively | ULTRON has world-intelligence/spatial code, but no verified one-to-one adapter attribution to this repo. |
| 16 | `public-apis/public-apis` | Reference catalogue only | Not a runtime dependency. Every API still needs security, license, uptime, and privacy review. |
| 17 | `SudoHopeX/KaliGPT` | Defer / authorized security use only | No dedicated adapter identified. Do not grant unrestricted offensive tooling. |
| 18 | `resemble-ai/chatterbox` | Keep optional voice adapter contract | `voice/neural-speech-adapters.js`; remote endpoint configuration and consent/labeling required. Not proof of a live Chatterbox model. |
| 19 | `penpot/penpot` | Keep separate | No dedicated adapter identified. Penpot is a separate design application; do not merge the whole product into ULTRON. |
| 20 | `immich-app/immich` | Keep read-only media connector; agent tools proposed in draft PR #448 | `integrations/immich.js`; PR #448 adds owner-scoped status, album listing, and metadata search with explicit current-message approval for private reads. Requires a real Immich URL/key and live permission test; PR is unmerged. |
| 21 | `elie222/rakazo` | Defer as separate agent workspace | No dedicated adapter identified. Do not merge a second autonomous-agent runtime into ULTRON core. |
| 22 | `Orange-3DV-Team/MoCha` | Defer | No dedicated adapter identified. Video/3D model workloads are optional and hardware intensive. |
| 23 | `codecrafters-io/build-your-own-x` | Engineering learning reference | Not a runtime dependency. Use tutorials selectively for tests and internal implementation work. |
| 24 | `SailikNanda/ERA-System-Prompts` | Curate ideas, do not import wholesale | No dedicated adapter identified. Review each role prompt for permission boundaries and reliability before use. |
| 25 | `p-e-w/heretic` | Do not use on production models | No integration. Model-weight modification must never happen automatically in the live ULTRON provider path. |
| 26 | `NousResearch/hermes-agent` | Keep guarded agent adapter | `integrations/hermes-agent.js`; external Hermes runtime, credentials, tool allowlists, and sandbox still require live validation. |
| 27 | `morluto/rea` | Keep reverse-engineering adapter/gateway | `integrations/rea-mcp.js` and `rea-gateway/`; the gateway being deployed does not prove a real authorized target has been analyzed. |
| 28 | `darkzOGx/youtube-automation-agent` | Defer | No dedicated adapter identified. Publishing/uploading must be explicit user-approved and platform-policy compliant. |
| 29 | `CapSoftware/Cap` | Keep separate | No dedicated adapter identified. Screen recording is an optional desktop app, not a core AI dependency. |
| 30 | `chatwoot/chatwoot` | Keep integrated read-only agent tool | `agent-runtime.js` exposes `chatwoot_list_conversations` and dispatches to `listChatwootConversations`; access is bound to `ULTRON_INTEGRATION_OWNER_USER_ID`. The adapter returns bounded summaries only; it does not send replies or mutate conversations. Requires owner credentials and live smoke testing. |
| 31 | `calcom/cal.diy` | Keep integrated read-only agent tools | `agent-runtime.js` exposes `caldiy_list_event_types` and `caldiy_check_availability`, dispatching to `integrations/productivity-services.js`; `/api/agent/tools` reports owner-scoped configuration readiness. No booking/cancellation path is included. Live provider access remains unverified and requires `CALDIY_BASE_URL`, `CALDIY_API_TOKEN`, owner guard, and an actual availability smoke test. |
| 32 | `opf/openproject` | Keep integrated read-only agent tools | `agent-runtime.js` exposes `openproject_list_projects` and `openproject_list_work_packages`; both dispatch to `integrations/productivity-services.js` with the authenticated owner ID. No create/edit actions are provided. Requires owner credentials and live smoke testing. |
| 33 | `OpenWhispr/openwhispr` | Defer | No dedicated adapter path identified. Keep existing browser/OS voice input until a real local bridge is tested. |
| 34 | `AppFlowy-IO/AppFlowy` | Keep adapter; agent wiring proposed in draft PR #448 | `integrations/appflowy.js` and integration tests exist. Draft PR #448 adds owner-scoped tools and fail-closed private-read approval, stacked on mobile authorization PR #447. Both remain unmerged; an actual AppFlowy instance/token and live isolation test are still required. |
| 35 | `every-app/open-seo` | Keep integrated owner-scoped agent tool | `agent-runtime.js` exposes the `openseo` MCP tool and dispatches through `integrations/openseo-mcp.js`; free reads are bounded and paid research is gated by a same-current-message credit approval. Requires `OPENSEO_BASE_URL`, `OPENSEO_API_TOKEN`, owner scope, and a live MCP smoke test. |
| 36 | `wide-trace/open-higgsfield` | Defer | No dedicated adapter identified. Keep media generation as an optional external capability. |
| 37 | `Oldcircle/geo-sleuth` | Keep restricted geospatial adapter | `integrations/geo-sleuth.js`; use only lawfully available imagery and authorized investigations. |
| 38 | `suifeng9203/HeyGem.ai` | Defer | No dedicated adapter path identified. Digital-human/video generation is heavyweight and voice cloning requires explicit consent. |
| 39 | `Comfy-Org/ComfyUI` | Defer as optional separate service | No dedicated ComfyUI adapter path identified in the inspected main tree. Do not install large models on the constrained local machine by default. |
| 40 | `k2-fsa/OmniVoice` | Keep optional voice adapter contract | `voice/neural-speech-adapters.js`; requires a configured remote endpoint/key or a separately managed model runtime. Live synthesis is unverified. |
| 41 | `cjpais/Handy` | Defer | No dedicated Handy adapter path identified. Evaluate as an optional desktop transcription sidecar, not a core server dependency. |
| 42 | `volcengine/OpenViking` | Keep integrated owner-scoped agent tools | `agent-runtime.js` exposes `check_openviking`, `openviking_find_context`, and `openviking_read_context`, backed by `integrations/openviking.js`; tool IDs are in the owner-scoped allowlist. Search/read only; no writes. Requires `OPENVIKING_BASE_URL`, `OPENVIKING_API_TOKEN`, owner scope, and real retrieval smoke tests. |
| 43 | `cathrynlavery/diagram-design` | Keep diagram tool | `tools/diagram-design.js`; generated diagrams should be reviewed and treated as output artifacts, not executable instructions. |
| 44 | `K-Dense-AI/scientific-agent-skills` | Curate skills selectively | No dedicated adapter path identified. Import only reviewed, bounded research skills with source citations and tool limits. |
| 45 | `rohitg00/agentmemory` | Keep internal task-aware memory adapter | `agent-runtime.js` uses `recallAgentMemory`, `captureAgentMemory`, and `shouldCaptureAgentMemory` for task-relevant recall and bounded capture; readiness is exposed in `/api/agent/tools`. This is not a standalone user-invoked tool. Requires a configured external AgentMemory service; verify per-user namespaces, deletion, persistence, and cross-account isolation before broad enablement. |
| 46 | `browser-use/browser-use` | Keep separate browser bridge | `browser-use-bridge/`; Render deployment is live, but authenticated real-site workflows and permission behavior still need acceptance tests. |
| 47 | `nexu-io/open-design` | Keep separate | No dedicated adapter identified. Do not couple the ULTRON core to a paid/cloud design workspace. |
| 48 | `1jehuang/jcode` | Defer | No dedicated adapter identified. Existing coding-agent workflows should be resource-capped; do not launch dozens of agents on the 8 GB local machine. |
| 49 | `msitarzewski/agency-agents` | Keep curated role matrix | `agents/agency-agents-matrix.js`; role definitions are guidance, not independently trusted permissions. |
| 50 | `dramaclaw/dramaclaw` | Do not copy code without legal review | No dedicated adapter identified. Its repository describes Elastic License 2.0; verify current license text before reuse. |
| 51 | `TechyCSR/OpenCluely` | Reject stealth/deception features | No dedicated adapter identified. Reuse only transparent, user-visible HUD concepts; do not implement hidden overlays intended to deceive monitoring or interview systems. |

## Integration policy

1. ULTRON remains the single orchestrator. External repositories are adapters, skills, or separate services—not 51 independent agents competing for control.
2. A source file or registry row is not a working integration. Required evidence is: exact upstream provenance/license, real configuration, adapter test, live smoke test, user/tenant isolation, and permission/audit coverage.
3. Keep optional services disabled until configured. Do not auto-download large models or start GPU-heavy services.
4. External actions (messages, calls, purchases, uploads, destructive device operations, security scans) remain permission-gated and owner-scoped.
5. Prefer existing code in ULTRON over copying upstream code. For third-party code, verify exact license and pin an actual upstream commit before importing.
6. The immediate priorities are mobile authorization hardening (PR #447), provider connectivity, browser real-world acceptance, worker lifecycle, voice/vision device tests, and accurate capability status—not maximizing repository count.
