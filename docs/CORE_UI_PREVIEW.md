# ULTRON CORE UI preview

This is a separate, same-origin browser interface for the existing ULTRON backend. It is intentionally not the backend entry point and is not enabled by `npm start`.

## Entrypoint

Use `npm run start:core-ui` to run the UI proxy as its own process. It serves only the static assets in `public/` and forwards `/api/*` and `/world-intelligence/*` to one fixed HTTPS origin. The default origin is `https://ultron-ai-core.onrender.com`; an alternate origin can be set with `ULTRON_CORE_API_ORIGIN`, which must be an HTTPS origin without credentials, path, query string, or fragment.

The regular backend entry point remains `npm start`. No new production service, domain, environment variable, or deployment is created by this change.

## Security notes

- Browser requests use the UI origin; the proxy does not accept arbitrary upstream URLs.
- The living core adapts its particle count to reduced-motion preferences, reported memory/CPU, and compact viewports; reduced-motion mode draws a static core instead of running a continuous animation loop.
- Static asset paths are an explicit allowlist; unknown paths return 404.
- HTTP methods and request body size are bounded. The proxy forwards only selected headers and removes an upstream cookie's Domain attribute so the browser cookie is scoped to the UI host.
- Security headers include a restrictive content security policy, `nosniff`, same-origin camera/microphone permissions, referrer policy, and frame denial.
- Camera and microphone permissions are requested only from an explicit UI action. Camera analysis is user-initiated or uses the separately labelled live-observation toggle. Captured frames are sent to the existing vision/chat endpoint; this interface does not itself persist the video.
- The interface consumes the existing backend routes for authentication, chat, research, task status, capability/readiness, connector status, and transient document text extraction. This does not claim that provider keys, Supabase migrations, background workers, camera hardware, or live model inference have been configured or end-to-end verified.
- Preview CI tests the proxy against mocked upstream responses. It does not deploy the UI or modify the backend's production configuration.
