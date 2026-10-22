# KaliGPT-inspired capabilities in ULTRON

This integration implements a native ULTRON security-assistance layer inspired by the documented capability areas of [SudoHopeX/KaliGPT](https://github.com/SudoHopeX/KaliGPT). It does not vendor or copy KaliGPT source code; review the upstream license before any future source reuse.

## Added API

- `GET /api/kaligpt/capabilities` — authenticated readiness manifest for OpenRouter, Ollama-compatible local inference, LiteLLM-compatible gateways, Gemini, and OpenAI. It reports only booleans and never returns secret values.
- `POST /api/kaligpt/security/assist` — authenticated model-backed helper for security learning, defensive reviews, authorized assessment planning, and Linux administration. It accepts a task, optional hostname/URL, mode, and evidence.
- Existing ULTRON endpoints remain the integration layer for web research, local-model chat, coding assistance, model selection, and task records.

## Safety and execution boundary

The security assistant generates guidance only. It does not execute shell commands, contact the supplied target, perform scans, or modify a system. Arbitrary shell access is intentionally not exposed through the public cloud API. Any future desktop tool runner must use a separate authenticated desktop bridge, per-tool allowlists, visible permission prompts, timeouts, audit logs, and an emergency stop.

The endpoint rejects malformed targets, bounds input sizes, uses server-side provider credentials, times out upstream calls, and returns a clear `execution: not_executed` field. The capability manifest is configuration readiness, not proof that a provider or local service is reachable.

## Current status

Implemented in this branch:
- KaliGPT-inspired capability/readiness manifest.
- Model-backed cybersecurity learning and defensive planning endpoint.
- Regression tests for secret redaction, missing provider configuration, and the no-execution boundary.

Not claimed as complete:
- Live Gemini/OpenAI/LiteLLM adapter routing. The manifest reports their configuration, but this new assistant endpoint currently calls the configured OpenRouter gateway.
- Actual Kali Linux command execution, Nmap/Nikto integration, browser automation, or desktop control.
- Live provider tests, UI controls, and production deployment verification.

## Verification

Run `npm test` and `npm run check` in the repository. These tests use mocked provider responses and do not prove live external API connectivity.
