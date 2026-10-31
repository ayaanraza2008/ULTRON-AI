# ULTRON AI — Security Policy & Permission Matrix

> **Authoritative Security Architecture and Operational Safeguards**  
> Applicable to: **Google Antigravity** | **Claude Code** | **OpenAI Codex** | **All Contributors**

---

## 1. Permission Tiers & Authorization Hierarchy

To maintain complete stability and protect production infrastructure, all operations are classified into three strict permission tiers:

### Tier 1: READ (Autonomous Access)
*Operations permitted to all authenticated agents without human confirmation:*
- Read repository files, branch structure, and commit history.
- Inspect database schemas, table definitions, foreign keys, and indexes.
- Inspect service status, deployment records, build metadata, and public health endpoints.
- Read sanitized application and build logs.
- Analyze configuration templates (`.env.example`, `render.yaml`).

### Tier 2: DEVELOPMENT WRITE (Autonomous Workspace Access)
*Operations permitted within isolated agent branches and local workspaces:*
- Modify local source files in an isolated development branch.
- Create, checkout, and switch between feature/fix branches.
- Execute automated unit, integration, and syntax check suites.
- Author additive SQL migration files in `supabase/migrations/`.
- Stage commits and create pull requests targeting `main`.

### Tier 3: PRODUCTION ADMINISTRATION (Explicit Authorization Required)
*Operations strictly forbidden unless explicit written confirmation is provided by the owner:*
- Merging pull requests into `main`.
- Triggering production service redeployments on Render.
- Modifying production environment variables or secrets.
- Applying schema migrations to the live production database.
- Executing destructive SQL (`DROP TABLE`, `TRUNCATE`, bulk deletions).
- Deleting or stopping Render services.
- Modifying DNS records, domain routing, or TLS configuration.

---

## 2. Secrets Management & Credential Isolation

1. **Zero Hardcoded Secrets:**
   - No API keys, database passwords, session secrets, or private tokens may ever appear in source code, committed files, pull request descriptions, or agent prompts.
   - Credentials must be supplied exclusively through host environment variables or secure secret managers.
2. **Key Tiering & Separation:**
   - **Client/Public Tier:** `SUPABASE_PUBLISHABLE_KEY` (or legacy anon key) — public, bound by RLS.
   - **Server Tier:** `SUPABASE_SERVICE_ROLE_KEY`, `OPENROUTER_API_KEY`, `SESSION_SECRET` — server-only, never sent to clients.
   - **Management Tier:** `RENDER_API_KEY`, GitHub PAT — engineer-scoped for MCP tooling only.
3. **Log & Error Redaction:**
   - All HTTP error handlers must sanitize error objects to strip authorization headers, request bodies containing sensitive fields, and connection strings before emitting logs.

---

## 3. Network & Transport Safety (`network-safety.js`)

ULTRON AI enforces strict outbound network isolation via DNS resolution pinning:

- **SSRF Defense:** Prevents requests from accessing private IP subnets (RFC 1918 `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), AWS/GCP cloud metadata endpoints (`169.254.169.254`), loopback addresses (`127.0.0.0/8`, `::1`), and link-local ranges.
- **DNS-Rebinding Defense:** Outbound URLs are resolved, validated against the IP allowlist, and the validated IP is pinned directly to the socket connection.
- **Redirect Restrictions:** Outbound HTTP client blocks automatic redirects to untrusted destinations.
- **Response Size & Timeout Bounds:** Every outbound request enforces bounded streaming byte caps and request timeouts to prevent memory exhaustion (DoS).

---

## 4. Row Level Security & Multi-Tenant Isolation

- Every public table in Supabase project `opdjfhwepmcprbqojpat` must have Row Level Security enabled (`alter table <table> enable row level security;`).
- All queries must verify user ownership using `auth.uid() = user_id`.
- Never disable RLS, drop policies, or bypass security rules to resolve test failures.
- Anonymous SELECT, INSERT, UPDATE, and DELETE privileges are explicitly revoked from all public tables.

---

## 5. Autonomous Action Risk Classification (`autonomy-policy.js`)

Autonomous tasks executed by the agent runtime or background worker are evaluated against the autonomy policy:

| Action Category | Classification | Policy |
|---|---|---|
| Document Parsing / Summarization | Low Risk | Autonomous Execution Allowed |
| Data Formatting / Schema Read | Low Risk | Autonomous Execution Allowed |
| External Web Research (Tavily) | Low Risk | Autonomous Execution Allowed |
| Code Execution in Sandbox | Medium Risk | Allowed only in isolated, non-networked container |
| Email / Outbound Communications | High Risk | **Confirmation Gate Required** |
| File System Deletion / Modification | High Risk | **Confirmation Gate Required** |
| Infrastructure Deployment | Critical Risk | **Confirmation Gate Required** |

---

## 6. Incident Response & Emergency Halt

If an agent or integration behaves unexpectedly or attempts unauthorized changes:
1. Immediately kill active background tasks using the task management tool or terminal.
2. Revert any unverified Git commits using `git reset` or `git revert`.
3. Check Render audit logs and Supabase access logs.
4. Notify the repository owner immediately.
