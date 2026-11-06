# ULTRON AI — Black Energy Core Frontend

**Implementation branch:** `agent/codex/ultron-black-energy-core-ui`  
**Status:** Development-only. Not merged to `main`; not deployed.

## Design

The command center uses a near-black surface, a central purple/crimson particle field, restrained orbital rings, premium system typography, voice/text mode switching, and a glassmorphism settings drawer. Voice mode hides the text composer; Text mode reveals it. The renderer uses a dependency-free WebGL point swarm (20,000 desktop particles, reduced counts on narrower viewports) and a static CSS fallback if WebGL is unavailable. It respects `prefers-reduced-motion` and stops animation when the document is hidden.

## Existing backend integrations

- Session and authentication: `GET /api/session`, `POST /api/auth/signin`, `GET /api/auth/google`, `POST /api/auth/recovery`, `POST /api/auth/signout`, `POST /api/logout`
- Chat and image attachments: `POST /api/chat`
- Conversation persistence: `GET/POST /api/conversations`, `GET /api/conversations/:id/messages`, `POST /api/conversations/:id/messages`
- Models and account preferences: `GET /api/models`, `GET/PUT /api/preferences`
- Live backend status: `GET /api/health`, `GET /api/runtime/readiness`
- Owner activity: `GET /api/jarvis/autonomy/state`, `GET /api/jarvis/tools`, `GET /api/jarvis/agents/tasks`

The UI reports unavailable or unauthorized owner-only endpoints as unavailable. It does not invent camera control, always-on wake-word detection, desktop automation, or task execution functionality. Voice recognition and speech output use the current browser's native SpeechRecognition/SpeechSynthesis support; availability varies by browser and permission state. Image attachments use the existing vision-capable chat path.

## Performance and privacy

No external frontend dependencies or remote font/CDN requests were added. Particle coordinates are generated once into typed arrays; frame updates only change GPU uniforms and issue a point draw. Browser APIs use same-origin URLs and session cookies; server-side provider credentials remain on the backend. User messages are rendered with `textContent`, not injected as HTML.

## Verification

Run:
```bash
npm run check
npm run test:frontend
```

The tests cover the static server route, asset delivery, reduced-motion/responsive CSS contracts, API wiring, and finite deterministic particle buffers. Browser-native speech permissions and physical mobile layout still need manual device acceptance after the branch is reviewed.
