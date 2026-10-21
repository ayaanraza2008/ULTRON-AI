# Blockers

| ID | Blocker | Impact | Required resolution | Can independent work continue? |
|---|---|---|---|---|
| BLK-001 | No `NARA_ROUTER_API_KEY` or `NARA_ROUTER_DEFAULT_MODEL` configured | Cannot verify real model responses | Add key as a Render secret; sign in, use Integrations → Load available models, then set an entitled model alias as a Render secret | Yes: adapter, mocks, and UI are implemented |
| BLK-002 | Render service has no `APP_ACCESS_PASSWORD` yet | The live site intentionally shows the setup gate until the owner configures access | Set a strong password in the Render environment panel | Yes: code and deploy are live |
| BLK-003 | Accessible Supabase project is named `nox-ai` | Reusing it could mix application data | Confirm whether to create/select a dedicated ULTRON project | Yes: defer persistence-dependent features |
| BLK-004 | No voice/search service credentials or chosen providers | Continuous voice and independent web research cannot be verified end-to-end | Evaluate browser-native voice and optional provider choices after core chat | Yes: implement provider interfaces |
| BLK-005 | External service license and hardware checks incomplete | Some integrations may be unsuitable for bundling or local use | Complete per-repository and model-weight review before copying code/assets | Yes: implement clean adapters first |
