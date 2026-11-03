import test from "node:test";
import assert from "node:assert/strict";
import { CodingSandbox, SUPPORTED_SANDBOX_LANGUAGES } from "../tools/sandbox/coding-sandbox.js";

test("CodingSandbox: fails closed deterministically when Docker is not available on host", async () => {
  const sandbox = new CodingSandbox({ timeoutMs: 3000, dockerAvailable: false });
  const readiness = await sandbox.initialize();

  // On host without Docker, must fail closed
  assert.equal(readiness.ready, false);
  assert.equal(readiness.enabled, false);
  assert.equal(readiness.code, "CODE_SANDBOX_DISABLED");
  assert.match(readiness.reason, /no verified OS-level isolation runtime/);

  // Attempting execution fails closed without executing
  const jsRes = await sandbox.executeJavaScript("console.log('untrusted');");
  assert.equal(jsRes.success, false);
  assert.equal(jsRes.executed, false);
  assert.equal(jsRes.errorCode, "CODE_SANDBOX_DISABLED");
  assert.match(jsRes.error, /no verified OS-level isolation runtime/);

  const pyRes = await sandbox.executePython("print('untrusted')");
  assert.equal(pyRes.success, false);
  assert.equal(pyRes.executed, false);
  assert.equal(pyRes.errorCode, "CODE_SANDBOX_DISABLED");
});

test("CodingSandbox: labels explicit Docker overrides as test-only", async () => {
  const sandbox = new CodingSandbox({
    timeoutMs: 3000,
    memoryLimitMb: 256,
    cpuLimit: "0.5",
    dockerAvailable: true,
    dockerVersion: "24.0.5"
  });
  const readiness = await sandbox.initialize();

  assert.equal(readiness.ready, false);
  assert.equal(readiness.enabled, false);
  assert.equal(readiness.code, "CODE_SANDBOX_MOCK_ONLY");
  assert.equal(readiness.isolationEngine, "MOCK_CONTAINER_RUNNER");
  assert.equal(readiness.simulated, true);
  assert.equal(readiness.dockerVerified, false);
  assert.equal(sandbox.isDockerVerified, false);

  const execution = await sandbox.executeJavaScript("console.log('must not run')");
  assert.equal(execution.success, false);
  assert.equal(execution.executed, false);
  assert.equal(execution.errorCode, "CODE_SANDBOX_MOCK_ONLY");
  assert.equal(execution.dockerVerified, false);
});

test("CodingSandbox: dynamically probes host Docker daemon without forcing override", async () => {
  const sandbox = new CodingSandbox();
  const probe = await sandbox.checkDockerRuntime();
  assert.equal(typeof probe.available, "boolean");

  const readiness = await sandbox.initialize();
  assert.equal(readiness.ready, probe.available);
  if (probe.available) {
    assert.equal(readiness.code, "CODE_SANDBOX_ACTIVE");
    assert.equal(readiness.isolationEngine, "DOCKER_CONTAINER");
  } else {
    assert.equal(readiness.code, "CODE_SANDBOX_DISABLED");
  }
});

test("CodingSandbox: rejects unsupported languages before checking container", async () => {
  const sandbox = new CodingSandbox();
  const res = await sandbox.executeCode("echo 'test'", "bash");

  assert.equal(res.success, false);
  assert.equal(res.executed, false);
  assert.equal(res.errorCode, "UNSUPPORTED_LANGUAGE");
  assert.ok(res.error.includes("Language 'bash' is not supported"));
});

test("CodingSandbox: executes JavaScript in container with resource limits via container runner", async () => {
  let invokedWith = null;
  const mockRunner = async (code, lang, opts) => {
    invokedWith = { code, lang, opts };
    return {
      language: lang,
      success: true,
      executed: true,
      timedOut: false,
      executionTimeMs: 42,
      stdout: "Hello from isolated container!\n",
      stderr: ""
    };
  };

  const sandbox = new CodingSandbox({
    timeoutMs: 4000,
    memoryLimitMb: 128,
    cpuLimit: "0.5",
    customContainerRunner: mockRunner
  });

  const readiness = await sandbox.initialize();
  assert.equal(readiness.ready, false);
  assert.equal(readiness.enabled, false);
  assert.equal(readiness.code, "CODE_SANDBOX_MOCK_ONLY");
  assert.equal(readiness.isolationEngine, "MOCK_CONTAINER_RUNNER");
  assert.equal(readiness.simulated, true);
  assert.equal(readiness.dockerVerified, false);

  const res = await sandbox.executeJavaScript("console.log('Hello from isolated container!');");
  assert.equal(res.success, true);
  assert.equal(res.executed, true);
  assert.equal(res.isolationEngine, "MOCK_CONTAINER_RUNNER");
  assert.equal(res.simulated, true);
  assert.equal(res.dockerVerified, false);
  assert.equal(res.stdout.trim(), "Hello from isolated container!");
  assert.equal(invokedWith.lang, "javascript");
  assert.equal(invokedWith.opts.memoryLimitMb, 128);
  assert.equal(invokedWith.opts.cpuLimit, "0.5");
  assert.equal(invokedWith.opts.timeoutMs, 4000);

  // History recorded
  const history = sandbox.getExecutionHistory();
  assert.equal(history.length, 1);
  assert.equal(history[0].language, "javascript");
  assert.equal(history[0].isolationEngine, "MOCK_CONTAINER_RUNNER");
  assert.equal(history[0].simulated, true);
  assert.equal(history[0].dockerVerified, false);
});

test("CodingSandbox: executes Python in container and handles container timeouts", async () => {
  const mockRunner = async (_code, lang, opts) => {
    return {
      language: lang,
      success: false,
      executed: true,
      timedOut: true,
      executionTimeMs: opts.timeoutMs + 10,
      errorCode: "EXECUTION_TIMEOUT",
      error: `Execution exceeded timeout limit of ${opts.timeoutMs}ms.`,
      stdout: "",
      stderr: ""
    };
  };

  const sandbox = new CodingSandbox({
    timeoutMs: 2000,
    customContainerRunner: mockRunner
  });

  const res = await sandbox.executePython("import time; time.sleep(10)");
  assert.equal(res.success, false);
  assert.equal(res.executed, true);
  assert.equal(res.timedOut, true);
  assert.equal(res.errorCode, "EXECUTION_TIMEOUT");
  assert.equal(res.isolationEngine, "MOCK_CONTAINER_RUNNER");
  assert.equal(res.simulated, true);
  assert.equal(res.dockerVerified, false);
  assert.ok(res.error.includes("2000ms"));
});
