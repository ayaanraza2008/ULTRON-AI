# VoiceStudio integration

ULTRON can use VoiceStudio as an optional speech provider. VoiceStudio runs as a separate service; ULTRON does not bundle its model weights or start a GPU inference server automatically.

## Configure the service

Set these server-side environment variables on the ULTRON backend:

- `VOICESTUDIO_BASE_URL`: VoiceStudio API root, for example `http://localhost:3900` only when ULTRON and VoiceStudio run on the same machine. For remote deployments use a secured HTTPS endpoint.
- `VOICESTUDIO_API_KEY`: required by ULTRON for remote HTTPS endpoints. Keep it in the host's secret settings; never put it in browser code or commit it.

A Render-hosted ULTRON cannot reach `localhost` on your Windows PC. For that arrangement, host VoiceStudio at a secured reachable endpoint or wait for a Windows companion bridge. VoiceStudio may need a GPU and its own model downloads, so it is not guaranteed to run on the free Render instance.

## Authenticated API routes

All routes below require an authenticated ULTRON/Supabase user:

- `GET /api/integrations/voicestudio/status` — checks discovery and model-list endpoints.
- `GET /api/integrations/voicestudio/voices` — returns the available voice profiles.
- `POST /api/integrations/voicestudio/synthesize` — JSON body: `{"text":"Namaste ULTRON","voice":"default","format":"wav"}`. Returns `audioBase64` and audio metadata.
- `POST /api/integrations/voicestudio/transcribe` — JSON body containing `audioBase64`, optional `mimeType` (default `audio/wav`) and optional `language`. Returns the transcript.

Example speech request body:

```json
{
  "text": "Namaste. Main ULTRON hoon.",
  "voice": "default",
  "format": "wav",
  "speed": 1.0
}
```

## Agent tools

When the service is configured, ULTRON's authenticated agent runtime can automatically prefer VoiceStudio for `synthesize_speech`, list voices with `list_speech_voices`, and transcribe supplied audio with `transcribe_audio`. The audio must be attached/provided; ULTRON cannot access a local microphone from the cloud server by itself. If VoiceStudio is not configured, speech synthesis can fall back to the existing compatible OmniVoice adapter, and transcription can fall back to the configured Handy desktop bridge.

## Verification limits

A configured URL is not proof that the service is reachable or that a model is installed. Use the status route and perform a real synthesis/transcription test after setting the environment variables. These speech tools do not make ULTRON fully autonomous: PC control, arbitrary shell commands, and consequential actions remain outside this integration and must use separately scoped, auditable permissions.
