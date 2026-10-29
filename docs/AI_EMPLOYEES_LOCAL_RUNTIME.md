# ULTRON AI Employees — local runtime

ULTRON already has a cloud-side catalog and plan-only worker for the eight AI Employee roles. This local runtime closes a separate gap: it installs the upstream employee kits into a user-owned folder on your PC, makes one role easy to enable at a time, aggregates local briefs, and provides a consistent routine-template command.

The full employee instructions and routine files are supplied by the upstream MIT package when you explicitly run `hire`. ULTRON does not copy the upstream source into the backend bundle, start browser automation at server boot, or require a new paid service. The upstream installer is pinned to `ai-employees@1.9.0` for repeatability. Review its release/license before intentionally upgrading the pin.

## Requirements

- Node.js 20 or newer (matches the ULTRON repository requirement).
- npm/npx on PATH.
- One installed and signed-in agent harness, such as Claude Code, Codex, OpenClaw, Hermes or OpenCode.
- For routines that read an account, log into the account yourself in a browser profile the selected harness can access. The employee does not take or store passwords.
- A local folder outside OneDrive, Dropbox, Google Drive and iCloud. The default is `~/ULTRON-AI-Employees`.

No OpenRouter or Supabase credential is needed to install employee files. A provider is needed only if the selected coding agent uses one for its own AI requests. The local role kits do their work on the local machine, with that agent.

## Commands

From the ULTRON-AI repository:

```bash
# See roles and current local installs without downloading anything
npm run employees -- list

# Check which common agent commands are discoverable on PATH
npm run employees -- doctor

# Install exactly one role (download occurs only on this explicit command)
npm run employees -- hire chief-of-staff

# Install all missing role kits sequentially in one pass
npm run employees -- hire-all

# Use a different local workspace, such as D:\\AgentOps
npm run employees -- hire sales --root "D:\\AgentOps"

# Inspect installed roles and build an aggregate local brief
npm run employees -- status
npm run employees -- brief

# Create a template for one additional routine within an installed role
npm run employees -- new-routine sales sales-lead-quality-review

# Run the focused local unit tests
npm run test:employees
```

Available ULTRON role IDs:

| Role ID | Owns | Routine slots |
|---|---|---:|
| `gtm-engineer` | Launch, positioning, growth signals and outbound drafts | 8 |
| `seo-aeo` | SEO/AEO, keywords, content and answer visibility | 8 |
| `web-dev` | Site health and reviewable engineering changes | 8 |
| `social-media` | Social research, post drafts and reply drafts | 7 |
| `ad-manager` | Ad account reads, creative plans and guarded change proposals | 7 |
| `sales` | Prospect research and follow-up drafts | 7 |
| `customer-satisfaction` | Support triage, response drafts and churn signals | 8 |
| `chief-of-staff` | Fleet review, blockers and morning brief | 7 |
| **Total** | | **60** |

## Finish hiring a role

The `hire` command copies one complete upstream kit and runs the upstream installer's self-tests. `hire-all` sequentially installs every missing kit, skips recognized installations, reports folders it cannot safely adopt, and continues after an individual role fails. Both commands add `.ultron-employee.json` and `ULTRON-INTEGRATION.md`; they do not overwrite the upstream's own files or pre-existing unrecognized role folders.

The installation is **not yet scheduled** after the copy. That deliberate separation avoids silently registering 7–8 jobs before you have reviewed a role or confirmed the machine/account access. To enable it:

1. Open the installed role folder in your selected agent (the path is printed by `hire`).
2. Ask the agent: `Install the <role name> from this folder. Read INSTALL-PROMPT.md and follow it. Keep all files local and preserve the shipped guardrails.`
3. Read the generated strategy and first drafts; correct any assumptions about your business.
4. Follow the kit's `docs/HARNESSES.md` and `CAPABILITIES.md` for the scheduler and browser route specific to the actual harness. Verify a schedule exists rather than assuming it was registered.
5. Test one read-only/file-only routine, then check its run log, evidence and output paths before leaving recurring jobs enabled.

The upstream project documents Claude Code CLI/Desktop, OpenClaw, Hermes, OpenCode, Codex, Antigravity, Pi, Cline, Qwen Code, DeepSeek, Muse and Dots. Actual browser and scheduler support varies by harness/version and permissions; `doctor` checks only whether command-line executables can be found, not login/browser/scheduler readiness. Follow the upstream's current [harness matrix](https://github.com/markfulton/ai-employees/blob/main/docs/HARNESSES.md), rather than treating a name in the matrix as proof this PC is configured.

## Morning brief and persistent files

`npm run employees -- brief` reads only standard brief files from locally installed kits and writes `briefs/morning-brief-YYYY-MM-DD.md` inside the workspace. It does not upload those files or call an LLM. The Chief of Staff's own routine is responsible for the richer business brief once it has been installed and its schedule verified.

Every output remains in the local role folders unless you deliberately export it. The `.ultron-employee.json` manifest is for the ULTRON wrapper's own status/brief commands; it contains no secret values.

## Add a routine safely

1. Run `npm run employees -- new-routine <role-id> <role-prefix>-<routine-name>`.
2. Edit `routines/<id>/SKILL.md` to define one measurable outcome, inputs, exact steps, output path, evidence requirements, failure behavior and approval gate.
3. Read `REGISTER-ROUTINE.md` created next to it. Add a valid row to the role's `SCHEDULE.md` (days, local fire time, execution window, deduplication key, budget and browser lane).
4. Update `CAPABILITIES.md` only for capabilities supported and verified on your installed harness. Keep browser sessions user-signed-in; never enter credentials or bypass logins.
5. Run the routine manually in review-only mode, inspect the logs and prove reruns are idempotent, then register the job in your chosen harness/OS scheduler.
6. Keep sends, posts, submissions, publishing, production changes and spending held for owner approval unless you explicitly release a narrow channel in `RELEASES.md`.

The template intentionally does not edit `SCHEDULE.md` or register a job automatically: a malformed row or untested job can otherwise repeat work indefinitely.

## How this relates to ULTRON's hosted worker

The current server-side `/api/employees/schedules` and hosted worker remain plan/draft/review/report workflows, not local PC automation. The local kits are the path for user-owned files, local schedules and harness-driven browser routines. Do not configure the same recurring routine in both places unless you intentionally want duplicate draft generation. The local runtime is independent of Render and does not deploy or change production environment variables.

## Safety and failure behavior

- Installation writes only to the chosen local workspace and refuses cloud-sync paths or an already-existing role folder.
- The installer is pinned to an explicit package version and is invoked only by the `hire` command.
- Browser actions inherit the selected harness's permission model; this wrapper itself does not drive the browser.
- Account creation, passwords, CAPTCHAs, terms acceptance, external sends, final form submissions, publishing, deployments and ad spend remain off limits or approval-gated.
- A missing brief means only that no supported brief file was found; it is not reported as a successful run.
- A scheduled job is not proof that it ran. Inspect the upstream run log and output evidence for each result.

## Upstream and license

This integration uses the upstream project's npm package rather than duplicating its kit source here:

- Repository: https://github.com/markfulton/ai-employees
- Version pinned here: `ai-employees@1.9.0`
- License: MIT (upstream copyright/license files are installed with each role kit)

This wrapper is original ULTRON integration code. The upstream project's names and logos remain subject to its trademark notice; do not represent ULTRON as the upstream project.
