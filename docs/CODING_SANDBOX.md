# ULTRON isolated coding sandbox

## Scope

The authenticated agent can expose `coding_sandbox_run` to the configured owner only. It runs Python or JavaScript from a single fenced code block only when the raw user prompt begins with a direct command such as “Run this code”, “Execute this code”, or “Test this code”. The tool parses source from the raw user prompt and rejects language/source mismatches in model-generated tool arguments. Review requests, indirect instructions, unsupported languages, extra text after the fenced block, and contradictory “do not run” wording do not authorize execution.

## Default-off configuration

- `ULTRON_CODING_SANDBOX_ENABLED=false` by default.
- `ULTRON_INTEGRATION_OWNER_USER_ID` must be a valid Supabase Auth UUID and match the signed-in user.
- At least one of `ULTRON_CODING_SANDBOX_NODE_IMAGE` or `ULTRON_CODING_SANDBOX_PYTHON_IMAGE` must identify a trusted image pinned by an immutable `@sha256:` digest.
- The image must already be cached locally. The code does not run `docker pull`.
- `ULTRON_CODING_SANDBOX_TIMEOUT_MS` is clamped to 1–10 seconds (default 5 seconds).

The execution container disables networking, uses a read-only root filesystem, drops capabilities, enables `no-new-privileges`, runs as UID/GID 65534, and limits memory to 256 MiB, CPU to 0.5 cores, process count to 48 and open files to 64. It mounts only the temporary source directory read-only and uses a 64 MiB `/tmp` with `noexec,nosuid,nodev`. Source is limited to 20 KB at the module boundary and 5 KB through the agent. Output is capped at 16 KB. The implementation does not fall back to running code on the host if Docker is unavailable.

## Safe validation

`npm test` includes tests for raw-prompt authorization, exact-source matching, owner restrictions, default-off behavior, digest requirements, network-disabled/read-only container flags, timeouts and cleanup. Those tests use a mocked Docker CLI and do not prove real container execution.

Before enabling the feature on a trusted local host, preload and inspect the chosen runtime image, verify its digest and license, run the tests, then perform one explicit disposable-code smoke test while observing that the container is removed. Do not enable it on a public hosted service until Docker isolation, per-user resource quotas, image provenance and operational monitoring are reviewed. A cloud-hosted API's Docker daemon runs on the cloud host, not the user's Windows PC.

## Remaining limitation

This is an opt-in constrained execution path, not a complete coding-agent workflow that autonomously edits the repository, runs all project tests and opens/merges pull requests. The sandbox needs target-host Docker verification before being marked live.
