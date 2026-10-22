# KaliGPT-inspired capabilities in ULTRON

This integration implements a native ULTRON security-assistance layer inspired by the documented capability areas of [SudoHopeX/KaliGPT](https://github.com/SudoHopeX/KaliGPT). It does not vendor or copy KaliGPT source code; review the upstream license before any future source reuse.

## Added API

- `GET /api/kaligpt/capabilities` — authenticated readiness manifest for OpenRouter, Ollama-compatible local inference, LiteLLM-compatible gateways, Gemini, and OpenAI. It reports only booleans and never returns secret values.
- `POST /api/kaligpt/security/assist` — authenticated model-backed helper for security learning, defensive reviews, authorized assessment planning, and Linux administration. It accepts a task, optional hostname/URL, mode, and evidence.
- Existing ULTRON endpoints remain the integration layer for web research, local-model chat, coding assistance, model selection, and task records.
- Desktop local diagnostics are exposed through the Electron preload bridge as `ultronDesktop.runDiagnostic(id)`. The main process validates the trusted window, accepts only fixed IDs (`systemSummary`, `nodeVersion`, `gitVersion`, `pythonVersion`, `diskUsage`, `memoryUsage`, `kernelVersion`), asks for native approval each time, uses fixed argument arrays with `shell: false`, applies a five-second timeout, and bounds returned output. Linux utility commands are read-only and unavailable on Windows. No arbitrary command string, arguments, scripts, or shell access are exposed.
- `POST /api/kaligpt/tools/diagnostics/record` stores a user-submitted, bounded diagnostic result as a `WAITING_FOR_PERMISSION` manual task and writes an audit event. It never runs a command; the result remains a review-only record.
- `GET /api/kaligpt/tools` returns a machine-readable tool catalog with explicit states for implemented, configuration-dependent, unimplemented, and blocked-by-design tools.
- `GET /api/kaligpt/providers` returns configured provider status, default model identifiers, and the automatic fallback order without exposing credentials. This reports environment configuration only, not live provider health.
- `POST /api/kaligpt/security/dns-evidence/analyze` reviews up to 100 user-supplied DNS records for observed SPF and DMARC records and related basic signals. It performs no DNS lookup or target contact; findings explicitly warn that missing submitted evidence is not proof that a record is absent.
- `POST /api/kaligpt/security/http-evidence/analyze` reviews user-submitted HTTP status, headers, and bounded `Set-Cookie` values for HSTS/CSP signals, server banners, and cookie attributes. It performs no target request and returns bounded, contextual findings rather than asserting exploitability.

## Safety and execution boundary

The security assistant generates guidance only. It does not execute shell commands, contact the supplied target, perform scans, or modify a system. Arbitrary shell access is intentionally not exposed through the public cloud API. Any future desktop tool runner must use a separate authenticated desktop bridge, per-tool allowlists, visible permission prompts, timeouts, audit logs, and an emergency stop.

The endpoint rejects malformed targets, bounds input sizes, uses server-side provider credentials, times out upstream calls, and returns a clear `execution: not_executed` field. The capability manifest is configuration readiness, not proof that a provider or local service is reachable.

## Current status

Implemented in this branch:
- KaliGPT-inspired capability/readiness manifest.
- Model-backed cybersecurity learning and defensive planning endpoint with explicit provider selection (`openrouter`, `openai`, `gemini`, `litellm`, `ollama`) or `auto` selection with provider fallback.
- `POST /api/kaligpt/tools/headers/analyze` — deterministic review of HTTP response headers supplied by the user, with findings for HSTS, CSP, nosniff, referrer policy, permissions policy, and frame protection; makes no outbound request.
- Regression tests for secret redaction, missing provider configuration, provider fallback, passive header analysis, and review-only diagnostic task recording.

Not claimed as complete:
- Live connectivity/credential verification for Gemini/OpenAI/LiteLLM/Ollama. Adapters are implemented for this endpoint, but have not been verified against live provider accounts. `auto` selects providers in priority order and now retries the next configured provider after HTTP errors, timeouts, network failures, or empty responses. The fallback test is mocked; live provider behavior is still unverified.
- Actual Kali Linux command execution, Nmap/Nikto integration, browser automation, or desktop control.
- Live provider tests, UI controls, desktop execution bridge, and production deployment verification.

## Verification

Run `npm test` and `npm run check` in the repository. These tests use mocked provider responses and do not prove live external API connectivity.


## Vision model routing

- `POST /api/kaligpt/vision/analyze` accepts a user-supplied base64 image, its MIME type (`image/jpeg`, `image/png`, or `image/webp`), an optional prompt, and an optional provider selection.
- In `auto` mode, it tries configured OpenRouter, OpenAI, Gemini, LiteLLM, and Ollama providers in order and falls back when a provider errors, times out, or returns an empty response.
- The image is sent to the chosen provider for analysis; this is not local-only processing. Remote image URLs are not fetched. Images are limited to 5 MB, and the route does not execute actions based on image content.
- A provider must use a vision-capable model; configuration alone does not guarantee that its selected model supports images. The endpoint reports provider failures rather than claiming vision support is live.


## Chat attachment vision routing

The existing `POST /api/chat` image-attachment path now prefers model IDs from `ULTRON_VISION_MODELS` (comma-separated). These IDs are added to the server-side model allowlist and tried before the regular model list only when image attachments are present. Text-only chats continue to use the requested/default model. Configure only model IDs that support image input; provider availability and quota still need to be verified. The separate `POST /api/kaligpt/vision/analyze` endpoint remains available for direct user-supplied-image analysis.
