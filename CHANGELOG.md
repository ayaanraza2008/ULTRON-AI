# ULTRON AI — Changelog & Ecosystem Evolution

All notable changes to the ULTRON AI ecosystem and multi-agent development infrastructure are documented in this file.

---

## [Unreleased] — 2026-10-31

### Added
- **Multi-Agent Development Triad Integration:**
  - Connected **Google Antigravity**, **Claude Code**, and **OpenAI Codex** as coordinated engineering agents.
  - Created shared engineering memory system:
    - [`AGENTS.md`](./AGENTS.md): Master rules, default agent roles, Git branching protocol, and permission tiers.
    - [`CLAUDE.md`](./CLAUDE.md): Claude Code specific instructions, module architecture, and engineering standards.
    - [`ULTRON_ARCHITECTURE.md`](./ULTRON_ARCHITECTURE.md): Full end-to-end architecture diagram, data flows, and security boundaries.
    - [`DEVELOPMENT_GUIDE.md`](./DEVELOPMENT_GUIDE.md): Developer setup, running services, coding standards, and PR workflows.
    - [`INTEGRATION_GUIDE.md`](./INTEGRATION_GUIDE.md): Deep-dive integration manual for GitHub, Supabase, and Render MCP.
    - [`SECURITY_POLICY.md`](./SECURITY_POLICY.md): 3-tier permission matrix (READ, DEVELOPMENT WRITE, PRODUCTION ADMINISTRATION).
    - [`TESTING_GUIDE.md`](./TESTING_GUIDE.md): Automated test runner usage, diagnostic scripts, and smoke test guidelines.
    - [`PROJECT_STATUS.md`](./PROJECT_STATUS.md): Real-time live status verification of GitHub, Render `ULTRON CORE`, and Supabase.
    - [`TASK_TRACKER.md`](./TASK_TRACKER.md): Live multi-agent coordination board.
- **Model Context Protocol (MCP) Configuration:**
  - Added project-scoped [`.mcp.json`](./.mcp.json) for GitHub (`@modelcontextprotocol/server-github`), Supabase (`https://mcp.supabase.com/mcp`), and Render (`https://mcp.render.com/mcp`).
  - Configured global Antigravity MCP in `~/.gemini/config/mcp_config.json`.
  - Configured Claude Code MCP (`claude mcp add` for github, supabase, render; verified github `√ Connected`).
  - Configured OpenAI Codex MCP (`codex mcp add` for github, supabase, render with bearer token support).

### Verified
- **GitHub Repository Access:** Verified `ayaanraza2008/ULTRON-AI` access via `gh` CLI with full admin/maintain/push permissions.
- **Render Workspace (`ULTRON CORE`):** Verified live health endpoint `https://ultron-ai-core.onrender.com/api/health` returning 200 OK matching `main` HEAD commit `92158d843e29c123f81e4c7a61cd88f462c2b58c`.
- **Supabase Project (`opdjfhwepmcprbqojpat`):** Verified live HTTP gateway response and inspected all 16 applied schema migrations with Row Level Security.
- **Automated Test Suite:** Verified `npm run check` and `node --test test/server.test.js` (31/31 passing tests) locally.

---

## Earlier Releases

### 2026-10-31
- Reconciled production revision verification for commit `92158d843e29c123f81e4c7a61cd88f462c2b58c` (#428).
- Hardened Harness2 benchmark executors on current main (#424).
- Upgraded ULTRON Hermes delegation to native Runs API (#426).

### 2026-10-28
- Added private binary document storage migration (`20261027181000_private_document_storage.sql`) with 5 MiB cap and SHA-256 validation.
- Hardened DNS-pinned outbound HTTP transport (`network-safety.js`) against SSRF and DNS rebinding attacks.

### 2026-10-25
- Added read-only Supabase Auth diagnostic utility (`scripts/supabase-auth-diagnostics.mjs`).
- Implemented rate-limited confirmation resend endpoint (`POST /api/auth/resend-confirmation`).
- Established explicit worker smoke verification script (`scripts/worker-smoke.mjs`).

### 2026-10-21
- Created initial database schema migration with complete Row Level Security (`202610210001_initial_schema.sql`).
- Provisioned dedicated Supabase project `opdjfhwepmcprbqojpat` in Mumbai (`ap-south-1`).
