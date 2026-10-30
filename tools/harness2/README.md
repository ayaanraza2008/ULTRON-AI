# Harness2

Harness2 is a local Python 3.12+ utility for running small benchmarks against an agent harness, proposing iterative harness refinements, scoring saved answers, and resuming interrupted runs. It uses the Python standard library; there are no Python package dependencies.

## 1. Try the zero-credential demo

From the ULTRON repository root on Linux:

```bash
python3 --version
python3 tools/harness2/harness2.py setup --workspace .
python3 tools/harness2/harness2.py doctor --workspace .
python3 tools/harness2/harness2.py benchmarks list
python3 tools/harness2/harness2.py run --workspace . --benchmark smoke --executor demo --mode sequential --iterations 4
```

The demo executor is deterministic and requires no API key or model CLI. It verifies that Harness2 can create a harness, run a baseline, apply bounded component changes, store checkpoints, judge results, and write a report. It is not a model-quality or capability benchmark.

To use parallel refinement:

```bash
python3 tools/harness2/harness2.py run --workspace . --benchmark smoke --executor demo --mode parallel --iterations 4 --parallelism 2
```

A safety-oriented fixture is also available:

```bash
python3 tools/harness2/harness2.py run --workspace . --benchmark safety --executor demo --mode sequential --iterations 3
```

## 2. Use OpenCode or Codex

Install and authenticate one executor separately using its official instructions:

- OpenCode CLI: https://dev.opencode.ai/docs/cli/
- OpenCode agent permissions: https://opencode.ai/docs/agents/
- Codex CLI: https://learn.chatgpt.com/docs/cli/reference

Harness2 does not install either CLI and does not collect, print, or store API keys. The executor uses the credentials already configured in the local CLI environment. The default `demo` mode is the only mode that needs no model credentials.

```bash
# OpenCode
python3 tools/harness2/harness2.py run --workspace . --benchmark smoke --executor opencode --mode sequential --iterations 4

# Codex
python3 tools/harness2/harness2.py run --workspace . --benchmark smoke --executor codex --mode parallel --iterations 4 --parallelism 2
```

OpenCode runs from a new temporary directory, uses `--pure`, and loads an isolated temporary primary Markdown agent. Its wildcard permission is `deny`; only read/glob/grep/list are allowed. Shell, editing, external directories, subagents, skills, and web tools are denied. The config and temporary agent are passed using `OPENCODE_CONFIG` and `OPENCODE_CONFIG_DIR`. These flags and permission keys follow the current OpenCode CLI and agent documentation.

Codex runs from a new temporary directory with `codex exec --json --sandbox read-only --ask-for-approval never --ephemeral --ignore-user-config --ignore-rules -` and receives its prompt over stdin. `--ignore-user-config` avoids inherited MCP/tool configuration while Codex authentication can still use `CODEX_HOME`. These options are documented by the current Codex CLI reference. Codex may use read-only sandbox tools inside its temporary working directory; it cannot modify the ULTRON repository.

Both adapters use argument arrays (no shell), non-interactive stdin, bounded prompt/output sizes, and execution timeouts. CLI authentication and model provider billing/data policies remain the user's responsibility. Harness2 does not claim that either adapter has been live-tested unless a real local CLI run is separately recorded.

## 3. Harness components

`setup` creates `.harness2/harness/` with separate Markdown components for:

- `system_prompt.md`
- `guardrails.md`
- `memory.md`
- `tool_guidance.md`
- `subagents/reviewer.md`
- `skills/benchmarking/SKILL.md`
- `scripts/README.md`
- `plugins/README.md`

Only these fixed component names can be refined. Script and plugin components are documentation/metadata only: Harness2 does not execute scripts, install skills, add plugins, or change external services. Memory guidance must not contain credentials or unnecessary personal data.

## 4. Run, inspect, resume

Each run is saved under `.harness2/runs/<run-id>/` with its benchmark copy, baseline, candidate snapshots, `run.json` checkpoint, `judgment.json`, and `report.md`.

```bash
python3 tools/harness2/harness2.py resume <run-id> --workspace .
python3 tools/harness2/harness2.py judge <run-id> --workspace .
python3 tools/harness2/harness2.py report <run-id> --workspace .
```

A completed candidate is reused on resume. A candidate interrupted before its result is saved is rerun from its isolated copy. Results and generated harness snapshots stay local and are ignored by the repository `.gitignore` entry written by `setup`.

## 5. Custom benchmark JSON

Pass `--benchmark-file path/to/benchmark.json`. A benchmark is a JSON object with a `name`, optional `description` and `version`, and a non-empty `tasks` array. Each task has a unique simple `id`, non-empty `prompt`, optional `title`, and `criteria`:

```json
{
  "name": "example",
  "version": 1,
  "tasks": [
    {
      "id": "structured_answer",
      "title": "Structured answer",
      "prompt": "Give a goal, steps, and a verification plan.",
      "criteria": {
        "all_contains": ["Goal:", "Steps:", "Verification:"],
        "any_contains": ["check", "verify"],
        "forbidden_contains": ["I ran tests"],
        "min_chars": 40
      }
    }
  ]
}
```

The built-in judge is intentionally simple and transparent: substring checks, forbidden-string checks, and minimum answer length. It is not a substitute for a domain-specific human or model judge, execution-based software benchmarks, or independent review. Scores are comparable only for the same benchmark criteria and executor setup.

## 6. Safety and limitations

- Harness2 never accesses or modifies the ULTRON project source when running a benchmark; candidate harnesses are copied to local run folders.
- `.harness2/` is local workspace state and is added to `.gitignore` by setup.
- Harness component updates are allowlisted and bounded; symlinked harness/state paths are rejected.
- No generated scripts are executed, and no plugins or skills are installed.
- The local demo does not use any model; it proves the workflow mechanics only.
- OpenCode and Codex runs still require local CLI authentication/model access. Model providers can have their own costs and data policies.
- The current version runs one benchmark task at a time within each candidate, caps prompt and output size, and records tool failures in candidate results.
- Candidate scores are heuristics. Do not treat them as evidence that a harness is safe, correct, or production-ready.
