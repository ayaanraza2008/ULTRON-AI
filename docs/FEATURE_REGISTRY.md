# ULTRON AI Feature Registry

Statuses: `NOT_STARTED`, `IN_PROGRESS`, `BLOCKED`, `IMPLEMENTED`, `TESTED`, `VERIFIED_IN_DEPLOYMENT`.

| ID | Capability | Dependencies | Status | Verification / blocker | Next action |
|---|---|---|---|---|---|
| CORE-001 | Repository baseline and project documentation | GitHub | TESTED | Repository metadata and empty Git state inspected; initial documentation commit created | Inspect first application commit after scaffold |
| CORE-002 | NaraRouter provider adapter | NARA_ROUTER_API_KEY, verified model | IN_PROGRESS | Official docs confirm OpenAI-compatible `https://router.bynara.id/v1`, Bearer auth, `/chat/completions`, and SSE streaming; no key supplied yet | Implement server-only adapter and tests |
| CHAT-001 | Streaming text chat | CORE-002, UI | NOT_STARTED | Real inference blocked until key/model configured | Implement API route and UI |
| AUTH-001 | Authentication and authorization | Session strategy, database | NOT_STARTED | Architecture decision required before multi-user rollout | Design before exposing personal data |
| DATA-001 | Conversation persistence | Database selection | BLOCKED | Accessible Supabase project belongs to a differently named app; do not reuse without confirmation | Confirm dedicated ULTRON database/project |
| VOICE-001 | Continuous Hindi/English/Hinglish voice loop | Browser audio APIs, STT/TTS providers | NOT_STARTED | Provider language support must be verified | Implement browser-first voice state machine and capability checks |
| MEM-001 | User-controlled long-term memory | DATA-001, auth | NOT_STARTED | Depends on safe user isolation | Implement CRUD, retention and opt-out after DB decision |
| DOC-001 | Image/document uploads and retrieval | Storage, parsers, model support | NOT_STARTED | File limits and provider support must be tested per format | Define upload limits and isolated parsers |
| WEB-001 | Web research with real citations | Search/fetch provider | NOT_STARTED | Search provider/API credentials not configured | Evaluate NaraRouter online mode vs separate provider |
| AGENT-001 | Bounded multi-step task execution | Task store, tool permission model | NOT_STARTED | No arbitrary shell execution | Implement task lifecycle and cancel path |
| DESK-001 | Windows companion | Desktop framework, shared backend | NOT_STARTED | No Windows build runner verified | Select packaging strategy after web core |
| AUTO-001 | Browser/Windows automation | Permission framework, desktop client | NOT_STARTED | Requires explicit scoped grants and visible stop | Implement after auth and task orchestration |
| EXT-001 | HeyGem.ai avatar service | Separate runtime, licensing, GPU/server | BLOCKED | Repository uses Silicon Intelligence Community License; attribution and usage conditions require compliance review; heavy GPU requirements | Keep optional, do not bundle until reviewed |
| EXT-002 | ComfyUI generation adapter | Separate service, model workflows | NOT_STARTED | Heavy model inference unsuitable for automatic install on 8 GB RAM; service/license/workflow review needed | Adapter only after workload host is selected |
| EXT-003 | OmniVoice TTS adapter | Compatible runtime, model support | NOT_STARTED | Language/model/hardware support not yet validated | Inspect README, license, and actual inference interface |
| EXT-004 | Handy speech-input integration | Windows companion, model runtime | NOT_STARTED | Local STT app is a candidate for workflow reference; avoid bundling full app initially | Inspect supported interfaces and license |
| EXT-005 | AI Employees workflow patterns | Scheduler/task permissions | NOT_STARTED | MIT license identified; routines and execution dependencies need selective review | Reuse patterns, not whole app |
| OPS-001 | Health, logs, deployment verification | Host configuration | NOT_STARTED | No Render service linked to ULTRON-AI repo | Configure after runtime is deployable |
| QA-001 | Automated tests and regression checks | Test runner | NOT_STARTED | No baseline test suite exists in empty repository | Add unit tests with provider mocks |
