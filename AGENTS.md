# ULTRON AI — Multi-Agent Engineering Instructions

> **Source of Truth for All AI Coding Environments**  
> Authorized Agents: **Google Antigravity** | **Claude Code** | **OpenAI Codex**  
> Ecosystem: **GitHub × Supabase × Render (ULTRON CORE)**

---

## 1. Mission and Core Principles

The ULTRON AI project is an API-first assistant runtime and intelligence ecosystem. All development is conducted collaboratively by a coordinated multi-agent team adhering to these non-negotiable principles:

1. **Integrate with Existing Infrastructure:** Never create duplicate repositories, databases, or cloud services. Work strictly against existing, authorized resources.
2. **Never Expose Secrets:** Service-role keys, provider API keys, and authentication credentials must never be written into code, documentation, logs, issues, or model prompts.
3. **Verify Before Declaring Complete:** Do not infer live functionality from mocks, syntax checks, or health responses. Mocks prove local logic; live verification requires authorized end-to-end execution.
4. **Never Deploy Without Authorization:** Production deployment and production configuration changes require explicit owner approval.
5. **Protect Branch `main`:** All agent changes must occur on isolated development branches and merge only via reviewed pull requests passing automated CI.

---

## 2. Infrastructure Source of Truth

| System | Resource Identifier | Notes & Constraints |
|---|---|---|
| **GitHub** | `ayaanraza2008/ULTRON-AI` | Default branch: `main`. Full history, issues, PRs, and CI workflows must be preserved. |
| **Supabase** | Project ref: `opdjfhwepmcprbqojpat` | Region: Mumbai (`ap-south-1`). Production data must be preserved. RLS is mandatory on all public tables. |
| **Render** | Workspace: **`ULTRON CORE`** (only) | Services: `ultron-ai-core`, `ultron-rea-gateway`, `ultron-browser-use-core`, `ultron-core-interface`. Never use older workspaces. |

---

## 3. Agent Roles and Default Responsibilities

The three AI engineering environments form a specialized, complementary team:

```
       ┌────────────────────────────────────────────────────────┐
       │                ULTRON AI ENGINEERING TEAM               │
       └────────────────────────────────────────────────────────┘
                   ▲                    ▲                   ▲
                   │                    │                   │
  ┌────────────────────────┐ ┌────────────────────┐ ┌───────────────────────┐
  │   GOOGLE ANTIGRAVITY   │ │    CLAUDE CODE     │ │     OPENAI CODEX      │
  │  Project Exploration   │ │    Engineering     │ │     Verification      │
  │  • Repo architecture   │ │  • Complex logic   │ │  • Code reviews       │
  │  • UI / frontend PWA   │ │  • Backend APIs    │ │  • Bug detection      │
  │  • Feature prototyping │ │  • Security audits │ │  • Regression tests   │
  │  • System discovery    │ │  • Refactoring     │ │  • E2E verification   │
  └────────────────────────┘ └────────────────────┘ └───────────────────────┘
```

*Note: Roles are defaults, not rigid silos. Agents may assist across areas when helpful.*

---

## 4. Branch and Git Coordination Protocol

To prevent collision, race conditions, or uncommitted work loss:

1. **Branch Naming Standard:**
   - Antigravity: `agent/antigravity/<feature-or-fix-description>`
   - Claude Code: `agent/claude/<feature-or-fix-description>`
   - OpenAI Codex: `agent/codex/<feature-or-fix-description>`
2. **Isolation:** Never switch to or edit another active agent's branch without coordination.
3. **Commit Standards:** Write atomic, descriptive conventional commits (e.g., `feat:`, `fix:`, `test:`, `docs:`, `security:`).
4. **Pull Requests:** Submit pull requests against `main`. Do not auto-merge. Ensure all GitHub CI jobs pass before review.
5. **No Force Pushing:** Never force push to `main` or any shared branch.

---

## 5. Security and Permission Tiers

Every operation is classified into one of three security tiers:

| Tier | Permitted Operations | Authorization Required |
|---|---|---|
| **Tier 1: READ** | Read repository, inspect database schema/tables, inspect Render services and logs, analyze configuration. | Default (Always Allowed) |
| **Tier 2: DEVELOPMENT WRITE** | Edit local files, create branches, run unit/integration tests, draft migrations, prepare PRs. | Permitted within agent workspace |
| **Tier 3: PRODUCTION ADMINISTRATION** | Trigger production deployments, alter production environment variables, apply production migrations, execute destructive SQL, delete services. | **EXPLICIT HUMAN AUTHORIZATION REQUIRED** |

---

## 6. Model Context Protocol (MCP) Configuration

All three environments are configured with official MCP servers:

- **GitHub MCP:** `@modelcontextprotocol/server-github` via stdio. Authenticated with scoped personal access token.
- **Supabase MCP:** `https://mcp.supabase.com/mcp` (Streamable HTTP) or `@supabase/mcp-server-supabase`. Used for schema inspection, query planning, and migration review.
- **Render MCP:** `https://mcp.render.com/mcp` (Streamable HTTP). Scoped to `ULTRON CORE` workspace. Bearer token authenticated via `RENDER_API_KEY`.

---

## 7. Verification and Testing Commands

Before proposing changes, verify locally:

```bash
# 1. Syntax and static verification (all modules)
npm run check

# 2. Server and capability test suite
node --test test/server.test.js
node --test tests/server-health.test.js tests/runtime-readiness.test.js tests/network-safety.test.js

# 3. Full test suite (when applicable)
npm test

# 4. Read-only Supabase Auth diagnostic (safe, no writes)
npm run diagnose:auth
```

---

## 8. Shared Memory Files

All agents must maintain and consult these repository memory files:

- [`AGENTS.md`](file:///C:/Users/Ali%20Raza%20Zaidi/.gemini/antigravity/scratch/ULTRON-AI/AGENTS.md): Master multi-agent protocol and rules (this file).
- [`CLAUDE.md`](file:///C:/Users/Ali%20Raza%20Zaidi/.gemini/antigravity/scratch/ULTRON-AI/CLAUDE.md): Claude Code specific instructions and architecture context.
- [`ULTRON_ARCHITECTURE.md`](file:///C:/Users/Ali%20Raza%20Zaidi/.gemini/antigravity/scratch/ULTRON-AI/ULTRON_ARCHITECTURE.md): Complete technical blueprint and boundaries.
- [`DEVELOPMENT_GUIDE.md`](file:///C:/Users/Ali%20Raza%20Zaidi/.gemini/antigravity/scratch/ULTRON-AI/DEVELOPMENT_GUIDE.md): Developer setup, workflows, and standards.
- [`INTEGRATION_GUIDE.md`](file:///C:/Users/Ali%20Raza%20Zaidi/.gemini/antigravity/scratch/ULTRON-AI/INTEGRATION_GUIDE.md): GitHub, Supabase, and Render MCP integration guide.
- [`SECURITY_POLICY.md`](file:///C:/Users/Ali%20Raza%20Zaidi/.gemini/antigravity/scratch/ULTRON-AI/SECURITY_POLICY.md): Detailed 3-tier permissions and credential policies.
- [`TESTING_GUIDE.md`](file:///C:/Users/Ali%20Raza%20Zaidi/.gemini/antigravity/scratch/ULTRON-AI/TESTING_GUIDE.md): Testing philosophy, test runner usage, and smoke guides.
- [`PROJECT_STATUS.md`](file:///C:/Users/Ali%20Raza%20Zaidi/.gemini/antigravity/scratch/ULTRON-AI/PROJECT_STATUS.md): Current live checkpoint, verified revisions, and blockers.
- [`CHANGELOG.md`](file:///C:/Users/Ali%20Raza%20Zaidi/.gemini/antigravity/scratch/ULTRON-AI/CHANGELOG.md): History of revisions, changes, and upgrades.
- [`TASK_TRACKER.md`](file:///C:/Users/Ali%20Raza%20Zaidi/.gemini/antigravity/scratch/ULTRON-AI/TASK_TRACKER.md): Live task status and multi-agent coordination board.
