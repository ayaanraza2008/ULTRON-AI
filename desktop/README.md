# ULTRON AI Windows Companion

This is a lightweight Electron shell around the hosted ULTRON web client. It shares the same backend and does not run local AI models or perform desktop automation by itself.

## Build on Windows

1. Install Node.js 20 or newer.
2. Open a terminal in `desktop/`.
3. Run `npm install`.
4. Run `npm run dist`.
5. The NSIS installer is generated under `desktop/dist/`.

A GitHub Actions workflow can build the Windows installer on a hosted Windows runner. The unsigned installer may show a Windows SmartScreen warning until a code-signing certificate is configured.

## Development

Set `ULTRON_URL` to a trusted HTTPS test deployment. For local development only, `http://localhost:<port>` is accepted. Navigation stays within the configured origin; external HTTPS links open in the system browser. Microphone permission is only granted to the configured origin.

## Boundaries

This shell does not provide native file access, shell execution, background startup, hidden monitoring, or Windows automation. Those capabilities require a separate, permission-scoped local agent and must be added and tested independently.
