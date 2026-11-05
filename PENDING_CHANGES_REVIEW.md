# ULTRON PENDING CHANGES REVIEW — Forensic Analysis of the Four Reclassified Files

**Date:** 2026-11-04
**Reviewer:** release engineer / auditor
**Subject:** `core/brain-router.js`, `tests/brain-router.test.js`, `vision/gesture-recognizer.js`, `tests/gesture-recognizer.test.js`

---

## 1. Current forensic state

The prior audit classified these four files as *"modified but uncommitted/unpushed."* That classification is now **stale**. The current live state is:

| Question | Answer |
|---|---|
| Are they modified vs committed HEAD (`e254edb5`)? | **No** — working tree is clean; `git status` reports nothing to commit. |
| Are they committed? | **Yes** — in commit `ed71b07d feat(brain,vision): add bounded token telemetry to BrainRouter and UI gesture taxonomy (fist, thumbs, pointing)`. |
| On which branch? | `feat/ultron-remaining-gaps-completion` (local branch). |
| Is that branch pushed to origin? | **No.** `git ls-remote origin \| Select-String "feat/ultron-remaining-gaps"` returns nothing. |
| Is the PR head affected? | **No.** PR #441 head is `origin/feat/ultron-final-100-completion @ e1dc8846`, which does **not** contain `ed71b07d`. |
| Are the changes preserved? | **Yes**, in local commits `ed71b07d` + `e254edb5`. Nothing was deleted, reset, cleaned, or overwritten. |
| Untracked files relevant? | No — `git ls-files --others --exclude-standard` is empty. |
| Stash relevant? | No — `stash@{0}` is an old stash on `feat/ultron-final-100-completion`, untouched. |

Therefore the correct classification is **NOT "uncommitted/unpushed"** but **"locally committed on an unpushed sibling branch; not in PR #441."**

---

## 2. The four files (commit `ed71b07d` — "feat(brain,vision)")

### A. `core/brain-router.js` (+46/−3) — Classification: `SAFE_AND_USEFUL`
- Adds `captureProviderUsage()` — bounded token accounting from OpenAI-compatible `usage` (`prompt_tokens`, `completion_tokens`), capped at 10M, integer-guarded, refuses negative/invalid values; falls back to a chars/4 *estimate* explicitly labeled `estimated` vs `provider_usage`.
- `recordAttempt()` gains an optional `usage` param (default `null` — fully backward compatible); all existing calls remain valid.
- Health summary exposes `totalPromptTokens`, `totalCompletionTokens`, `tokenUsageSource`.
- This **supports truth-tier** (never presents invented numbers as measured). It does not change provider selection, model routing, timeouts, retries, circuit breaking, streaming, fallback order, or secret handling. NAYA/voice behavior is unaffected.

### B. `tests/brain-router.test.js` (+35) — Classification: `SAFE_AND_USEFUL`
- New tests: provider-reported usage preferred; estimates labeled; invalid usage rejected (negative / `MAX_SAFE_INTEGER`); cumulative totals feed the health summary. No existing assertions weakened. Isolated, deterministic.

### C. `vision/gesture-recognizer.js` (+47/−4) — Classification: `SAFE_AND_USEFUL`
- Adds gesture types `CLOSED_FIST`, `THUMBS_UP`, `THUMBS_DOWN`, `POINTING`.
- Reworks finger/thumb extension logic to require tip protrusion beyond the pip joint (prevents open-palm false positives from curled fingers near the wrist).
- Only adds UI-scoped gesture labels; **no destructive action pathway** is introduced. Its test explicitly asserts no `DELETE` / `EXECUTE_COMMAND` / `SEND_PAYMENT` class exists. Camera privacy unchanged (classification over MediaPipe landmarks; no background capture added).

### D. `tests/gesture-recognizer.test.js` (+59) — Classification: `SAFE_AND_USEFUL`
- New taxonomy tests (fist, thumbs up/down, pointing) with landmark fixtures; threshold + harmful-class assertions. Isolated.

---

## 3. Recommendation

**Nothing in `ed71b07d` is unsafe, breaking, duplicate, or incomplete.** All four files are `SAFE_AND_USEFUL`.

Recommended handling (requires owner approval — never inject into PR #441 unilaterally):
1. **Separate reviewed PR:** Create a dedicated branch off `main` (or off the PR head), cherry-pick `ed71b07d`, and submit as its own reviewed PR with CI. This keeps PR #441's certified head clean and gives the brain/vision changes independent review.
2. Do **not** push `feat/ultron-remaining-gaps-completion` directly and do **not** amend PR #441's head to include these commits.
3. The changes are currently safe and preserved locally; no action is needed unless the owner wants them merged.

**Preservation confirmation:** All four files and their content are preserved in `ed71b07d` on branch `feat/ultron-remaining-gaps-completion`. No `git reset --hard`, no `git clean -fd`, no force-push, no history rewrite, and no branch deletion were performed.
