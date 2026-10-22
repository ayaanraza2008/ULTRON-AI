# God's Eye View → ULTRON integration plan

This document tracks the integration of [bilawalsidhu/gods-eye-view](https://github.com/bilawalsidhu/gods-eye-view) into ULTRON. The upstream project is a browser-based Cesium 3D globe for public geospatial signals, including aircraft, vessels, satellites, earthquakes, weather, public cameras, voice commands, scene sharing and cinematic camera tours.

## Integration principle

ULTRON should present this as a first-class **World Intelligence** workspace, not launch an unrelated generic dashboard. Its globe client, data-layer modules and local proxy are a substantial application of their own; the existing ULTRON Express backend is not a substitute for them. Integrate the upstream app as a pinned, auditable component and connect it to ULTRON through a narrow, documented tool bridge. Do not copy a few UI labels and claim the full application is integrated.

## Capability map

| Upstream capability | ULTRON integration target | Guardrails / verification |
|---|---|---|
| Photorealistic 3D globe, coordinate/city search, tilt, north-up and reset | World Intelligence workspace | Preserve original upstream behavior and credits; test WebGL/mobile fallback |
| Live aircraft, ships, satellites, earthquakes and fire/event layers | Read-only public-data tools and map layers | Show source, timestamp, stale/fallback state; respect provider limits and attribution |
| Nearby contacts, click-to-track, trails, metadata and cockpit view | User-directed map controls | Track public assets/events only; do not support named-person search or individual surveillance |
| Weather forecast/radar/clouds/lightning/cyclone tracks | Weather layers and voice-query tools | Label forecast vs observed data and source freshness |
| Public camera locations / ALPR camera locations | Map overlays of public camera metadata | Location metadata only; no face recognition, plate lookup, person identification or camera-feed intrusion |
| Voice commands, voice whiteboard, marks, polygons and routes | ULTRON command router + visible map actions | Require user confirmation before saving/sharing; explain what action will occur |
| Analyst counts, filters and ranks across supported layers | Structured, source-cited analysis tools | State data gaps and uncertainty; never present estimates as confirmed facts |
| Satellite pass predictions | Satellite query tool | Show calculation assumptions and time zone |
| 3D aircraft models, sensor styles (CRT/NVG/FLIR/Noir/Snow), detection overlay, military HUD | Optional visual modes | Explicitly label simulated/inferred visualizations; no claims of real sensor detection |
| Scene director, cinematic tours, share links, scene/data-pack import | User-controlled scene workspace | Preview imports; validate files; warn that share links may reveal camera position and selected public target |
| Bundled flood replay and other scene packs | Replay/education workspace | Respect per-dataset and per-asset licenses; identify non-commercial datasets |
| Local-first operation and optional provider keys | Desktop-first runtime plus server-side secret proxy | Never expose provider secrets to browser; avoid assuming a cloud server can access a user's localhost |

## Delivery phases

1. **Upstream pin and build audit**: pin a reviewed upstream commit; inspect Node/runtime requirements, package scripts, static assets, server proxy routes and third-party data/asset licenses. Keep a clear upstream attribution and update path.
2. **First-class app integration**: package the globe as a separately buildable component under ULTRON, serve it through a same-origin route where deployment supports it, and keep the existing ULTRON chat and auth intact. Verify Render build output before enabling auto-deploy.
3. **Tool bridge**: define a strict JSON schema for permitted actions such as fly_to, reset_globe, set_layer, track_public_asset, query_layer, add_annotation, create_scene and get_satellite_pass. Validate arguments and layer IDs server-side; return structured results and evidence.
4. **Voice and autonomy**: route a user's explicit request to the same allowlisted tool bridge. Read-only queries can run without a second prompt; state-changing actions (annotations, scene import/share, persistent settings) require a clear confirmation. Show a visible activity log and stop/cancel control.
5. **Production verification**: tests for invalid tool arguments, prompt-injection in feed text, stale data labels, provider outages, attribution, auth boundaries, mobile WebGL behavior and Windows desktop packaging. Only then mark capabilities as deployed/verified.

## Important status

This document is an integration specification, **not a claim that these features are already running inside ULTRON**. The upstream project is MIT-licensed, but its own data-source documentation states that third-party data and visual assets have separate terms. Each bundled dataset/model and live provider must be reviewed before redistribution. The upstream project's security notes also characterize it as an exploratory client, not a hardened production service.

No upstream code has been copied into ULTRON by this document alone. The actual app bundle, tool bridge, frontend entry point, data-source integration, and deployment tests remain to be implemented and verified.
