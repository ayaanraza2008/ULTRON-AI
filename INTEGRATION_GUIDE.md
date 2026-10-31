# ULTRON AI — External Infrastructure & MCP Integration Guide

> **Official Integration Protocols for GitHub, Supabase, and Render (ULTRON CORE)**  
> Environments: **Google Antigravity** | **Claude Code** | **OpenAI Codex**

---

## 1. Overview of MCP Ecosystem

The Model Context Protocol (MCP) provides standardized, secure tool access for AI coding environments. ULTRON AI connects to three official external services:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       AI CODING AGENTS (CLIENTS)                            │
│           Google Antigravity  │  Claude Code  │  OpenAI Codex               │
└──────────────────────┬───────────────┬───────────────┬──────────────────────┘
                       │               │               │
         ┌─────────────┴──────┐ ┌──────┴──────┐ ┌──────┴──────────────┐
         ▼                    ▼ ▼             ▼ ▼                     ▼
┌───────────────────┐  ┌────────────────────┐  ┌──────────────────────┐
│    GitHub MCP     │  │    Supabase MCP    │  │      Render MCP      │
│   (Stdio / NPM)   │  │ (Streamable HTTP)  │  │ (Streamable HTTP)    │
│                   │  │                    │  │                      │
│ @modelcontext-    │  │ https://mcp.       │  │ https://mcp.         │
│ protocol/server-  │  │ supabase.com/mcp   │  │ render.com/mcp       │
│ github            │  │                    │  │                      │
│                   │  │ Project Ref:       │  │ Workspace:           │
│ Repo: ayaanraza-  │  │ opdjfhwepmcpr-     │  │ ULTRON CORE          │
│ 2008/ULTRON-AI    │  │ bqojpat (Mumbai)   │  │ Services: 4 active   │
└───────────────────┘  └────────────────────┘  └──────────────────────┘
```

---

## 2. GitHub Integration

### Configuration & Scopes:
- **Repository:** `ayaanraza2008/ULTRON-AI`
- **MCP Server Package:** `@modelcontextprotocol/server-github` (Stdio transport)
- **Required Token Scopes:** `repo`, `read:org`, `gist`
- **Execution Command:** `cmd.exe /c npx -y @modelcontextprotocol/server-github`

### Environment Configuration:
- **Antigravity (`~/.gemini/config/mcp_config.json`):**
  ```json
  "github": {
    "command": "cmd.exe",
    "args": ["/c", "npx", "-y", "@modelcontextprotocol/server-github"],
    "env": {
      "GITHUB_PERSONAL_ACCESS_TOKEN": "<TOKEN>"
    }
  }
  ```
- **Claude Code (`claude mcp add`):**
  ```bash
  claude mcp add github -e GITHUB_PERSONAL_ACCESS_TOKEN=<TOKEN> -- cmd.exe /c npx -y @modelcontextprotocol/server-github
  ```
- **OpenAI Codex (`codex mcp add`):**
  ```bash
  codex mcp add github --env GITHUB_PERSONAL_ACCESS_TOKEN=<TOKEN> -- cmd.exe /c npx -y @modelcontextprotocol/server-github
  ```

### Permitted Operations:
- Read repository contents, commit history, pull requests, and issues.
- Create feature branches and submit pull requests.
- Inspect CI workflow runs (`gh run list`, `gh pr checks`).

---

## 3. Supabase Integration

### Configuration & Scope:
- **Project Ref:** `opdjfhwepmcprbqojpat`
- **Project Region:** Mumbai (`ap-south-1`)
- **Direct Database URL:** `https://opdjfhwepmcprbqojpat.supabase.co`
- **Hosted MCP Endpoint:** `https://mcp.supabase.com/mcp` (Streamable HTTP transport)
- **Local Alternative:** `cmd.exe /c npx -y @supabase/mcp-server-supabase`

### Environment Configuration:
- **Antigravity (`~/.gemini/config/mcp_config.json`):**
  ```json
  "supabase": {
    "url": "https://mcp.supabase.com/mcp"
  }
  ```
- **Claude Code (`claude mcp add`):**
  ```bash
  claude mcp add --transport http supabase https://mcp.supabase.com/mcp
  # Authenticate interactively via:
  claude mcp login supabase
  ```
- **OpenAI Codex (`codex mcp add`):**
  ```bash
  codex mcp add supabase --url https://mcp.supabase.com/mcp
  # Follow the displayed browser OAuth prompt
  ```

### Non-Negotiable Supabase Rules:
1. **Never Disable RLS:** Row Level Security must remain enabled on all tables.
2. **Never Expose Service Role Key:** The `SUPABASE_SERVICE_ROLE_KEY` is exclusively for server-side trusted processes; never provide it to client configs.
3. **Additive Migrations Only:** All schema modifications must be developed as versioned SQL migration files in `supabase/migrations/`.
4. **Preserve Production Data:** No test script may perform destructive operations (`DROP`, `TRUNCATE`, `DELETE *`) against non-disposable rows.

---

## 4. Render Integration

### Configuration & Scope:
- **Target Workspace:** **`ULTRON CORE`** (strict prohibition against older workspaces)
- **Hosted MCP Endpoint:** `https://mcp.render.com/mcp` (Streamable HTTP transport)
- **Active Services in `ULTRON CORE`:**
  1. `ultron-ai-core` (Primary API Server)
  2. `ultron-rea-gateway` (REA Integration Gateway)
  3. `ultron-browser-use-core` (Browser Automation Bridge)
  4. `ultron-core-interface` (Frontend PWA Interface)
- **Authentication:** Bearer token via `RENDER_API_KEY`

### Environment Configuration:
- **Antigravity (`~/.gemini/config/mcp_config.json`):**
  ```json
  "render": {
    "url": "https://mcp.render.com/mcp"
  }
  ```
- **Claude Code (`claude mcp add`):**
  ```bash
  claude mcp add --transport http render https://mcp.render.com/mcp -H "Authorization: Bearer <RENDER_API_KEY>"
  ```
- **OpenAI Codex (`codex mcp add`):**
  ```bash
  codex mcp add render --bearer-token-env-var RENDER_API_KEY --url https://mcp.render.com/mcp
  ```

### Non-Negotiable Render Rules:
1. **Workspace Verification:** Always verify that the targeted workspace is `ULTRON CORE` before any inspection or operation.
2. **No Deletion:** Never delete existing Render services, databases, or disks.
3. **No Unauthorized Deployments:** Never trigger production deployments or manual rebuilds without explicit user consent.
4. **Preserve Environment Variables:** Never overwrite or expose production environment variables.

---

## 5. Connection Verification Matrix

Run these diagnostic commands to verify connection health across all platforms:

```bash
# 1. Verify GitHub CLI authentication and repo access
gh auth status
gh api repos/ayaanraza2008/ULTRON-AI | jq .permissions

# 2. Verify Claude Code MCP status
claude mcp list

# 3. Verify OpenAI Codex MCP status
codex mcp list

# 4. Verify live Render API health (ULTRON CORE)
curl https://ultron-ai-core.onrender.com/api/health

# 5. Verify Supabase project response
curl -I https://opdjfhwepmcprbqojpat.supabase.co/rest/v1/
```
