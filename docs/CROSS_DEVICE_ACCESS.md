# ULTRON on other devices

ULTRON's first-party web application is the cross-platform client. Open the same HTTPS ULTRON address on each device and sign in with the same Supabase account. Conversations and other account-backed data are loaded from the ULTRON backend; no separate account or Windows pairing is needed just to use the web app.

## Install the web app

### Android phone or tablet

1. Open the HTTPS ULTRON address in Chrome.
2. Tap INSTALL APP in the ULTRON header when the browser offers it. Alternatively, open Chrome's menu and choose Install app or Add to Home screen.
3. Launch ULTRON from the home screen and sign in with the same account used on your other devices.

### iPhone or iPad

1. Open the HTTPS ULTRON address in Safari.
2. Tap Share, then Add to Home Screen.
3. Keep Open as Web App enabled, then tap Add.
4. Open ULTRON from the home screen and sign in with the same account.

Safari/iOS does not expose Chromium's beforeinstallprompt event. ULTRON's Install App control therefore displays the manual iOS steps instead of pretending it can invoke a native installation prompt.

### Windows, macOS and Linux

1. Open the HTTPS ULTRON address in Chrome or Edge.
2. Use the Install App button when it appears, or choose Install ULTRON from the browser's app/install menu.
3. Sign in with the same account.

Other modern browsers can still use ULTRON as a normal responsive website even when they do not support PWA installation.

## What syncs and what works offline

Available across devices after sign-in: account-owned conversations and messages, user preferences, saved memory, saved documents and other server-backed ULTRON features, subject to each feature's current readiness and permissions.

Offline: the service worker caches only the static app shell (HTML, CSS, JavaScript, manifest and icons). It may show the ULTRON interface while disconnected, but AI chat, authentication, conversations, uploads/downloads, device inventory and integrations require the network. API responses, tokens, conversation history and private files are intentionally not written to the service-worker cache.

Use HTTPS and the same official ULTRON origin on every device. Do not install copies from untrusted domains.

## Separate device companions

- Windows companion: optional wake-word tray launcher and a separate local Python assistant. Its cloud heartbeat is outbound-only status; it is not remote PC control.
- Android companion APK: optional on-device wake-word listener that raises a notification to open ULTRON. It is not the full mobile app and does not control the phone.
- iPhone/iPad: use the installable web app. Background wake-word listening is not provided by the iOS web app.

The PWA source is part of the cross-sector integration candidate. It becomes available on the hosted site only after that candidate is reviewed, merged, and deployed to the canonical HTTPS ULTRON service.
