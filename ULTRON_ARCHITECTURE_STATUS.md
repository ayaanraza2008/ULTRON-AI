# ULTRON AI — Architecture Status

## Current product architecture

| Layer | Responsibility | Primary areas |
|---|---|---|
| Intelligence | Provider selection, prompt/context shaping and inference | `core/`, provider integrations |
| Memory/data | Conversations, preferences, documents, user-approved memory and task records | `cognitive-memory.js`, Supabase-backed APIs |
| Agent runtime | Planning, permission checks, bounded tool execution and verification | `agents/`, `agent-runtime.js`, `worker.js` |
| Research | Web retrieval, document extraction and knowledge indexing | `system/ai-employees/`, `knowledge/` |
| Voice | Wake-word, audio processing, speech input/output | `voice/` |
| Vision | Camera/screen observation, OCR, scene and gesture understanding | `vision/` |
| Windows client | Allowlisted desktop operations and process lifecycle | `system/windows-desktop-agent.js`, `windows-companion/` |
| Android client | Pairing, telemetry and background sync | `integrations/android-bridge.js`, `android-companion/` |
| Device coordination | Pairing, presence, event queues, ACKs and shared state | `integrations/multi-device-*.js`, `integrations/device-hub.js` |
| Interface | Living Core command center and live state | `public/`, separate interface service |
| Security | Owner isolation, authorization, secret scanning and audit | `security/`, `server.js`, `jarvis-router.js` |

## Current implementation changes

- The API router no longer imports or registers retired hardware/simulation endpoints.
- The device manager no longer defines the retired hardware-specific device type.
- Dedicated hardware/simulation source and test files have been removed.
- The syntax checker discovers tracked JavaScript files rather than relying on a stale static list.
- Multi-device persistence now wires the configured Supabase REST client, uses explicit upserts, and routes delivery ACK/revocation through the configured persistence adapter.

## Operational limitations

The connected Supabase schema has not yet received the repository's later companion and shared-state migrations. Until those schema changes are reviewed and applied, cloud persistence and live device pairing remain unverified. Do not treat local file fallback as durable cloud state.

See `ULTRON_PRODUCTION_READINESS.md` and `ULTRON_BLOCKERS.md` for the release gates.
