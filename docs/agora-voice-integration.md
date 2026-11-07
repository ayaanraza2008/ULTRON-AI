# Agora Conversational AI voice fallback for ULTRON

Agora is the secondary real-time voice provider. Freya remains the preferred speech provider. If Freya is not configured or unavailable at voice-start time, the ULTRON voice control can start the published Agora Conversational AI pipeline.

## Render environment

Add these values to the existing `ultron-ai-core` service only after code review/merge and an explicitly approved deployment:

- `AGORA_APP_ID`: Agora project App ID (32-character hexadecimal ID).
- `AGORA_APP_CERTIFICATE`: Agora project App Certificate (32-character hexadecimal secret). Keep this private.
- `AGORA_PIPELINE_ID`: ID of the published Conversational AI Studio pipeline.
- `AGORA_DEFAULT_CHANNEL`: channel-name prefix, 1–40 letters, digits, underscores, or hyphens (default: `ultron`).
- `AGORA_API_BASE_URL`: optional; defaults to `https://api.agora.io`.

Also ensure `ULTRON_INTEGRATION_OWNER_USER_ID` is set to the owner's exact Supabase Auth UUID. The same owner-only gate protects Freya and Agora.

## What the integration does

1. The owner presses the voice control. Freya is tried first; if it is not configured, the UI checks Agora.
2. ULTRON generates unique numeric client/agent UIDs and a unique channel for that session.
3. The backend uses the official `agora-token` builders to create a short-lived ConvoAI token (RTC + RTM + ConvoAI services) for the agent and a separate RTC publisher token for the browser.
4. The backend starts the published pipeline using the ConvoAI token. Only the browser RTC token, App ID, channel, and client UID are returned to the authenticated owner; the App Certificate and agent token remain server-side.
5. The browser joins with the Agora Web SDK, publishes microphone audio, subscribes to the agent audio, and plays it.
6. Tapping the voice control again leaves RTC and asks the backend to stop the agent.

Tokens expire after 24 hours. The agent session map is currently process-local, so stop requests must reach the same backend instance; use a shared session store before running multiple backend instances. Agora project settings, pipeline publishing, RTC enablement, network access, and microphone permission are required for live voice.

The Agora voice agent runs the published Conversational AI Studio pipeline. It is a separate real-time provider experience; standard ULTRON chat remains available through the existing text and Freya/browser speech paths.

## Security

- Never paste the App Certificate into frontend code, GitHub, or a client setting.
- The browser receives only its own short-lived RTC token, which is necessary to join the Agora channel.
- The backend requires an authenticated ULTRON session whose Supabase user ID matches `ULTRON_INTEGRATION_OWNER_USER_ID`.
- Readiness means credentials are present; it does not prove a live Agora account, pipeline, quota, or network connection.

Official references:
- https://docs.agora.io/en/conversational-ai/develop/authentication
- https://docs.agora.io/en/conversational-ai/develop/quickstart
- https://docs.agora.io/en/video-calling/get-started/get-started-sdk
