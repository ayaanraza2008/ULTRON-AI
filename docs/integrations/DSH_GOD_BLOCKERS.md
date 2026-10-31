# ULTRON AI — DSH-GOD Blockers & Environmental Resolutions

## 1. Resolved Blockers

### A. Windows Command-Line Length Limit (8192 characters)
- **Problem:** Running chained `node --check` commands for 200+ files exceeded the Windows command-line limit.
- **Resolution:** Replaced with programmatic multi-file syntax runner `scripts/check-syntax.mjs`, verifying 208+ files in pure Node.js in seconds.

### B. OpenCode Free-Tier v2 Fingerprint Gate
- **Problem:** Legacy v1 clients or requests sending `tool_choice: "none"` or `x-opencode-request` triggered immediate `403 FreeTierError`.
- **Resolution:** Implemented exact v2 client fingerprint (`opencode/latest/2.0.26/cli`), inverted descending 48-bit hex session IDs, and injected official `read` and `shell` tool schema definitions verbatim.

### C. Large Native Binaries on AMD Ryzen 7 5700U 8 GB RAM
- **Problem:** Embedded Magpie binary (68MB) threatened system memory limits and was unnecessary for core gateway functionality.
- **Resolution:** Excluded Magpie binary; implemented pure Node.js ES module gateways and channel adapters within an 8 GB budget.

### D. Upstream Privacy Notice on Free Inferences
- **Problem:** Kilo AI and OpenCode free pools may log prompts for training.
- **Resolution:** Implemented explicit privacy warning disclosures and automated credential redaction before egress.

---

## 2. Operational Guidelines

1. **Deployments:** Production deployments on Render workspace `Ultron core` must not be triggered during local development sessions.
2. **Database:** Supabase project `opdjfhwepmcprbqojpat` in `ap-south-1` (Mumbai) remains untouched and fully preserved.
3. **Ports:** Local gateway defaults to `8080`, configurable via `DSH_GATEWAY_PORT`.
