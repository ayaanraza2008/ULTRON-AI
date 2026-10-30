# Harness2 — local agent-harness benchmarking

Harness2 is a Python 3.12+ standard-library tool in the ULTRON repository. It runs a baseline, proposes bounded updates to individual harness components, evaluates responses against explicit benchmark criteria, and stores resumable run state and reports locally.

## Credential-free Linux demo

From the ULTRON repository root:

```bash
python3 --version
python3 tools/harness2/harness2.py setup --workspace .
python3 tools/harness2/harness2.py benchmarks
python3 tools/harness2/harness2.py run --workspace . --benchmark smoke --executor demo --mode sequential --iterations 3
```

Parallel refinement and the safety benchmark:

```bash
python3 tools/harness2/harness2.py run --workspace . --benchmark smoke --executor demo --mode parallel --iterations 3 --parallelism 2
python3 tools/harness2/harness2.py run --workspace . --benchmark safety --executor demo
```

The deterministic demo needs no model credentials. It validates the Harness2 workflow only; it is not an AI model-quality benchmark.

## OpenCode and Codex

Install and authenticate the local CLI separately. Current official docs:
- OpenCode CLI: https://dev.opencode.ai/docs/cli/
- Codex CLI: https://learn.chatgpt.com/docs/cli/reference

```bash
python3 tools/harness2/harness2.py run --workspace . --benchmark smoke --executor opencode --mode sequential
python3 tools/harness2/harness2.py run --workspace . --benchmark smoke --executor codex --mode parallel --parallelism 2
```

Harness2 does not install CLIs or collect credentials. OpenCode is invoked in pure mode with a temporary primary agent and deny-by-default tool permissions. Codex uses `codex exec` in a temporary directory with read-only sandboxing, no approvals, ephemeral session data, and user-config/rules ignored. Local CLI authentication remains the user's responsibility; provider usage may incur cost.

## Harness components and results

Setup creates eight Markdown components: system prompt, guardrails, memory, tool guidance, subagents, skills, scripts and plugins. Each refinement candidate can replace only its selected component. Script and plugin entries are documentation/metadata only: Harness2 does not execute scripts, install plugins or activate skills.

Run data is saved under `.harness2/runs/<run-id>/`: baseline and candidate harness snapshots, benchmark JSON, candidate result JSON, a run checkpoint, and a Markdown report.

```bash
python3 tools/harness2/harness2.py resume <run-id> --workspace .
python3 tools/harness2/harness2.py judge <run-id> --workspace .
python3 tools/harness2/harness2.py report <run-id> --workspace .
```

## Custom benchmarks

Pass `--benchmark-file path/to/benchmark.json`. JSON must contain a non-empty `tasks` array. Each task requires a unique simple `id` and non-empty `prompt`; optional criteria include `all_contains`, `any_contains`, `forbidden_contains`, and `min_chars`. The built-in judge is transparent substring/length matching, not an LLM judge or execution-based benchmark. Review per-task evidence; scores are comparable only under the same dataset and executor.

## Boundaries

- Python standard library only; Python 3.12+.
- Benchmark tasks run serially within each candidate; candidate refinement is sequential or parallel.
- Executor invocations run from temporary directories outside the ULTRON source tree.
- Do not put secrets or sensitive personal data in harness memory.
- CLI failures/timeouts are recorded as empty answers and reduce scores.
