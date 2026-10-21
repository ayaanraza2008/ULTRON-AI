# Technical Decisions

## ADR-001 — Start with a narrow working core
**Decision:** Establish server-side text chat and health checks before implementing agents, voice, memory, or generation services.
**Reason:** The repository was empty; a verifiable core is safer than a large untested feature surface.
**Status:** Accepted.

## ADR-002 — NaraRouter adapter uses documented OpenAI-compatible chat API
**Decision:** Use base URL `https://router.bynara.id/v1` and the documented chat-completions endpoint, keeping model selection configurable and the API key server-side.
**Reason:** Official docs describe Bearer authentication, OpenAI-compatible payloads, and SSE streaming. The model alias must still be selected from models available to the user's key.
**Status:** Accepted; real credentials/model entitlement pending.

## ADR-003 — Do not repurpose other projects' infrastructure implicitly
**Decision:** Do not connect ULTRON to the accessible differently named Supabase project or repoint an existing Render service until the user explicitly chooses that resource.
**Reason:** Prevents data mixing, downtime, and cross-project damage.
**Status:** Accepted.

## ADR-004 — Optional heavyweight services remain disabled by default
**Decision:** Keep avatar, image/video generation, and local model runtimes optional and separately hosted where necessary.
**Reason:** Target PC has 8 GB RAM and integrated AMD graphics; GPU and model requirements vary significantly.
**Status:** Accepted.
