# Blockers

| ID | Blocker | Impact | Required resolution | Can independent work continue? |
|---|---|---|---|---|
| BLK-001 | No `NARA_ROUTER_API_KEY` or `NARA_ROUTER_DEFAULT_MODEL` configured | Cannot verify real model responses | Add key as a Render secret; sign in, use Integrations → Load available models, then set an entitled model alias as a Render secret | Yes: adapter, mocks, and UI are implemented |
| BLK-002 | Supabase Auth email confirmation and live session behavior need end-to-end verification | Account creation may require email confirmation; password recovery UX is not yet implemented | Verify Auth email settings and add password recovery UX | Yes: code and deploy are live |
| BLK-003 | Conversation persistence is implemented but not yet verified against live authenticated users | Incorrect Auth settings or RLS behavior could prevent history saves or reads | Verify account sign-in, conversation create/read, message insert/read, and cross-user denial on the deployed service | Yes: schema and migration are in place |
| BLK-004 | Voice/search service credentials or independent web-search provider are not configured | Voice quality and independent web research cannot be verified end-to-end | Test browser-native voice on supported browsers and evaluate optional providers | Yes: implement provider interfaces |
| BLK-005 | External service license and hardware checks incomplete | Some integrations may be unsuitable for bundling or local use | Complete per-repository and model-weight review before copying code/assets | Yes: implement clean adapters first |
| BLK-006 | Memory items are stored but not yet supplied to the model as context | Saved memories will not automatically affect AI replies yet | Implement explicit opt-in retrieval with clear controls and test user isolation | Yes: authenticated memory CRUD is in place |
