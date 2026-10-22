# AI Employees-inspired integration

ULTRON now has a native role/routine planning layer inspired by [markfulton/ai-employees](https://github.com/markfulton/ai-employees), an MIT-licensed project describing eight business roles and 60 scheduled routine slots. This implementation does not copy upstream kit files or claim the upstream scheduler is installed.

## API

- `GET /api/employees/roles` — returns the eight role definitions, their intended scope, routine-slot counts, capability labels, and explicit scheduler/execution status.
- `GET /api/employees/routines` — returns routine templates; optionally filter with `?role=web-dev` or another role ID.
- `POST /api/employees/plan` — authenticated, model-backed plan/draft/review/report generation using the configured OpenRouter model. Body: `{ "role": "gtm-engineer", "mode": "plan", "goal": "...", "context": "..." }`. `role` and `goal` are required; `context` is optional and bounded.

Available role IDs: `gtm-engineer`, `seo-aeo`, `web-dev`, `social-media`, `ad-manager`, `sales`, `customer-satisfaction`, `chief-of-staff`.

## Safety and status

- These endpoints only return a role catalog or AI-generated text. They do not register schedules, create background jobs, control the PC, execute shell commands, contact prospects, send messages, publish posts, submit forms, or spend money.
- The planner labels generated content as unexecuted and requires human approval for consequential external actions.
- The role routine counts mirror the upstream README's eight-role summary (8, 8, 8, 7, 7, 7, 8, 7 = 60); the compact native routine templates here are not a claim that all 60 upstream routines have been installed.
- Real scheduled execution would need a persistent scheduler/worker, per-role durable run logs, task claiming/idempotency, a permissions model, and approval UI. Do not claim scheduled AI employees are running until those pieces are built and verified.
- Provider configuration presence is not proof of live model connectivity. The planner requires `OPENROUTER_API_KEY`; it uses `OPENROUTER_DEFAULT_MODEL` or `openrouter/free`.

## Verify

Run `npm run check` and `npm test`. The tests mock the model provider and verify the API's guardrails; they do not prove live provider connectivity or scheduled execution.
