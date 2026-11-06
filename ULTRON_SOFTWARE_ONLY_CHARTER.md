# ULTRON AI — Product Scope Charter

## Mission

Build one private, single-owner personal AI ecosystem that works across Windows computers, Android devices and web browsers, with one intelligence layer, secure memory and coordinated personal clients.

## Supported product domains

1. **AI brain and providers:** authenticated inference, model selection, provider health, bounded fallback and transparent failure reporting.
2. **Memory and history:** user-controlled preferences, conversations, documents and durable owner-scoped memory.
3. **Agents and workers:** planning, approval gates, bounded execution, retries, cancellation, verification and audit trails.
4. **Research and knowledge:** source-aware web research, document extraction, retrieval and structured reports.
5. **Voice:** wake-word/activation, speech input, speech output, interruption and multilingual interaction where supported.
6. **Vision:** camera input, screen observation, OCR and scene understanding with clear permission indicators.
7. **Desktop assistance:** allowlisted Windows operations, application launch, process tracking and emergency stop.
8. **Mobile companion:** Android pairing, telemetry, notifications and background synchronization within OS restrictions.
9. **Multi-device coordination:** authenticated pairing, presence, shared state, event delivery, application-level acknowledgements, revocation and recovery.
10. **Living Core interface:** a minimal command center connected to real backend state, with accessible and reduced-motion behavior.
11. **Security and privacy:** one-owner boundaries, least privilege, secret handling, audit events, data retention and fail-closed behavior.

## Non-goals

ULTRON is a software personal assistant, not a physical machine. Mechanical construction, motors, actuators, hardware control buses, robot simulation, digital-twin training and physical actuation are not product capabilities, dependencies, release gates or completion criteria.

## Engineering invariants

- Preserve the existing working ULTRON/NAYA product and its account, history, memory, configuration and integrations.
- Do not rewrite the repository as a demo or create a parallel replacement.
- Never fabricate success for unavailable providers, workers, clients or devices.
- A task is complete only after its output is verified.
- High-impact actions require explicit permission and an auditable result.
- Keep the default stack free-first; do not add paid services or upgrade plans without approval.
- Treat tests, builds, live service acceptance and physical client acceptance as separate evidence classes.
- Do not merge or deploy without explicit owner authorization.
