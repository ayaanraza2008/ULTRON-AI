# CLAUDE.md — Claude Code Engineering Guidelines
## PROJECT CODENAME: ULTRON ETERNAL
### ONE BRAIN • COMPLETE AUTONOMY • CONTINUOUS EVOLUTION • 101% ACCOUNTABILITY

> **Permanent Single Source of Truth:** Read [`ULTRON_MASTER_CHARTER.md`](file:///C:/Users/Ali%20Raza%20Zaidi/.gemini/antigravity/scratch/ULTRON-AI/ULTRON_MASTER_CHARTER.md) and [`ULTRON_CHECKPOINT.md`](file:///C:/Users/Ali%20Raza%20Zaidi/.gemini/antigravity/scratch/ULTRON-AI/ULTRON_CHECKPOINT.md).  
> **Project:** ULTRON AI (`ayaanraza2008/ULTRON-AI`)  
> **Render Destination:** Workspace **`Ultron core`** (`https://ultron-ai-core.onrender.com`)  
> **Database:** Supabase project `opdjfhwepmcprbqojpat` (Region: `ap-south-1`, Mumbai)  
> **Host Hardware Profile:** AMD Ryzen 7 5700U (8C/16T), 8 GB RAM, Windows OS, pure CPU execution  
> **Permanent Voice:** Kokoro-82M ONNX `am_onyx` (0.95x speed, 200 Hz chest resonance)  

---

## 1. THE 12 IMMUTABLE LAWS (MANDATORY FOR ALL AGENTS)

1. **Continue From Actual State:** Never assume previous work; inspect `git status` and `ULTRON_CHECKPOINT.md`.
2. **Never Restart From Scratch:** Upgrade the existing repository; never rebuild from zero.
3. **Never Replace Architecture With Demos:** No mock-only replacements or disconnected demos in production code.
4. **Preserve User Data & History:** Never flush databases or wipe user memory without approval.
5. **Reuse Existing Implementations:** Build on top of existing modules (`agent-runtime.js`, `brain-router.js`, `orchestrator.js`, `kokoro-engine.js`, `robot-controller.js`, `connection-controller.js`, etc.).
6. **Strict Project Isolation:** Never touch PHANTOM, NOX, VAULTAR or unrelated projects.
7. **Strict Render Destination:** Never deploy to any workspace other than **`Ultron core`**.
8. **Zero Secret Leakage:** Never commit or hardcode credentials in source code.
9. **No Mock-Only Shortcuts:** Production engines must run real logic.
10. **Maintain Backward Compatibility:** Keep existing API routes and database schemas functional.
11. **Approval for Destructive Actions:** Financial, external messaging, and physical actions require operator authorization.
12. **Verification Before Completion:** Every change requires passing test evidence (`npm test`) and syntax validation (`npm run check`).

---

## 2. MASTER SHORTCUT COMMAND PROTOCOL

When the user gives these shortcut instructions, execute the corresponding protocol:
- **`ULTRON STATUS`**: Run a fresh, 10-section 101% audit of the entire project adhering to Section 6 of the Master Directive.
- **`CONTINUE ULTRON`**: Read `ULTRON_CHECKPOINT.md`, select the next priority task, implement it, test it, and update the checkpoint.
- **`FIX ULTRON`**: Investigate and repair actual errors or failing tests; verify with regression tests.
- **`VERIFY ULTRON`**: Execute a fresh evidence-based audit (`npm run check`, `npm test`, endpoint health).
- **`ULTRON COMPLETE`**: Audit all criteria in `ULTRON_ACCEPTANCE_MATRIX.md` and report verified completion status.

---

## 3. CORE VERIFICATION COMMANDS

```bash
# 1. Full codebase syntax integrity check (153/153 files)
npm run check

# 2. Complete test suite execution (800 tests)
npm test

# 3. Targeted test execution
node --test tests/robotics-hal.test.js
node --test tests/offline-online-modes.test.js
node --test tests/knowledge-vault.test.js
node --test tests/cyber-intel.test.js
node --test tests/geo-intel.test.js
node --test tests/singularity-routes.test.js
```

---

## 4. ARCHITECTURAL REFERENCES

- **Charter & Laws:** [`ULTRON_MASTER_CHARTER.md`](file:///C:/Users/Ali%20Raza%20Zaidi/.gemini/antigravity/scratch/ULTRON-AI/ULTRON_MASTER_CHARTER.md)
- **Capability Registry:** [`ULTRON_CAPABILITY_REGISTRY.md`](file:///C:/Users/Ali%20Raza%20Zaidi/.gemini/antigravity/scratch/ULTRON-AI/ULTRON_CAPABILITY_REGISTRY.md)
- **Acceptance Matrix:** [`ULTRON_ACCEPTANCE_MATRIX.md`](file:///C:/Users/Ali%20Raza%20Zaidi/.gemini/antigravity/scratch/ULTRON-AI/ULTRON_ACCEPTANCE_MATRIX.md)
- **Status Audit:** [`ULTRON_STATUS.md`](file:///C:/Users/Ali%20Raza%20Zaidi/.gemini/antigravity/scratch/ULTRON-AI/ULTRON_STATUS.md)
- **Blockers & Dependencies:** [`ULTRON_BLOCKERS.md`](file:///C:/Users/Ali%20Raza%20Zaidi/.gemini/antigravity/scratch/ULTRON-AI/ULTRON_BLOCKERS.md)
- **Changelog:** [`ULTRON_CHANGELOG.md`](file:///C:/Users/Ali%20Raza%20Zaidi/.gemini/antigravity/scratch/ULTRON-AI/ULTRON_CHANGELOG.md)
- **Resumable Checkpoint:** [`ULTRON_CHECKPOINT.md`](file:///C:/Users/Ali%20Raza%20Zaidi/.gemini/antigravity/scratch/ULTRON-AI/ULTRON_CHECKPOINT.md)
- **System Architecture:** [`ULTRON_ARCHITECTURE.md`](file:///C:/Users/Ali%20Raza%20Zaidi/.gemini/antigravity/scratch/ULTRON-AI/ULTRON_ARCHITECTURE.md)
