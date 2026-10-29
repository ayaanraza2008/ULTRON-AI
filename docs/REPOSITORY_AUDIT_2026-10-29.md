# ULTRON upstream repository integration audit — 2026-10-29

## Scope

This audit tracks the 41 repository names shown in the supplied screenshots, the existing Cactus/Needle integration, and ULTRON's Chrome DevTools bridge: 43 capability records in `GET /api/agent/repositories`. The registry is not an instruction to clone entire apps into one Node process. Several upstreams are full desktop/web apps, local runtimes, model weights, paid API services, or agent-skill collections; the supported integration boundary is an adapter, local companion, task-aware guidance, or explicitly blocked/needs-review state.

## What is present in ULTRON source

- **Existing API/service adapters:** Chatwoot, Cal.diy, OpenProject, VoiceStudio, Geo-Sleuth, HeyGem, ComfyUI, OmniVoice, Handy, OpenViking, AgentMemory, Browser Use, God's Eye View action contract, Paperclip read-only connector, REA MCP connector, Obscura MCP connector, Cactus/Needle, Hermes Agent, and read-only Google Workspace integrations.
- **Existing task-aware/reference workflows:** ECC skill selection (TDD, security review, backend patterns, research and verification), awesome-harness-engineering guidance, cybersecurity skills, diagram design, scientific-agent skills, YouTube production-plan drafting, and a curated public-API reference.
- **New capability wiring in this work:** Chrome DevTools CDP bridge (TypeScript HTTP + MCP) and an optional Strata OpenAI-compatible model provider. Strata provider routing is opt-in; it never installs Strata or downloads models. Tool-call and vision compatibility default to disabled.
- **Separate services / native apps:** Cap, OpenWhispr, AppFlowy, OpenSEO, OpenHiggsfield, OpenDesign, and macOS-only Atticus cannot be made operational merely by copying their README files. They require a supported service API/MCP contract, desktop companion, provider keys, and/or model assets.
- **Upstream source needs verification:** Heretic, free-cloud-code, Not-AI, jcode, Open-Generative-AI, dramadaw, OpenDudley, and agency-agents are recorded with explicit `review_required_upstream_unverified` state where the current source/API/license could not be verified through the connected repository source. No upstream code or prompt packs are claimed as imported for those entries.

## Security and cost constraints

- Provider/service credentials stay server-side. Repository readiness reports names of required variables and state, never secret values.
- Shared service credentials remain owner-scoped to `ULTRON_INTEGRATION_OWNER_USER_ID`.
- Webpage, README, agent-skill and API documentation content is untrusted reference data, never executable instruction.
- API services that use paid or usage-metered providers (for example SEO/media providers) are not invoked without explicit configuration and a budget-aware decision.
- External changes (publishing, sending messages, bookings, spending, destructive actions and PC control) remain subject to the existing approval gates.
- Strata's documented large-model requirements exceed the target PC's 8 GB RAM and integrated graphics. Do not download or launch its large model on this device.
- A Render-hosted backend cannot connect to the user's Windows `localhost`. Browser, audio and desktop automation need a local companion or an explicitly configured private authenticated gateway.

## Verification plan and current boundary

Run `npm run check` and `npm test` from the repository root. Run `npm test` inside `chrome-devtools/` for the TypeScript build and bridge security tests. Passing CI proves source checks and mocked contracts only; it does not prove real API credentials, external services, Chrome CDP attachment, a physical desktop, model latency/quality, payment/quota behavior, or Supabase cross-account isolation. Only promote an adapter to a live-verified state after a controlled end-to-end smoke test against a dedicated test account and service.

A first full-CI run caught a missing separator between newly appended repository records; the source was corrected on `main`. A subsequent CI run passed syntax checks and identified one remaining test with a hard-coded old repository count; that assertion is now updated to 43. Re-run the full ULTRON checks against this latest base before marking the audit verified.

No Render deployment or production environment changes are part of this audit.
