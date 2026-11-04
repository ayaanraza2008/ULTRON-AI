# ULTRON Security & Trust Report (JARVIS mission)

- **Authoring HEAD:** `f70bd483` · **Date:** 2026-11-04

## Trust enforcement points (all test-backed, green today)

| Control | Implementation | Evidence |
|---|---|---|
| Least privilege per agent | `agents/catalog.js` `allowedTools` per role | agent matrix tests |
| Autonomy risk levels 0–5 | `autonomy-policy.js` (0 read-only … 5 continuous/proactive) | `autonomy-levels.test.js` |
| Destructive command gate | `system/computer-control.js` refuses irreversible commands without explicit confirmation | windows-control tests |
| Secret scanning | tightened GitHub-PAT regex + curated fixture allowlist (`1dc6385d`); zero findings in CI today | `security-secrets` tests, CI green |
| SSRF guard | unconditional cloud-metadata/RFC1918/0.0.0.0 blocks; production-forced loopback lockdown; URL/fragment rejection in providers | browser + provider tests |
| Prompt injection containment | untrusted web/document/tool content treated untrusted (`intelligence/content-provenance.js`); research workflow drafts reports when live providers fail instead of improvising claims | suite ✔ |
| Device trust | pairing lifecycle, per-device tokens, `DEVICE_ID_MISMATCH`, owner scoping | device routes tests; live device gates above |
| Approval tokens | single-use + anti-replay + cross-user denial; **live-verified on real device today** | device workflow run |
| Truth-tier | browser drivers `REAL_CDP`/`HTTP_FETCH_PREVIEW`/`simulated:true`; **new:** agent-lane outputs labeled `ORCHESTRATOR_TEST_DOUBLE` with `evidence: null` (`6ab5746e`); no fabricated booleans/percentages remain in that path | regressions added to agent tests |
| Quiet-hours + urgent bypass | owner-controlled policy; explicit 409 deferral, never silent drop (`f70bd483`) | 3/3 new tests incl. live route gate |
| Session/auth | Supabase auth flows, per-IP rate limiting, bounded provider buffering (prior phases) | suite ✔ |

## Findings resolution this session

- **F-1 (high, fixed):** fabricated agent results could make UI/benchmarks over-report. Fixed via truth-tier labeling + test regressions.
- **F-2 (closed):** Proactive notifications lacked quiet hours → implemented with owner-controlled policy.
- **Note (no repo impact):** a working shell command printed a truncated prefix of a host-environment credential; already an invalid internal session token, never written to files/commits.

## Remaining lower-severity risks

1. Windows/Android physical companion security (wake-word hacking surface) unprobed on hardware.
2. Adversarial multi-agent mixed-content tests exist but physical foreign-device red-team (rogue paired device) is untested.
3. Quiet-hours timezone is host-local; multi-timezone owner devices would need a stored policy in Supabase (prepared, not applied).

## Verdict

Security architecture is comprehensively enforced at code level with today's live device evidence for the sensitive-action gates; the remaining gaps are hardware-corner red-teaming, not architectural.
