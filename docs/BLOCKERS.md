# Blockers

| ID | Blocker | Impact | Required resolution | Can independent work continue? |
|---|---|---|---|---|
| BLK-001 | No `NARA_ROUTER_API_KEY` or `NARA_ROUTER_DEFAULT_MODEL` configured | Cannot verify real model responses | Add key as a Render secret; sign in, use Integrations → Load available models, then set an entitled model alias as a Render secret | Yes: adapter, mocks, and UI are implemented |
| BLK-002 | Render service needs `APP_ACCESS_PASSWORD` and `SESSION_SECRET` configured | The live UI cannot be safely unlocked and session behavior cannot be verified until owner secrets are configured | Set strong secrets directly in the Render environment panel; do not paste them into chat or commit them | Yes: code and deploy are live |
| BLK-003 | Dedicated ULTRON Supabase project and initial schema are ready, but application integration/auth mapping is not implemented | Chat history and user preferences are not yet persisted by the app | Implement server-side Supabase integration, establish authenticated user identity, and test RLS isolation before enabling personal memory | Yes: schema and migration are in place |
| BLK-004 | Voice/search service credentials or independent web-search provider are not configured | Voice quality and independent web research cannot be verified end-to-end | Test browser-native voice on supported browsers and evaluate optional providers | Yes: implement provider interfaces |
| BLK-005 | External service license and hardware checks incomplete | Some integrations may be unsuitable for bundling or local use | Complete per-repository and model-weight review before copying code/assets | Yes: implement clean adapters first |
