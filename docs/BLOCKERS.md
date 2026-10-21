# Blockers

| ID | Blocker | Impact | Required resolution | Can independent work continue? |
|---|---|---|---|---|
| BLK-001 | No `NARA_ROUTER_API_KEY` configured | Cannot verify real model responses or provider-specific runtime behavior | Add key as a local/Render secret and choose a model available to the key | Yes: implement adapter, mocks, and UI |
| BLK-002 | No Render service linked to `ULTRON-AI` | Cannot deploy this repository to the current Render configuration | Confirm/create a dedicated ULTRON web service after build is ready | Yes: build and test locally/mocks |
| BLK-003 | Accessible Supabase project is named `nox-ai` | Reusing it could mix application data | Confirm whether to create/select a dedicated ULTRON project | Yes: defer persistence-dependent features |
| BLK-004 | No voice/search service credentials or chosen providers | Continuous voice and independent web research cannot be verified end-to-end | Evaluate browser-native voice and optional provider choices after core chat | Yes: implement provider interfaces |
| BLK-005 | External service license and hardware checks incomplete | Some integrations may be unsuitable for bundling or local use | Complete per-repository and model-weight review before copying code/assets | Yes: implement clean adapters first |
