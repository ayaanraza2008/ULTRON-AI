const BENCHMARKS = new Set(["smoke", "safety"]);
const EXECUTORS = new Set(["demo", "opencode", "codex"]);
const MODES = new Set(["sequential", "parallel"]);

function boundedInteger(value, fallback, minimum, maximum) {
  return Number.isInteger(value) ? Math.max(minimum, Math.min(maximum, value)) : fallback;
}

/**
 * Build safe local CLI instructions for Harness2. This helper never launches
 * a process; the ULTRON hosted backend cannot execute the user's local tools.
 */
export function buildHarness2Guidance(args = {}) {
  const benchmark = BENCHMARKS.has(args.benchmark) ? args.benchmark : "smoke";
  const executor = EXECUTORS.has(args.executor) ? args.executor : "demo";
  const mode = MODES.has(args.mode) ? args.mode : "sequential";
  const iterations = boundedInteger(args.iterations, 4, 1, 50);
  const parallelism = boundedInteger(args.parallelism, 2, 1, 8);
  const base = "python3 tools/harness2/harness2.py";
  const setup = base + " setup --workspace .";
  const doctor = base + " doctor --workspace .";
  const run = base + " run --workspace . --benchmark " + benchmark + " --executor " + executor + " --mode " + mode + " --iterations " + iterations + " --parallelism " + parallelism;
  return {
    state: "ready",
    execution: "local_cli_guidance_only",
    executed: false,
    localOnly: true,
    benchmark,
    executor,
    mode,
    iterations,
    parallelism,
    credentialsRequired: executor !== "demo",
    notice: executor === "demo"
      ? "No command was executed by ULTRON. Run these commands on your Linux machine from the repository root. The demo needs no model credentials and validates Harness2 mechanics only; it is not a model-quality result."
      : "No command was executed by ULTRON. Run these commands on your Linux machine from the repository root. The selected local CLI must already be installed and authenticated; provider access may incur cost.",
    components: ["system_prompt", "guardrails", "memory", "tool_guidance", "subagents", "skills", "scripts", "plugins"],
    commands: {
      setup,
      doctor,
      run,
      resume: base + " resume <run-id> --workspace .",
      judge: base + " judge <run-id> --workspace .",
      report: base + " report <run-id> --workspace .",
    },
  };
}
