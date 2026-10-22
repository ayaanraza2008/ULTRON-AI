# ULTRON AI Windows Companion

This is a lightweight Electron shell around the hosted ULTRON web client. It now exposes a small allowlisted local-action bridge: native-confirmed text-file reading, text-file saving, HTTPS link opening, and basic OS metadata. It does not run local AI models or provide arbitrary shell execution.

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

The bridge never exposes arbitrary shell execution, raw filesystem paths, background startup, or hidden monitoring. Every local action requires a native confirmation and a user-selected file/path. File content may be sent to an AI provider only if the user subsequently submits it. Full PC automation, app control, background task execution, and local-model serving still require a separate permission-scoped agent and explicit allowlisted actions.
