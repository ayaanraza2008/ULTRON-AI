# ULTRON AI — Developer Workflow & Engineering Guide

> **Standard Operating Procedures for Human Developers and Autonomous Agents**  
> Authorized Environments: **Google Antigravity** | **Claude Code** | **OpenAI Codex**

---

## 1. Prerequisites and Local Setup

Ensure the following tools are installed on your machine:
- **Node.js:** v20.0.0 or later (v24.20.0 recommended)
- **npm:** v10.0.0 or later
- **Git:** v2.40.0 or later
- **GitHub CLI (`gh`):** v2.50.0 or later (authenticated via `gh auth login`)
- **Python (Optional for Model Lab & Harness2):** v3.12+

### Clone & Installation:
```bash
git clone https://github.com/ayaanraza2008/ULTRON-AI.git
cd ULTRON-AI
npm install
```

---

## 2. Environment Variables & Secret Safety

Copy the example configuration to initialize local development:
```bash
cp .env.example .env
```

### Critical Rules:
1. **Never commit `.env`:** The `.env` file is git-ignored. Verify with `git status` that `.env` is never staged.
2. **Never expose keys in logs or errors:** Wrap external API calls in try/catch blocks that sanitize error payloads before logging.
3. **Use Scoped Permissions:** For local testing, prefer the public publishable key (`SUPABASE_PUBLISHABLE_KEY`) over the service-role key whenever testing client-facing flows.

---

## 3. Running Services Locally

### Development Server:
```bash
# Starts server with automatic reload on changes
npm run dev
# Server listens on http://localhost:10000 (or PORT env var)
```

### Background Task Worker:
```bash
# Starts the task queue processor in a separate terminal
npm run worker
```

### Health Check:
```bash
curl http://localhost:10000/api/health
```

---

## 4. Multi-Agent Branching & Git Workflow

All three AI agents and human contributors must follow branch isolation:

```
main (Protected)
 ├── agent/antigravity/ui-prototype-20261031 (PR -> main)
 ├── agent/claude/refactor-auth-middleware-20261031 (PR -> main)
 └── agent/codex/verify-worker-regression-20261031 (PR -> main)
```

### Step-by-Step Workflow:
1. **Sync with Main:**
   ```bash
   git checkout main
   git pull origin main
   ```
2. **Create Agent Feature Branch:**
   ```bash
   # Pattern: agent/<agent-name>/<task-slug>
   git checkout -b agent/antigravity/new-capability-flow
   ```
3. **Make Atomic Changes:** Keep commits focused, logically structured, and scoped.
4. **Run Verification:**
   ```bash
   npm run check
   npm test
   ```
5. **Push and Create PR:**
   ```bash
   git push origin agent/antigravity/new-capability-flow
   gh pr create --title "feat: descriptive title" --body "Detailed explanation of changes and test evidence."
   ```

---

## 5. Coding Standards & Conventions

- **Module Format:** ES Modules exclusively (`import` / `export`). Use `.js` or `.mjs` extensions.
- **Strict Error Handling:** Fail closed on unhandled edge cases; never return raw stack traces or internal configuration to clients.
- **Input Validation:** Validate all parameters (types, string lengths, ranges, regex) before processing.
- **Zero-Dependency Core:** Avoid adding heavy third-party packages when standard Node.js libraries (`node:crypto`, `node:dns`, `node:test`, `node:stream`) suffice.
- **URL & Network Hygiene:** Use `safePinnedFetch` from `network-safety.js` for all outbound HTTP calls to protect against SSRF.

---

## 6. Pull Request Review & Merge Protocol

1. **Automated CI Check:** Every PR automatically triggers:
   - `check`: syntax and compilation verification.
   - `test`: full suite of unit and integration tests.
   - `world-intelligence-build`: pinned 3D geospatial bridge compilation.
2. **Branch Protection:**
   - No direct pushes to `main`.
   - No force pushes (`--force` or `-f`).
   - All CI checks must be green before merge.
3. **Deployment Safety:** Merging into `main` may trigger Render auto-deployments. Never merge unverified or incomplete code into `main`.
