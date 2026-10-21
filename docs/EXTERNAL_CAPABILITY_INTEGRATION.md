# External capability integration plan

This plan is adapter-first. ULTRON stays the main application; heavyweight inference services are optional and must not be installed into the Render chat process.

## Repository review

| Source | Planned ULTRON capability | Integration boundary | Current status |
|---|---|---|---|
| [suifeng9203/HeyGem.ai](https://github.com/suifeng9203/HeyGem.ai) | Avatar/talking-head video and lip sync | Separate GPU-backed service adapter | Blocked until license/model terms and hosting are reviewed. Its community license has attribution and a stated 1,000 monthly-active-user threshold requiring a separate license. |
| [Comfy-Org/ComfyUI](https://github.com/Comfy-Org/ComfyUI) | Image/video/audio/3D workflows | Separate ComfyUI API endpoint and curated workflows | GPL-3.0; keep it a separate service and review distribution obligations before bundling code. |
| [k2-fsa/OmniVoice](https://github.com/k2-fsa/OmniVoice) | Multilingual neural TTS; possible consent-based voice cloning | Separate inference API adapter | Source Apache-2.0; model weights, hardware, latency, language quality, and consent behavior still require verification. |
| [cjpais/Handy](https://github.com/cjpais/Handy) | Offline desktop transcription | Local Windows companion/IPC bridge | MIT; a public server cannot directly control the user's local microphone/app. Do not expose a raw local bridge to the internet. |
| [markfulton/ai-employees](https://github.com/markfulton/ai-employees) | Role-based routines and task templates | Native ULTRON task runner with least privilege | MIT; adapt concepts rather than enabling broad browser/PC actions. Preserve attribution/trademark terms and add approval gates. |

## Implemented foundation

- Added a server-side integration catalog endpoint at /api/integrations.
- The endpoint is session-protected and returns capability descriptions, required environment variable names, and configuration readiness only.
- Secret values are never returned.
- Configuration readiness is not a successful connectivity check and does not claim that model weights, GPUs, or external services are available.
- No external repositories or model weights are copied into the ULTRON deployment.

## Environment variables for future adapters

- COMFYUI_BASE_URL
- HEYGEM_API_BASE_URL, HEYGEM_API_KEY
- OMNIVOICE_API_BASE_URL, OMNIVOICE_API_KEY
- ULTRON_HANDY_BRIDGE_URL, ULTRON_HANDY_BRIDGE_TOKEN
- ULTRON_EMPLOYEES_ENABLED (must be the literal string true to enable guarded routine templates)

Do not set these to public endpoints without HTTPS and authentication. Keep secrets in Render's private environment settings, never in source control or browser code.

## Not yet implemented / verified

The endpoint is a readiness registry, not the final feature integrations. No HeyGem render, ComfyUI workflow, OmniVoice speech generation, Handy local transcription, or AI employee routine has been executed by this commit. Each needs a dedicated adapter, explicit authorization, service-specific tests, and live verification. Heavy GPU services are not assumed to fit the existing free Render web service.
