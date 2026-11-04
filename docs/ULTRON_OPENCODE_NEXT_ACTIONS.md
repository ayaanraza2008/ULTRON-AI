# ULTRON OPENCODE NEXT ACTIONS

## Immediate (safe, no approval needed)
1. Commit the verified session fixes on the current branch (or a new `agent/claude/...` branch) with conventional commit messages.
2. Re-run `npm run check`, `npm run security:secrets`, `npm run security:sast`.
3. Run targeted test files: adversarial-autonomy-hardening, computer-device, windows-command-security, windows-automation.
4. Update `AGENTS.md` to register OpenCode as a supported engineering environment (done in this session if applied).
5. Exercise MCP servers (GitHub/Supabase/Render) from OpenCode and record results in the connection matrix.

## Owner-gated (require explicit authorization)
6. Merge PR #441 (`feat/ultron-final-100-completion`) to `main` after final review.
7. Apply Supabase migration `20261101180000_durable_paired_devices.sql`.
8. Enable Supabase Leaked Password Protection.
9. Configure Render env vars for AI providers and sync blueprint.
10. Deploy (only on explicit `DEPLOY` instruction).

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