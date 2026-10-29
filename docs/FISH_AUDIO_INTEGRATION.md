# Fish Audio speech integration

ULTRON's authenticated speech endpoints support Fish Audio directly, using the official REST API instead of assuming that Fish Audio is an OpenAI-compatible provider.

## Environment

Set these on the ULTRON backend only:

- `FISH_API_KEY`: your Fish Audio API key. It is a secret; never put it in browser code, local storage, Git, or chat.
- `FISH_AUDIO_VOICE_MODEL_ID=7a18a1851d2649108c48ec9f2c80eb2c`: the voice/reference model ID for speech output. This is not the API key.
- `FISH_AUDIO_TTS_MODEL=s2.1-pro-free`: TTS engine selector; the free developer-tier model is the default.
- `FISH_AUDIO_STT_MODEL=transcribe-1`: speech recognition model selector.

The API key is shared by TTS and transcription. If `FISH_API_KEY` is configured, Fish Audio takes priority over the optional legacy OpenAI-compatible `TTS_API_*` and `STT_API_*` settings. If it is absent, the legacy adapters remain available; without either provider, speech output/recognition reports a clear not-configured response.

## Endpoints

- `POST /api/speech/synthesize` accepts `{ "text": "Hello" }` and returns MP3 audio bytes. ULTRON calls `POST https://api.fish.audio/v1/tts`, supplies the voice ID as `reference_id`, and sends the configured engine in the `model` header.
- `POST /api/speech/transcribe` accepts `{ "audioBase64": "...", "mimeType": "audio/webm" }` and returns `{ "text": "...", "language": "...", "provider": "fish-audio" }`. ULTRON calls `POST https://api.fish.audio/v1/asr` with multipart field `audio` and lets Fish Audio auto-detect the spoken language unless a valid language hint is supplied.
- `GET /api/capabilities` reports whether the Fish Audio key is configured, without returning secret values.

Audio requests are capped before provider calls and provider responses are size-limited. Redirects are rejected; error responses do not include the key. Timeouts and API authentication/quota/rate-limit failures return sanitized codes.

## Local versus hosted voice

The web interface must be served from a secure origin and have microphone permission. Browsers with `SpeechRecognition` use native recognition; where it is missing or the recognition service fails, the interface records short microphone utterances and sends them to the authenticated ULTRON transcription endpoint. The local microphone stays in the browser: raw recordings are sent only when a recorded utterance is submitted for transcription.

Fish Audio synthesis is requested server-side, then played in the browser. The API key never enters the front-end bundle. The voice output endpoint requires a signed-in ULTRON session.

## Costs and live verification

Fish Audio's free TTS tier and transcription availability/quota depend on the current Fish account and plan. A configured environment variable is not proof the key works. After configuring the key, verify one short synthesis and one short recording from the actual interface, then check server status/error codes. Do not publish/deploy a new revision merely because mocked tests pass.

Official references:
- [Fish Audio developer/API guide](https://fish.audio/developers/)
- [Fish Audio API schema](https://docs.fish.audio/api-reference/openapi.json)
- [Text-to-speech endpoint](https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech.md)
- [Speech-to-text endpoint](https://docs.fish.audio/api-reference/endpoint/openapi-v1/speech-to-text.md)
