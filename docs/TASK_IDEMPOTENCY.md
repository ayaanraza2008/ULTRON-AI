# ULTRON Background Task Idempotency

## API contract

The authenticated `POST /api/agent/run` endpoint accepts an optional `Idempotency-Key` request header for operations that may enqueue a background task.

Example:

```http
POST /api/agent/run
Content-Type: application/json
Idempotency-Key: ul-trial-2026-10-28-0001

{"prompt":"Queue a web-dev review in the background","confirmBackgroundTask":true}
```

The key must be 8–200 ASCII characters from `A–Z`, `a–z`, `0–9`, dot, underscore, tilde, or hyphen. ULTRON stores only a SHA-256 hash of the supplied key; it does not persist the raw header. The request fingerprint is also a SHA-256 digest and contains no raw secret.

When the same user retries the same submitted operation with the same key, ULTRON returns the original task instead of inserting another task or writing a duplicate task-created audit event. A key reused by the same user for a different submitted operation is rejected with `IDEMPOTENCY_KEY_REUSED`. Keys are scoped per user. Calls without the header retain intentional repeat-task behavior for backward compatibility.

The stable fingerprint is based on the incoming prompt/history and operation context, not the generated tool arguments. This is important because a model may produce slightly different tool arguments when the same request is retried.

## Persistence and race handling

Migration `20261028123000_agent_task_idempotency.sql` creates a partial unique index on `(user_id, input ->> 'idempotencyKey')` only for task inputs that contain an idempotency key. Existing tasks without such a field are unaffected. If two requests race after both observe no previous task, the unique index chooses one winner; the loser reads and reuses that task.

The application maps a PostgREST unique-constraint conflict (HTTP 409) to a distinct conflict status so the enqueue handler can perform that recovery. It does not retry the insert blindly.

## Verification boundary

The deterministic CI tests cover same-key retries, different-payload key reuse, missing-key backward compatibility, per-user isolation, concurrent same-key insert races, model-output drift across retries, malformed keys, and the migration's index contract. These tests use a mock task store; they do **not** prove the index has been successfully created on a real PostgreSQL database or that PostgREST filters behave identically in a live project.

Before release, apply and validate the migration only in a disposable non-production Supabase project. Test the actual `input->>idempotencyKey` filter, a real concurrent insert race, and conflict response semantics. Confirm existing task rows do not contain duplicate `idempotencyKey` fields first. Do not apply this migration to the existing ULTRON project while deployment remains frozen.

## Rollback

If the migration has been applied to a test project and validation fails, remove the candidate unique index from that same test project, then adjust the migration and tests. The application gracefully preserves old behavior for clients that do not send an idempotency key, but requests that rely on retry deduplication must not be considered protected until the index and application code are compatible. No live migration or deployment is authorized by this document.
