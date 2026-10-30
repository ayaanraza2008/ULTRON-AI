# ULTRON upstream repository integration audit — 2026-10-30

## Scope

This audit tracks the 41 repository names shown in the supplied screenshots, the existing Cactus/Needle integration, and ULTRON's Chrome DevTools bridge: 43 capability records in `GET /api/agent/repositories`. The registry is not an instruction to clone entire apps into one Node process. Several upstreams are full desktop/web apps, local runtimes, model weights, paid API services, or agent-skill collections; the supported integration boundary is an adapter, local companion, task-aware guidance, or explicitly blocked/needs-review state.

## What is present in ULTRON source

- **Existing API/service adapters:** Chatwoot, Cal.diy, OpenProject, VoiceStudio, Geo-Sleuth, HeyGem, ComfyUI, OmniVoice, Handy, OpenViking, AgentMemory, Browser Use, God's Eye View action contract, Paperclip read-only connector, REA MCP connector, Obscura MCP connector, Cactus/Needle, Hermes Agent, read-only Google Workspace integrations, AppFlowy Cloud, OpenDesign, Open Generative AI/MuAPI, OpenHiggsfield and OpenSEO MCP.
- **Existing task-aware/reference workflows:** ECC skill selection (TDD, security review, backend patterns, research and verification), awesome-harness-engineering guidance, cybersecurity skills, diagram design, scientific-agent skills, YouTube production-plan drafting, and a curated public-API reference.
- **New capability wiring in this work:** Chrome DevTools CDP bridge (TypeScript HTTP + MCP) and an optional Strata OpenAI-compatible model provider. Strata provider routing is opt-in; it never installs Strata or downloads models. Tool-call and vision compatibility default to disabled.
- **Separate services / native apps:** Cap, OpenWhispr and macOS-only Atticus cannot be made operational merely by copying their README files. AppFlowy, OpenDesign, OpenSEO, OpenHiggsfield and MuAPI now have guarded source adapters, but still require separate services, credentials, provider/model availability, budgets and live end-to-end verification.
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

## Adapter integration status — 2026-10-29 candidate

The candidate adds guarded adapters for AppFlowy Cloud (read-only workspace/page/document-collab JSON/search), OpenDesign (explicitly approved headless runs), Open Generative AI/MuAPI (allowlisted image/video models with approval gates), and OpenHiggsfield (38 allowlisted models with credit-consumption approval gates). OpenSEO MCP is exposed in the integration catalog and capability readiness. These are source-integrated adapters, not proof of live upstream authorization, provider quotas, paid credits, output quality, or completed end-to-end tasks. Default configuration remains disabled/optional.

See `integrations/appflowy.js`, `integrations/open-design.js`, `integrations/open-generative-ai.js`, `integrations/open-higgsfield.js`, and their focused tests.


## 2026-10-30 cross-sector source reconciliation

- Reconciled the capability map's older rows with the candidate's actual source: AppFlowy Cloud read-only connector; OpenSEO MCP connector; OpenDesign owner-scoped headless daemon; Open Generative AI/MuAPI allowlisted generation; and OpenHiggsfield allowlisted generation.
- Updated each integration's prerequisites and risk boundary. No paid generation was invoked; all optional adapters remain disabled unless configured, and credit-consuming jobs require explicit approval.
- The candidate also contains a separate local-first Python terminal assistant. Its script execution requires interactive approval but is not an OS sandbox; the Node coding sandbox is a distinct Docker-backed, digest-pinned, network-disabled, owner-only path and remains unverified on the target host until Docker is installed and an authorized smoke test is run.
- These updates correct documentation drift; they do not change the underlying live-verification status of any external service.
