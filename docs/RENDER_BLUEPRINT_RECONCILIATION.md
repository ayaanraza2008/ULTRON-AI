# ULTRON AI — Render Blueprint Reconciliation Plan
**Workspace:** Render — `Ultron core`  
**Audit Baseline Date:** 2026-11-01  
**Target Repository:** `ayaanraza2008/ULTRON-AI`  
**Reference Document:** `docs/FINAL_AUDIT_2026-11-01.md` (Finding 14)  

---

## 1. Executive Summary

Render Blueprint drift was identified between the declarations in `render.yaml` and the live services operating within the `Ultron core` Render workspace. To protect running production instances, **no automatic infrastructure synchronization was executed**. This document outlines the exact mapped services, duplicate eliminations, and non-destructive reconciliation blueprint.

---

## 2. Live Services vs. Blueprint Mapping

| Live Render Service | Live Type | Deployed Branch / Revision | Blueprint Name (`render.yaml`) | Reconciliation Action |
|---|---|---|---|---|
| `ultron-ai-core` | Web Service (Node.js) | `main` | `ultron-ai` | Align blueprint service name to `ultron-ai-core`. Update health check and remove deprecated Fish Audio variables. |
| `ultron-core-interface` | Web Service (Node.js) | `feature/ultron-live-core-interface-20261029` | *Not in Blueprint* | Add to `render.yaml` as `ultron-core-interface` running `core-ui-proxy.mjs` on port 10000. |
| `ultron-rea-gateway` | Web Service (Python) | `main` | *Not in Blueprint* | Declare `ultron-rea-gateway` with Python runtime and FastAPI startup commands. |
| `ultron-browser-use-core` | Web Service (Python) | `main` | `ultron-browser-use` | Align name to `ultron-browser-use-core`. |
| `ultron-world-intelligence` | Web Service (Node.js) | `main` | `ultron-world-intelligence` | Preserved with pinned God's Eye commit and bridge injection. |
| *(None - Duplicate)* | — | — | `ultron-world-intelligence-globe` | Safe to deprecate/remove from blueprint (duplicate of world-intelligence). |
| *(None - Duplicate)* | — | — | `ultron-world-intelligence-live` | Safe to deprecate/remove from blueprint (duplicate of world-intelligence). |

---

## 3. Environment Variable Sanitization for Free-First Architecture

The following deprecated/paid provider environment declarations in `render.yaml` must be removed or marked explicitly optional:

1. `FISH_API_KEY`: Gated behind `ULTRON_ENABLE_FISH_AUDIO=true`; remove from default production blueprint.
2. `FISH_AUDIO_VOICE_MODEL_ID`: Legacy default; replaced by local `am_onyx` Kokoro neural voice.
3. `FISH_AUDIO_TTS_MODEL` & `FISH_AUDIO_STT_MODEL`: Removed from active path.
4. `TTS_API_BASE_URL` & `TTS_API_KEY`: Kept optional for generic OpenAI-compatible providers.

---

## 4. Reconciled `render.yaml` Specification (Ready for Operator Review)

```yaml
services:
  # 1. ULTRON AI Core Backend
  - type: web
    name: ultron-ai-core
    runtime: node
    plan: free
    region: singapore
    buildCommand: npm install --ignore-scripts && mkdir -p .runtime && rm -rf .runtime/geo-sleuth && git clone --filter=blob:none https://github.com/Oldcircle/geo-sleuth.git .runtime/geo-sleuth && git -C .runtime/geo-sleuth checkout e01849f778afeb7c53ca79331313fbcfcb879486 && curl -LsSf https://astral.sh/uv/0.7.13/install.sh | sh
    startCommand: export PATH="$HOME/.local/bin:$PATH"; npm start
    healthCheckPath: /api/health
    autoDeployTrigger: commit
    envVars:
      - key: NODE_ENV
        value: production
      - key: NODE_VERSION
        value: 24.14.0
      - key: SUPABASE_URL
        value: https://opdjfhwepmcprbqojpat.supabase.co
      - key: SUPABASE_SERVICE_ROLE_KEY
        sync: false
      - key: SUPABASE_PUBLISHABLE_KEY
        sync: false
      - key: OPENROUTER_DEFAULT_MODEL
        value: "openrouter/free"

  # 2. ULTRON Core Interface (Frontend PWA & Proxy)
  - type: web
    name: ultron-core-interface
    runtime: node
    plan: free
    region: singapore
    buildCommand: npm install --ignore-scripts
    startCommand: node core-ui-proxy.mjs
    healthCheckPath: /
    autoDeployTrigger: commit
    envVars:
      - key: NODE_ENV
        value: production
      - key: NODE_VERSION
        value: 24.14.0

  # 3. ULTRON Browser Use Core
  - type: web
    name: ultron-browser-use-core
    runtime: python
    plan: free
    region: singapore
    buildCommand: pip install -r browser-use-bridge/requirements.txt
    startCommand: cd browser-use-bridge && uvicorn main:app --host 0.0.0.0 --port $PORT
    autoDeployTrigger: commit

  # 4. ULTRON World Intelligence
  - type: web
    name: ultron-world-intelligence
    runtime: node
    plan: free
    region: singapore
    buildCommand: rm -rf .build-gods-eye-view && git clone https://github.com/bilawalsidhu/gods-eye-view.git .build-gods-eye-view && cd .build-gods-eye-view && git checkout 7be5937fc3e3b10cdfa8d3f833536167268768ad && cd .. && node scripts/patch-world-intelligence-source.mjs && cd .build-gods-eye-view && npm ci --include=dev && npm run build && cd .. && node scripts/inject-world-intelligence-bridge.mjs
    startCommand: cd .build-gods-eye-view && npm run preview -- --host 0.0.0.0 --port $PORT
    autoDeployTrigger: commit
```

---

## 5. Non-Destructive Deployment Protocol

1. Reconcile frontend and backend into the current release branch.
2. Verify all CI pipelines pass.
3. Operator reviews the blueprint diff in Render Dashboard.
4. Manual sync executed only after operator signoff.
