# VoiceStudio integration and production setup

ULTRON's backend includes an authenticated VoiceStudio adapter and agent tools for voice discovery, speech synthesis, and audio transcription. VoiceStudio is a separate application/runtime: these routes do not install its Python environment, download model weights, or launch its inference server.

## What is integrated

- `GET /api/integrations/voicestudio/status` — checks the service's documented discovery/model endpoints.
- `GET /api/integrations/voicestudio/voices` — lists available voice profiles.
- `POST /api/integrations/voicestudio/synthesize` — accepts text, optional voice/model/format/instructions; returns audio as base64.
- `POST /api/integrations/voicestudio/transcribe` — accepts base64 audio and returns text.
- Agent tools: `list_speech_voices`, `synthesize_speech`, and `transcribe_audio`. ULTRON prefers VoiceStudio when it is configured; transcription still requires actual audio input.

All integration routes require an authenticated ULTRON user. Requests use a server-controlled upstream URL, bounded payloads/timeouts, and an optional server-side bearer key. Provider credentials are not sent to the browser.

## Configure ULTRON

Set these environment variables on the ULTRON backend (Render → service → Environment):

- `VOICESTUDIO_BASE_URL`: root URL of a running VoiceStudio backend, without the `/v1` suffix. The VoiceStudio docs use `http://localhost:3900` for a local install.
- `VOICESTUDIO_API_KEY`: optional for local-only VoiceStudio setups; required by ULTRON for a remote HTTPS endpoint.

Never put the API key in browser code, commit it to Git, or send it in chat.

## Important networking limitation

A cloud-hosted ULTRON on Render cannot access `localhost` on your Windows PC. Setting `VOICESTUDIO_BASE_URL=http://localhost:3900` on Render points back to the Render container, not your computer. For production use, run VoiceStudio on a trusted host with sufficient CPU/GPU/RAM and expose it through a secured HTTPS endpoint with authentication, or add a separately authenticated Windows companion/relay. Do not expose the unauthenticated local service directly to the public internet.

A free Render web service is not assumed to be suitable for VoiceStudio inference: model weights, GPU requirements, startup time, persistent storage, and the VoiceStudio license/model licenses must be assessed separately. ULTRON remains usable without VoiceStudio; the integration reports a blocked/unconfigured state rather than pretending speech works.

## Verification

Automated tests mock the upstream service and validate the adapter/agent routing. A passing test does not prove that an actual VoiceStudio model is installed, that a real upstream is reachable, or that Hindi/Hinglish output quality meets expectations. After configuring a real endpoint, use the authenticated status route, list voices, synthesize a short harmless sentence, and transcribe a permitted sample recording.
