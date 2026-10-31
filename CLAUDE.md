# CLAUDE.md — Claude Code Engineering Guidelines

> **Project:** ULTRON AI (`ayaanraza2008/ULTRON-AI`)  
> **Role:** Engineering Agent (Complex Implementation, Backend APIs, Security Auditing, Refactoring)  
> **Ecosystem:** GitHub × Supabase (`opdjfhwepmcprbqojpat`) × Render (`ULTRON CORE`)

---

## 1. System Architecture & Context

ULTRON AI is an API-first assistant runtime designed for resilient multi-provider intelligence, durable persistence, and safe autonomous task execution.

- **Backend Runtime:** Node.js (v20+ ES Modules), Express, native `node:test` runner.
- **Hosted API:** `https://ultron-ai-core.onrender.com` (Render service in `ULTRON CORE` workspace).
- **Frontend Interface:** Dedicated PWA shell hosted at `https://ultron-core-interface.onrender.com` (branch `feature/ultron-live-core-interface-20261029`). The core backend does **not** serve static UI at root.
- **Database:** Supabase project `ULTRON-AI` in Mumbai (`ap-south-1`), project ref `opdjfhwepmcprbqojpat`.
- **Primary AI Provider:** OpenRouter API (`https://openrouter.ai/api/v1`) using `openrouter/free` models with automatic fallback.
- **Worker System:** Background worker (`worker.js`) executing allowlisted research, AI Employee drafting, and report generation with explicit permission gates.
- **Security Guardrails:** DNS-pinned HTTP transport (`network-safety.js`), strict Row Level Security (RLS) on all tables, and zero credential leakage.

---

## 2. Core Code Modules

- [`server.js`](file:///C:/Users/Ali%20Raza%20Zaidi/.gemini/antigravity/scratch/ULTRON-AI/server.js): Main HTTP API dispatcher, route definitions, authentication middleware, error handling, health checks.
- [`agent-runtime.js`](file:///C:/Users/Ali%20Raza%20Zaidi/.gemini/antigravity/scratch/ULTRON-AI/agent-runtime.js): Autonomous agent execution engine, tool invocation loops, context management, memory injection.
- [`worker.js`](file:///C:/Users/Ali%20Raza%20Zaidi/.gemini/antigravity/scratch/ULTRON-AI/worker.js): Polled asynchronous task worker handling queued background jobs with exponential backoff.
- [`network-safety.js`](file:///C:/Users/Ali%20Raza%20Zaidi/.gemini/antigravity/scratch/ULTRON-AI/network-safety.js): DNS-rebinding protection, IP-pinned fetch, SSRF defenses, URL sanitization.
- [`autonomy-policy.js`](file:///C:/Users/Ali%20Raza%20Zaidi/.gemini/antigravity/scratch/ULTRON-AI/autonomy-policy.js): Classification and gating for autonomous vs. confirmation-required actions.
- [`features.js`](file:///C:/Users/Ali%20Raza%20Zaidi/.gemini/antigravity/scratch/ULTRON-AI/features.js): Capability flags, provider fallbacks, model routing registry.
- [`employee-catalog.js`](file:///C:/Users/Ali%20Raza%20Zaidi/.gemini/antigravity/scratch/ULTRON-AI/employee-catalog.js): Role definitions for specialized AI Employees (e.g. Researcher, Data Analyst, Drafter).
- [`cognitive-memory.js`](file:///C:/Users/Ali%20Raza%20Zaidi/.gemini/antigravity/scratch/ULTRON-AI/cognitive-memory.js): Memory recall, document provenance, conversation summary handling.
- [`render.yaml`](file:///C:/Users/Ali%20Raza%20Zaidi/.gemini/antigravity/scratch/ULTRON-AI/render.yaml): Render Blueprint declaration for all services in `ULTRON CORE`.

---

## 3. Database & Supabase Schema

All tables enforce Row Level Security (RLS) and restrict access to `auth.uid() = user_id`:

- `conversations`: User chat sessions with archived timestamp.
- `messages`: Message history (system, user, assistant, tool) linked to conversations.
- `user_preferences`: Language, voice, memory toggles, custom settings per user.
- `memory_items`: User-approved knowledge vault (`preference`, `project_fact`, `profile_note`, `document_reference`).
- `agent_tasks`: Queued/running/completed/blocked background task queue with input/result payloads.
- `audit_events`: Security and action audit ledger for all sensitive operations.
- `documents`: Binary document metadata linked to private storage bucket `ultron-private-documents` (5 MiB limit, UUID paths).

---

## 4. Claude Code Development Commands

When working with Claude Code in this repository:

```bash
# Verify syntax and lint across the entire project
npm run check

# Run targeted core tests
node --test test/server.test.js

# Run health, readiness, and security tests
node --test tests/server-health.test.js tests/runtime-readiness.test.js tests/network-safety.test.js

# Run auth diagnostics against Supabase (read-only)
npm run diagnose:auth
```

---

## 5. Engineering Standards & Acceptance Criteria

1. **Test-First Methodology:** Every bug fix or feature addition must include a deterministic unit test.
2. **Never Mock as Proof of Live Connection:** Clearly state when tests use mocks versus real live infrastructure.
3. **No Unsafe Dependencies:** ULTRON uses lightweight, secure dependencies. Keep external packages to a minimum.
4. **Isolated Branching:** Always create a dedicated branch before editing:
   ```bash
   git checkout -b agent/claude/<feature-or-fix-description>
   ```
5. **No Force Pushing & No Auto-Deploying:** Do not push directly to `main`. Create PRs for review.
6. **Environment Secrets:** Never output, log, or commit secret keys.

---

## 6. MCP Server Connectivity for Claude Code

Claude Code connects to the ecosystem via `.mcp.json` or CLI configuration:

- **GitHub:** `claude mcp add github -- cmd.exe /c npx -y @modelcontextprotocol/server-github`
- **Supabase:** `claude mcp add --transport http supabase https://mcp.supabase.com/mcp`
- **Render:** `claude mcp add --transport http render https://mcp.render.com/mcp -H "Authorization: Bearer <RENDER_API_KEY>"`

Inspect active servers with:
```bash
claude mcp list
```
