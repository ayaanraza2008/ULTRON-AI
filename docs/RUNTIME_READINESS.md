# Runtime readiness diagnostics

ULTRON exposes an authenticated, secret-free runtime snapshot at:

- `GET /api/runtime/readiness`
- Authentication: valid ULTRON Supabase user session
- Response caching: disabled

The endpoint is intended for operator diagnostics and future UI integration. It does not perform external network probes, execute tasks, run arbitrary code, or control a user's PC.

## Interpreting states

- `configured_unverified`: required settings are present, but successful provider calls and production behavior have not been proven.
- `running`: the in-process background worker reports that it is running. Check task counters and last successful poll; this alone does not prove every task succeeds.
- `best_effort_fallback`: a limited fallback exists, but reliability is not guaranteed.
- `optional`: a capability is intentionally not required for the base service.
- `blocked`, `disabled`, `not_started`, `not_available`: the capability is not ready or is intentionally unavailable.

The response includes the worker's state and aggregate counters but never returns environment-variable values, API keys, access tokens, user content, or database records.

## Important current limitations

- A configured model provider is not the same as a successful inference request.
- Browser automation requires a separately hosted authenticated bridge.
- Remote Windows PC automation requires a paired, reachable Windows companion. A Render process cannot access a user's local `localhost`.
- Arbitrary code execution is intentionally not advertised as available until an isolated sandbox is implemented and tested.
- Voice, research, memory, and integration configuration must be verified with authenticated end-to-end tests before being described as production-ready.
- The endpoint's overall state is a readiness aid, not a certification or guarantee that ULTRON is fully autonomous.
