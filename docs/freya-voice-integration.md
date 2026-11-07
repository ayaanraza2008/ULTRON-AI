# Freya Voice AI integration

ULTRON exposes an owner-scoped server-side adapter for Freya's REST speech endpoints.

## Endpoints

- `GET /api/integrations/freya/status` — configuration readiness only; it does not call Freya.
- `POST /api/integrations/freya/synthesize` — accepts `{ "text": "...", "voice": "leyla" }`; returns base64 audio.
- `POST /api/integrations/freya/transcribe` — accepts `{ "audioBase64": "...", "mimeType": "audio/wav" }`; returns transcript text.

All routes require a signed-in Supabase user matching `ULTRON_INTEGRATION_OWNER_USER_ID`. The Freya key is only used by the backend and is never returned to the browser.

## Render environment

On the ULTRON backend service, configure:

- `FREYA_API_KEY`: secret from the Freya account.
- `FREYA_TTS_BASE_URL=https://tts.freyavoice.ai`
- `FREYA_STT_BASE_URL=https://stt.freyavoice.ai`
- `FREYA_TTS_MODEL=freya-tts`
- `FREYA_TTS_VOICE=leyla`
- `FREYA_STT_MODEL=freya-stt`
- `FREYA_STT_LANGUAGE`: leave empty initially; set only to a language code confirmed by Freya.

Also ensure `ULTRON_INTEGRATION_OWNER_USER_ID` is set to the owner's Supabase Auth UUID. Do not put the API key in frontend variables, Git, logs, or chat.

## Provider behavior and limitations

The documented Freya REST endpoints are:

- TTS: `POST https://tts.freyavoice.ai/v1/audio/speech`, JSON body with `model`, `voice`, and `input`.
- STT: `POST https://stt.freyavoice.ai/v1/audio/transcriptions`, multipart fields `file`, `model`, and optional `language`.
- Authentication: `Authorization: Bearer <key>`.

The public integration example uses voice `leyla` and STT language `tr`. Hindi/Hinglish support, other voice IDs, audio formats, quotas, and account entitlements must be confirmed with Freya before claiming them. The adapter deliberately leaves STT language unset by default.

This adapter provides secure backend endpoints; it does not by itself switch the browser's existing Kokoro voice engine or guarantee a live microphone-to-Freya-to-speaker loop. The frontend voice playback/capture flow must call these endpoints and be verified separately before Freya is the active runtime voice. Keep Kokoro/local speech as fallback until the complete voice path is proven.

## Verification

Use the authenticated status route, then synthesize a short harmless phrase and transcribe a permitted sample recording. Verify the actual returned audio bytes and transcript. Mocked tests or a configured status response are not proof of live provider access or Hindi/Hinglish voice quality.
