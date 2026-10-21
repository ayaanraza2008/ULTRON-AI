# ULTRON AI Feature Registry

Statuses: `NOT_STARTED`, `IN_PROGRESS`, `BLOCKED`, `IMPLEMENTED`, `TESTED`, `VERIFIED_IN_DEPLOYMENT`.

| ID | Capability | Dependencies | Status | Verification / blocker | Next action |
|---|---|---|---|---|---|
| CORE-001 | Repository baseline and project documentation | GitHub | TESTED | Repository metadata and empty Git state inspected; docs committed | Continue updating registry at milestones |
| CORE-002 | NaraRouter provider adapter | NARA_ROUTER_API_KEY, verified model | IMPLEMENTED | Server-side adapter uses documented OpenAI-compatible endpoint and SSE parsing; no key supplied yet, so real inference remains untested | Add key and entitled model to host secrets; verify real response |
| CHAT-001 | Streaming text chat | CORE-002, UI | IMPLEMENTED | API route, stream client, error handling, and mocked provider contract test added; live provider unverified | Verify real streamed model response |
| AUTH-001 | Authentication and authorization | Session strategy, database | NOT_STARTED | Architecture decision required before multi-user rollout | Design before exposing personal data |
| DATA-001 | Conversation persistence | Database selection | BLOCKED | Accessible Supabase project belongs to a differently named app; do not reuse without confirmation | Confirm dedicated ULTRON database/project |
| VOICE-001 | Continuous Hindi/English/Hinglish voice loop | Browser audio APIs, STT/TTS providers | NOT_STARTED | Provider language support must be verified | Implement browser-first voice state machine and capability checks |
| MEM-001 | User-controlled long-term memory | DATA-001, auth | NOT_STARTED | Depends on safe user isolation | Implement CRUD, retention and opt-out after DB decision |
| DOC-001 | Image/document uploads and retrieval | Storage, parsers, model support | NOT_STARTED | File limits and provider support must be tested per format | Define upload limits and isolated parsers |
| WEB-001 | Web research with real citations | Search/fetch provider | NOT_STARTED | Search provider/API credentials not configured | Evaluate NaraRouter online mode vs separate provider |
| AGENT-001 | Bounded multi-step task execution | Task store, tool permission model | NOT_STARTED | No arbitrary shell execution | Implement task lifecycle and cancel path |
| DESK-001 | Windows companion | Electron packaging, shared backend | IN_PROGRESS | Secure Electron shell and Windows installer workflow committed; hosted Windows build is pending | Verify installer artifact and test it on a Windows machine |
| AUTO-001 | Browser/Windows automation | Permission framework, desktop client | NOT_STARTED | Requires explicit scoped grants and visible stop | Implement after auth and task orchestration |
| EXT-001 | HeyGem.ai avatar service | Separate runtime, licensing, GPU/server | BLOCKED | Repository uses Silicon Intelligence Community License; attribution and usage conditions require compliance review; heavy GPU requirements | Keep optional, do not bundle until reviewed |
| EXT-002 | ComfyUI generation adapter | Separate service, model workflows | BLOCKED | Repository LICENSE is GPL-3.0; integration should remain a separate service unless copyleft obligations for distribution are reviewed. Heavy inference needs separate host | Review GPL-3.0 obligations and choose generation host |
| EXT-003 | OmniVoice TTS adapter | Compatible runtime, model support | NOT_STARTED | Source LICENSE is Apache-2.0; README claims 600+ languages but actual Hindi/Hinglish quality and model-weight license/runtime must be validated separately | Review model card, weights license, inference API and resource profile |
| EXT-004 | Handy speech-input integration | Windows companion, model runtime | NOT_STARTED | MIT license verified; README describes offline desktop STT, but the most practical integration may be an optional companion workflow rather than bundling the app | Inspect Windows IPC/CLI and runtime constraints |
| EXT-005 | AI Employees workflow patterns | Scheduler/task permissions | NOT_STARTED | MIT license verified; routines and execution dependencies need selective review | Reuse patterns, not whole app |
| OPS-001 | Health, logs, deployment verification | Host configuration | IN_PROGRESS | Render service `ultron-ai` reports live; build and startup logs are successful. Automated live health smoke check was added and is pending CI result | Confirm smoke test and configure access/provider secrets |
| QA-001 | Automated tests and regression checks | Test runner | TESTED | GitHub Actions run `39651294713` passed syntax checks and automated API tests; tests use mocked provider, not real API. A deployed health smoke check is now in CI | Expand streaming, UI, and live-integration tests |
