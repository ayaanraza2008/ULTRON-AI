# ULTRON — 51 Reference Repository Decision Matrix

**Date:** 2026-11-05  
**Purpose:** Decide what should be reused in the existing ULTRON system without importing 51 unrelated applications or overstating integration status.

> **Registry distinction:** ULTRON has a core `ToolRegistry` and a separate agent-runtime tool catalogue exposed at `/api/agent/tools`. Absence of a named tool from `core/tool-registry.js` does not prove the agent cannot call it: OpenViking, OpenSEO, Chatwoot, OpenProject and Cal.diy have agent-runtime tool schemas and dispatch paths in `agent-runtime.js`; AgentMemory is called internally for scoped recall/capture. AppFlowy and Immich agent tools are proposed in draft PR #448, not yet merged. Verify the actual schema, dispatch branch, owner gate and test before assigning a status. See [the independent evidence refresh](OVERNIGHT_AUDIT_2026-11-05.md).

> **Evidence boundary:** This is a source-tree and adapter-presence review, not a complete upstream source audit, license audit, or live acceptance test. “Adapter/code present” means a matching ULTRON source path exists; it does not prove that external credentials are configured or that a real provider/device action succeeded. Verify each upstream license and exact commit before copying third-party code.

## Upstream provenance snapshot — 2026-11-05

The following 51 entries are the exact reference repositories in this decision matrix. For each one, GitHub repository metadata and the latest commit on its declared default branch were queried on 2026-11-05. All 51 repository endpoints resolved and returned a default-branch commit. This verifies repository existence, default branch and a commit pointer only; it does **not** constitute source-code review, dependency security review, license/legal approval, model-weight license review, or proof that ULTRON has a working integration.

`GitHub license` is the SPDX value detected by GitHub. `NOASSERTION` means GitHub did not provide a detected SPDX license; treat that entry as **license unresolved / no code reuse approved** until the actual LICENSE file and terms are reviewed. The upstream SHA is the full SHA returned by `GET /repos/{owner}/{repo}/commits/{default_branch}`. “Last push” is repository metadata and may refer to another branch; use the recorded default-branch SHA for source pinning. None of these repositories was reported archived by GitHub at query time.

| # | Upstream repository | Default branch | Default-branch HEAD SHA | GitHub license | Last push (UTC) |
|---:|---|---|---|---|---|
| 1 | `0x4m4/hexstrike-ai` | `master` | `d689933ff579d839c676c82b231f8e98326c5f04` | MIT | 2026-08-03 |
| 2 | `mohammedayanrafiq/JARVIS-ULTIMATE` | `main` | `a1aea5cbc3b92831b51de2b01e07d7e1b26cd6aa` | MIT | 2026-08-16 |
| 3 | `AbuZar-Ansarii/Ultron` | `main` | `1f16aa19e15e160fd434132c965aded489029a9d` | NOASSERTION | 2026-10-24 |
| 4 | `citrolabs/ego-lite` | `main` | `bacaece43900e8ca68eea3b6f1663835ea38df9e` | MIT | 2026-11-05 |
| 5 | `3dlg-hcvc/diorama` | `main` | `ec54d826cf6b39c6daf88947da897ff9626e5d61` | MIT | 2026-01-22 |
| 6 | `mobile-next/mobile-mcp` | `main` | `57efc27d96971f96caba69b62665fa057ebc65ac` | Apache-2.0 | 2026-11-02 |
| 7 | `garagehq/nightcrawler` | `main` | `4d1ed0fdf3a4ddf4d6afcacf4487894c51b55f1b` | NOASSERTION | 2026-08-19 |
| 8 | `crackerghost/DSH-GOD` | `main` | `c67271f42141dc1afc5d371e313ead7b8e35bfdd` | MIT | 2026-10-30 |
| 9 | `tashfeenahmed/freellmapi` | `main` | `fb07845faf7cf986ea9f3692e055076035dd8739` | MIT | 2026-11-04 |
| 10 | `mnfst/awesome-free-llm-apis` | `main` | `095e35e10f33d7ba32ebb86e1dd0ff604dea9c1a` | CC0-1.0 | 2026-11-04 |
| 11 | `lyogavin/airllm` | `main` | `66eeaf17d1c06fb3c16eaad2d12ea311905a5568` | Apache-2.0 | 2026-11-05 |
| 12 | `Conway-Research/automaton` | `main` | `d8f816881fd24b6f5e3d616e59edec387a447667` | MIT | 2026-08-26 |
| 13 | `google-research/harness2` | `main` | `6868817518876de8fd170c6a8354daca273b6191` | Apache-2.0 | 2026-11-02 |
| 14 | `elder-plinius/G0DM0D3` | `main` | `f6301765fb90eb7b336bdf365319cd2fe44b1187` | AGPL-3.0 | 2026-07-15 |
| 15 | `bilawalsidhu/gods-eye-view` | `main` | `7d8b80db0acd9daa4af0364f9ef3aa8ac46b0b69` | NOASSERTION | 2026-11-05 |
| 16 | `public-apis/public-apis` | `master` | `1e354d1bd0facb63f48c1d68841a6b61dc620bd1` | MIT | 2026-11-04 |
| 17 | `SudoHopeX/KaliGPT` | `hackerx` | `ee0a21d392d0e19e1c4f390dbaeb225f8e329caf` | NOASSERTION | 2026-11-04 |
| 18 | `resemble-ai/chatterbox` | `master` | `ab55923c27757c90cfcc407baa57dc25a7d25217` | MIT | 2026-11-04 |
| 19 | `penpot/penpot` | `develop` | `9d898b8b31f8313b93d1f1f34b601f4d4e65ebf7` | MPL-2.0 | 2026-11-05 |
| 20 | `immich-app/immich` | `main` | `0fe21a3e0c980be1549ec22304bac09c034fda93` | AGPL-3.0 | 2026-11-05 |
| 21 | `elie222/rakazo` | `main` | `e66c54edab941c89d80d995b052ede0849fcd7a6` | Apache-2.0 | 2026-11-05 |
| 22 | `Orange-3DV-Team/MoCha` | `main` | `aa503085c3b985e1c44ae4f7786c2a9402df53c1` | NOASSERTION | 2026-04-30 |
| 23 | `codecrafters-io/build-your-own-x` | `master` | `aa17439b62f384511a5561ce308e9598b94d8989` | NOASSERTION | 2026-07-14 |
| 24 | `SailikNanda/ERA-System-Prompts` | `main` | `46c310adc12388ca80ab3d3b73e53b1eacf6a6a8` | NOASSERTION | 2026-10-02 |
| 25 | `p-e-w/heretic` | `master` | `6fc6074c61f739dc4ed2ce95ac16898024f074ce` | AGPL-3.0 | 2026-11-05 |
| 26 | `NousResearch/hermes-agent` | `main` | `c5f347ebe9b840c3dbe5ec99bbe8e36871f24393` | MIT | 2026-11-05 |
| 27 | `morluto/rea` | `main` | `c7fce66035a4eba490157b4ec3f43b1a7515aa99` | MIT | 2026-11-05 |
| 28 | `darkzOGx/youtube-automation-agent` | `master` | `e973d515aef90c467da2289144df737a3bd03859` | MIT | 2026-10-27 |
| 29 | `CapSoftware/Cap` | `main` | `4d6853fcef2a9bafaadf97ba02331c55f8ac760c` | NOASSERTION | 2026-11-05 |
| 30 | `chatwoot/chatwoot` | `develop` | `ac544b2f1e7cf857a3b8cfddc50168d06c54a275` | NOASSERTION | 2026-11-05 |
| 31 | `calcom/cal.diy` | `main` | `2eb48eccd8aca8a0c0ffabf28cf92e298b33ecee` | MIT | 2026-11-03 |
| 32 | `opf/openproject` | `dev` | `9ae6b5cc50ba3b675661f751d2ca9f361cb1f0b3` | GPL-3.0 | 2026-11-05 |
| 33 | `OpenWhispr/openwhispr` | `main` | `1fdbe7e4cc7a4a0bbc876dc5339ac643d0de98c9` | MIT | 2026-11-05 |
| 34 | `AppFlowy-IO/AppFlowy` | `main` | `8fcee27d9bd93aad4ee0191d5d8d915d6a9a4e93` | AGPL-3.0 | 2026-11-02 |
| 35 | `every-app/open-seo` | `main` | `0749caf15796888dd9034cd52e8d344e2b44e09f` | MIT | 2026-11-05 |
| 36 | `wide-trace/open-higgsfield` | `main` | `b16a0efe4d7e2707b56f8ccb02387fd2a9d2eddf` | NOASSERTION | 2026-09-17 |
| 37 | `Oldcircle/geo-sleuth` | `main` | `5aeec412c5496136b4b36259679f79b8a2d09cec` | MIT | 2026-11-05 |
| 38 | `suifeng9203/HeyGem.ai` | `main` | `cb5ff4266a182a8eb3ee7d91c5c72a4d74060768` | NOASSERTION | 2025-04-27 |
| 39 | `Comfy-Org/ComfyUI` | `master` | `fb2b26fdac507b7da81277c7becaf54c5e46ac6b` | GPL-3.0 | 2026-11-05 |
| 40 | `k2-fsa/OmniVoice` | `master` | `08be0b4ccbac3e13e374e86fbfead4b4cac343e2` | Apache-2.0 | 2026-11-02 |
| 41 | `cjpais/Handy` | `main` | `82dfab9fda18c4bc24e1f6e56d36474d38eca0bc` | MIT | 2026-11-02 |
| 42 | `volcengine/OpenViking` | `main` | `739e17f9172b9f595bfe4cc95293ec52d4686120` | AGPL-3.0 | 2026-11-05 |
| 43 | `cathrynlavery/diagram-design` | `main` | `f24d98b05e2d7a5e68c2dedfe46e5b7173f50118` | MIT | 2026-11-03 |
| 44 | `K-Dense-AI/scientific-agent-skills` | `main` | `a25cf9ec00e2745d03f8704acf6f6919694ccd9a` | MIT | 2026-11-02 |
| 45 | `rohitg00/agentmemory` | `main` | `f0f7378ac42849b863fcc5c8e753f120d5ec6f9d` | Apache-2.0 | 2026-11-05 |
| 46 | `browser-use/browser-use` | `main` | `b49a68e4060acb226da8f784194fef301c53a6d7` | MIT | 2026-11-05 |
| 47 | `nexu-io/open-design` | `main` | `5fb1a68f2af27f0a1c0fdefc04858c2f092359ae` | Apache-2.0 | 2026-11-05 |
| 48 | `1jehuang/jcode` | `master` | `cedcdee71b721d0c053ee930d6f8ddbf9192e880` | MIT | 2026-11-05 |
| 49 | `msitarzewski/agency-agents` | `main` | `b37b5bb33b78f2c1d6567d98e25ca818e3259219` | MIT | 2026-10-25 |
| 50 | `dramaclaw/dramaclaw` | `main` | `c7d9f0e459496b7d0b1251b3d9c95a3484d409bc` | NOASSERTION | 2026-11-05 |
| 51 | `TechyCSR/OpenCluely` | `main` | `0a9da75135f5aade3a067d86a7c8bb73f372f014` | Apache-2.0 | 2026-11-02 |

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
