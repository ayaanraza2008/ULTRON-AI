# Agora voice fallback for ULTRON

Agora is an optional real-time conversational voice-session provider. It is not a drop-in TTS endpoint. The current adapter starts/stops a published Conversational AI Studio pipeline using Agora's server-side REST API; browser RTC joining/audio playback still requires the Agora Web SDK client integration.

## Render environment

Add these values to the existing `ultron-ai-core` service only after the code is merged and deployment is explicitly approved:

- `AGORA_APP_ID`: Agora project App ID.
- `AGORA_CUSTOMER_ID`: RESTful API Key / Customer ID from Agora Console.
- `AGORA_CUSTOMER_SECRET`: matching RESTful API Secret. Keep private.
- `AGORA_PIPELINE_ID`: ID of a published agent in Conversational AI Studio.
- `AGORA_DEFAULT_CHANNEL`: a channel name reserved for the ULTRON voice session.
- `AGORA_RTC_TOKEN`: short-lived token for the agent RTC UID, if the Agora App Certificate is enabled. Do not use an expiring temporary token for production.
- `AGORA_APP_CERTIFICATE`: optional marker only; if set, adapter refuses to start without `AGORA_RTC_TOKEN`.
- `AGORA_AGENT_RTC_UID`: optional numeric agent UID; defaults to `0`.
- `AGORA_API_BASE_URL`: optional; defaults to `https://api.agora.io`.
- `ULTRON_INTEGRATION_OWNER_USER_ID`: existing Supabase owner UUID; required by all private integrations.

Never put Agora secrets in frontend variables, source files, chat, or logs.

## API

- `GET /api/integrations/agora/status`
- `POST /api/integrations/agora/start` with JSON `{"remoteRtcUid":"123"}`
- `POST /api/integrations/agora/:agentId/stop`

All routes require the authenticated ULTRON owner. The server uses Basic REST authentication and keeps credentials server-side. The current implementation tracks sessions in process memory, so session stop must be routed to the same backend instance; use a shared session store before horizontally scaling.

## Important integration boundary

The browser still needs Agora's RTC Web SDK to join the same channel, publish microphone audio, subscribe to the agent, and play received audio. This backend adapter alone does not complete the browser microphone/audio experience. If App Certificate is enabled, a secure server-side RTC token issuer with the correct UID/channel privileges is required. Do not paste secrets into GitHub issues or ChatGPT.

Official docs:
- https://docs.agora.io/en/api-reference/api-ref/conversational-ai/join
- https://docs.agora.io/en/api-reference/api-ref/conversational-ai/leave
- https://docs.agora.io/en/api-reference/api-ref/conversational-ai/authentication
