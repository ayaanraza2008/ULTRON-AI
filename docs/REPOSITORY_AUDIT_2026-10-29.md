# ULTRON upstream repository integration audit — 2026-10-29

## Scope

This audit tracks the 41 repository names shown in the supplied screenshots, the existing Cactus/Needle integration, and ULTRON's Chrome DevTools bridge: 43 capability records in `GET /api/agent/repositories`. The registry is not an instruction to clone entire apps into one Node process. Several upstreams are full desktop/web apps, local runtimes, model weights, paid API services, or agent-skill collections; the supported integration boundary is an adapter, local companion, task-aware guidance, or explicitly blocked/needs-review state.

## What is present in ULTRON source

- **Existing API/service adapters:** OpenSEO MCP (with explicit credit-spend gates), OpenDesign headless BYOK run adapter (owner-scoped and explicitly approved), Chatwoot, Cal.diy, OpenProject, Geo-Sleuth, HeyGem, ComfyUI, OmniVoice, Handy, OpenViking, AgentMemory, Browser Use, God's Eye View action contract, Paperclip read-only connector, REA MCP connector, Obscura MCP connector, Cactus/Needle, Hermes Agent, and read-only Google Workspace integrations.
- **Existing task-aware/reference workflows:** ECC skill selection (TDD, security review, backend patterns, research and verification), awesome-harness-engineering guidance, cybersecurity skills, diagram design, scientific-agent skills, YouTube production-plan drafting, and a curated public-API reference.
- **New capability wiring in this work:** Chrome DevTools CDP bridge (TypeScript HTTP + MCP), optional Strata OpenAI-compatible model provider, an owner-scoped OpenHiggsfield media adapter for 38 allowlisted model IDs, and an owner-scoped OpenDesign headless BYOK run adapter. Both OpenHiggsfield and OpenDesign remain disabled by default; generation/run submissions require explicit approval. Live provider auth, billing, OpenDesign daemon/OpenCode runtime, model access and end-to-end results are not verified.
- **Separate services / native apps:** Cap, OpenWhispr, AppFlowy, OpenSEO, OpenHiggsfield, and macOS-only Atticus cannot be made operational merely by copying their README files. OpenDesign now has a thin headless REST adapter, but its daemon and OpenCode runtime remain a separate deployment; provider keys and a project are required. These components require service APIs/MCP contracts, desktop companions, provider keys, and/or model assets as appropriate.
- **Still unresolved from the screenshot/source search:** free-cloud-code, Not.AI, dramadaw, and OpenDudley could not be reliably matched to a public repository under the exact visible names. Do not substitute a similarly named project without evidence.
- **Reviewed but not bundled as executable integrations:** Heretic has an AGPL-3.0 source license and remains behind license/resource/manual-approval gates; jcode is a separate MIT-licensed local CLI and needs a sandboxed local execution bridge; Open-Generative-AI has MIT app source but uses a provider-backed media studio with separate usage/model terms; agency-agents is an MIT-licensed specialist-agent prompt library and remains reference-only. None of these upstream apps, model weights or prompt packs have been installed/copied into ULTRON.

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
