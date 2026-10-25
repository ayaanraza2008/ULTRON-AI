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
