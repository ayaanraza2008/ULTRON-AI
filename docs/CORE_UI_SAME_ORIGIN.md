# ULTRON Core UI — same-origin frontend

The source-controlled living-core interface is served by the existing Express backend on the same origin as `/api/*`. No second proxy service or extra frontend framework is required.

## Behavior
- `GET /` serves `public/index.html`; JavaScript, CSS and the SVG favicon are served from the explicit source-controlled `public/` directory.
- Existing authenticated API routes remain the same-origin backend and keep their authentication/rate limits.
- Static responses have restrictive security headers; dotfiles and directory listings are not exposed. The HTML entry point is not cached, while production assets use a short five-minute cache.
- Camera and microphone are permitted by the browser policy for this origin, but the browser still prompts for device permission and the interface only requests access after a user action. Live observation remains visibly opt-in.
- The interface uses a GPU/WebGL particle field when available and reduces its particle count for reduced-motion, lower-memory, lower-core, or compact-device conditions. A successful build does not prove real model inference, device pairing or speech-provider quality.

## Verification
The `tests/frontend-serving.test.js` suite checks the page, three static assets, security headers, hidden paths and the existing health API. `npm run check` also syntax-checks `public/app.js`.
