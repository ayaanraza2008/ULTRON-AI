# ULTRON OPENCODE NEXT ACTIONS

## Immediate (safe, no approval needed)
1. Commit the verified session fixes on the current branch (or a new `agent/claude/...` branch) with conventional commit messages.
2. Re-run `npm run check`, `npm run security:secrets`, `npm run security:sast`.
3. Run targeted test files: adversarial-autonomy-hardening, computer-device, windows-command-security, windows-automation.
4. Update `AGENTS.md` to register OpenCode as a supported engineering environment (done in this session if applied).
5. Exercise MCP servers (GitHub/Supabase/Render) from OpenCode and record results in the connection matrix.

## Owner-gated (require explicit authorization) — exact actions
6. **PR #441 merge governance**: review candidate branch `feat/ultron-final-100-completion` (head in flux; latest completed CI run `41820731210` failed on `security(windows): block symlink escape`; newer pushes in progress). Resolve CI failure, then merge to `main`. Command: `gh pr merge 441 --squash` (only after green CI + owner approval).
7. **Supabase migration**: open Supabase Dashboard → SQL Editor → paste `supabase/migrations/20261101180000_durable_paired_devices.sql` → Run. Verify rollback script first. No production data reset.
8. **Leaked Password Protection**: Supabase Dashboard → Authentication → Attack Protection → enable "Leaked Password Protection".
9. **Render env vars**: Render Dashboard → workspace "Ultron core" → service `ultron-ai-core` → Environment → add `OPENROUTER_API_KEY` (and optionally `GROQ_API_KEY`, `GEMINI_API_KEY`) → Save. Then sync blueprint (`render.yaml`).
10. **Deploy**: only on explicit owner instruction `DEPLOY`. No auto-deploy.

## Integration work
11. Decide whether to integrate PR #442 (frontend removal) and #443 (eternal integration).
12. Configure at least one AI provider (OpenRouter recommended) for live inference testing.
13. Configure Supabase publishable key locally and run `npm run diagnose:auth`.
14. Run worker smoke test (`npm run smoke:worker`) once service-role key is available.
15. Verify mobile MCP software paths (already CI-verified; physical device out of scope).

## Environment
16. Install ADB only if physical device testing is desired (software scope excludes it).
17. Do not auto-download large models or CUDA tooling (resource policy).
18. Keep Render usage limited to the "Ultron core" workspace.