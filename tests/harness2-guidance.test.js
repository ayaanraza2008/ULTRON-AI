import test from "node:test";
import assert from "node:assert/strict";
import { buildHarness2Guidance } from "../integrations/harness2.js";

test("Harness2 guidance defaults to a no-credential deterministic local demo", () => {
  const result = buildHarness2Guidance();
  assert.equal(result.execution, "local_cli_guidance_only");
  assert.equal(result.executed, false);
  assert.equal(result.localOnly, true);
  assert.equal(result.executor, "demo");
  assert.equal(result.credentialsRequired, false);
  assert.match(result.commands.run, /--executor demo/);
  assert.match(result.notice, /no model credentials/i);
  assert.ok(result.components.includes("plugins"));
});

test("Harness2 guidance only interpolates allowlisted modes and bounded integers", () => {
  const result = buildHarness2Guidance({
    benchmark: "safety", executor: "codex", mode: "parallel",
    iterations: 999, parallelism: -10,
  });
  assert.equal(result.benchmark, "safety");
  assert.equal(result.executor, "codex");
  assert.equal(result.mode, "parallel");
  assert.equal(result.iterations, 50);
  assert.equal(result.parallelism, 1);
  assert.equal(result.credentialsRequired, true);
  assert.match(result.commands.run, /--benchmark safety/);
  assert.match(result.commands.run, /--executor codex/);
  assert.doesNotMatch(result.commands.run, /999|-10/);
  const rejected = buildHarness2Guidance({ benchmark: "../../etc/passwd", executor: "sh; id", mode: "anything" });
  assert.equal(rejected.benchmark, "smoke");
  assert.equal(rejected.executor, "demo");
  assert.equal(rejected.mode, "sequential");
});
