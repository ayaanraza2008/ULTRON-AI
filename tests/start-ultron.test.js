import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { launchUltron } from "../scripts/start-ultron.mjs";

function createHarness() {
  const parent = new EventEmitter();
  parent.execPath = process.execPath;
  parent.pid = 12345;
  parent.exitCode = undefined;
  const forwardedSignals = [];
  parent.kill = (pid, signal) => forwardedSignals.push({ pid, signal });

  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  let childKillSignal = null;
  child.kill = signal => {
    childKillSignal = signal;
    child.signalCode = signal;
    child.emit("exit", null, signal);
    return true;
  };

  launchUltron({
    spawnImpl: () => child,
    processObject: parent,
    env: { PATH: "" },
    projectRoot: "/tmp/ultron-test",
    logError() {}
  });
  return { parent, child, forwardedSignals, get childKillSignal() { return childKillSignal; } };
}

for (const signal of ["SIGTERM", "SIGINT"]) {
  test("launcher forwards " + signal + " to its API child and waits for exit", () => {
    const harness = createHarness();
    harness.parent.emit(signal);
    assert.equal(harness.childKillSignal, signal);
    assert.equal(harness.parent.exitCode, 0);
    assert.deepEqual(harness.forwardedSignals, [], "a requested shutdown must not re-signal the parent");
  });
}

test("launcher relays an unexpected child termination signal to the parent", () => {
  const harness = createHarness();
  harness.child.signalCode = "SIGTERM";
  harness.child.emit("exit", null, "SIGTERM");
  assert.deepEqual(harness.forwardedSignals, [{ pid: 12345, signal: "SIGTERM" }]);
});

test("startup provider smokes are skipped unless explicitly enabled", async () => {
  const logs = [];
  let textCalls = 0;
  let visionCalls = 0;
  const result = await (await import("../scripts/start-ultron.mjs")).runStartupProviderSmokes({
    env: { OPENROUTER_API_KEY: "synthetic-secret" },
    logger: { info: (...args) => logs.push(args) },
    textSmoke: async () => { textCalls += 1; return { status: "passed" }; },
    visionSmoke: async () => { visionCalls += 1; return { status: "passed" }; }
  });
  assert.deepEqual(result, {});
  assert.equal(textCalls, 0);
  assert.equal(visionCalls, 0);
  assert.equal(logs.length, 0);
});

test("startup text smoke logs only bounded status metadata, never generated output or credentials", async () => {
  const logs = [];
  const result = await (await import("../scripts/start-ultron.mjs")).runStartupProviderSmokes({
    env: { ULTRON_RUN_STARTUP_MODEL_SMOKE: "YES", OPENROUTER_API_KEY: "synthetic-secret" },
    logger: { info: (...args) => logs.push(args) },
    textSmoke: async () => ({
      status: "passed",
      provider: "openrouter",
      model: "openrouter/free",
      completionReceived: true,
      generatedText: "THIS MUST NEVER BE LOGGED",
      secret: "synthetic-secret",
      attempts: [{
        model: "openrouter/free",
        code: "COMPLETION_TRUNCATED",
        httpStatus: 200,
        finishReason: "length",
        contentShape: "missing",
        contentLength: 0,
        reasoningPresent: true,
        toolCallCount: 0,
        contentType: "application/json",
        reasoning: "DO_NOT_LOG_PRIVATE_REASONING"
      }]
    })
  });
  assert.equal(result.text.status, "passed");
  assert.equal(result.text.attemptCount, 1);
  assert.equal(result.text.attempts[0].finishReason, "length");
  assert.equal(result.text.attempts[0].reasoningPresent, true);
  assert.equal(JSON.stringify(logs).includes("DO_NOT_LOG_PRIVATE_REASONING"), false);
  assert.equal(JSON.stringify(logs).includes("synthetic-secret"), false);
  assert.equal(JSON.stringify(logs).includes("THIS MUST NEVER BE LOGGED"), false);
  assert.equal(JSON.stringify(logs).includes("generatedText"), false);
});

test("startup vision smoke explicitly confirms the synthetic challenge without revealing output", async () => {
  const logs = [];
  let captured;
  const result = await (await import("../scripts/start-ultron.mjs")).runStartupProviderSmokes({
    env: { ULTRON_RUN_STARTUP_VISION_SMOKE: "YES", OPENROUTER_API_KEY: "synthetic-secret" },
    logger: { info: (...args) => logs.push(args) },
    visionSmoke: async options => {
      captured = options;
      return { status: "passed", provider: "openrouter", model: "openrouter/free", challengeVerified: true, attempts: [] };
    }
  });
  assert.equal(captured.env.ULTRON_CONFIRM_VISION_SMOKE, "YES");
  assert.equal(result.vision.challengeVerified, true);
  assert.equal(JSON.stringify(logs).includes("synthetic-secret"), false);
});

