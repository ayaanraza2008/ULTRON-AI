# ULTRON Live Worker Acceptance

This is a manual, explicitly gated check for the deployed ULTRON worker. It does not deploy services or change environment settings.

## Required GitHub Actions secrets

Create these repository secrets under Settings → Secrets and variables → Actions:

- `ULTRON_SMOKE_SUPABASE_SERVICE_ROLE_KEY`: the service-role credential for the dedicated ULTRON-AI Supabase project. Never use a publishable key here.
- `ULTRON_SMOKE_USER_ID`: the UUID of a dedicated, confirmed test account in that same project. Do not use a normal personal account.

The workflow hardcodes the expected Supabase project URL `https://opdjfhwepmcprbqojpat.supabase.co`. The smoke script also rejects unsafe Supabase endpoints, invalid UUIDs, missing credentials, and runs without the explicit confirmation flag.

## How to run

1. Open GitHub Actions → **ULTRON Live Worker Acceptance**.
2. Select the `main` branch.
3. Select `YES` only when the Render worker is enabled and the configured worker provider is an approved free model.
4. Run the workflow and inspect its redacted result.

The check inserts one `chief-of-staff` plan-only task, waits for a terminal state and validates the persisted `employee_output` result. It does not send messages, publish, purchase, alter settings, control devices, or run code. A completed task is deleted. The worker's audit event may remain as an operational record.

If the required secrets are absent, the check fails closed before creating a task. A timeout conditionally cancels the task and only deletes it when cancellation succeeds.

## What a pass proves

A pass proves that the deployed worker claimed this one synthetic task, called its configured model provider, persisted a valid result, and completed the smoke test. It does not prove every task type, every provider, memory preference behavior, two-account isolation, voice, vision, browser automation, Hermes, or physical-device control.
