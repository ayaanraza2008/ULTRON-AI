# ULTRON Core UI

The Core service serves the user-facing Living Core interface from the same HTTPS origin as the backend.

- UI route: /
- JavaScript: /app.js
- Styles: /styles.css
- Health: /api/health
- Chat and other API routes: /api/*

## Security and behaviour

Static serving uses Express' public directory, denies dotfiles, and falls through to the existing API handlers. The HTML entry point is not cached; other static assets use a short five-minute production cache. Global security headers remain active.

The browser uses relative /api paths so cookies and API calls remain same-origin. Camera and microphone permissions are not acquired automatically: the browser requests them only after the user activates a relevant UI control. The backend API authorization and rate-limit middleware remain in place.

This UI deployment does not mean Google Workspace, Google OAuth, or every connector is fully verified. OAuth still depends on the Supabase Google provider and redirect allow-list; the read-only Google Workspace Apps Script bridge requires an owner-authorized script deployment and its secret configuration.