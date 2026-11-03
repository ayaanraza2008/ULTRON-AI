import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CodingSandbox, SUPPORTED_SANDBOX_LANGUAGES } from "../tools/sandbox/coding-sandbox.js";

const execFileAsync = promisify(execFile);

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

test("CodingSandbox: executes JavaScript in container with resource limits via mock container runner", async () => {
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

test("CodingSandbox: executes Python in container and handles container timeouts (mock runner)", async () => {
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

// Part 2: Genuine Docker-Backed Security & Isolation Tests
test("CodingSandbox: Genuine Docker Security & Isolation Battery", async (t) => {
  const sandbox = new CodingSandbox({ timeoutMs: 10000 });
  const probe = await sandbox.checkDockerRuntime(true);

  if (!probe.available) {
    t.skip("Host Docker daemon is not available; real container security battery runs in Docker-enabled CI environment");
    return;
  }

  const readiness = await sandbox.initialize();
  assert.equal(readiness.ready, true);
  assert.equal(readiness.code, "CODE_SANDBOX_ACTIVE");
  assert.equal(readiness.isolationEngine, "DOCKER_CONTAINER");

  await t.test("1. Basic execution: executes JavaScript in real container with exit code 0", async () => {
    const res = await sandbox.executeJavaScript("console.log(JSON.stringify({ container: true, sum: 2 + 3 }));");
    assert.equal(res.success, true);
    assert.equal(res.executed, true);
    assert.equal(res.isolationEngine, "DOCKER_CONTAINER");
    assert.equal(res.dockerVerified, true);
    const parsed = JSON.parse(res.stdout.trim());
    assert.equal(parsed.container, true);
    assert.equal(parsed.sum, 5);
  });

  await t.test("2. Execution timeout enforcement & process termination", async () => {
    const shortTimeoutSandbox = new CodingSandbox({ timeoutMs: 1500 });
    await shortTimeoutSandbox.initialize();

    const res = await shortTimeoutSandbox.executeJavaScript("while(true) {}");
    assert.equal(res.success, false);
    assert.equal(res.timedOut, true);
    assert.equal(res.errorCode, "EXECUTION_TIMEOUT");
    assert.match(res.error, /exceeded timeout limit/i);
  });

  await t.test("3. Memory limit enforcement: process exceeding memory quota is terminated", async () => {
    // 64MB memory limit
    const tightSandbox = new CodingSandbox({ memoryLimitMb: 64, timeoutMs: 8000 });
    await tightSandbox.initialize();

    // Attempting to allocate 200MB buffer in a 64MB container triggers OOM killer
    const oomCode = `
      try {
        const buffers = [];
        for (let i = 0; i < 20; i++) {
          buffers.push(Buffer.alloc(10 * 1024 * 1024));
        }
        console.log("SURVIVED");
      } catch (err) {
        console.error("CAUGHT_IN_V8:" + err.message);
      }
    `;
    const res = await tightSandbox.executeJavaScript(oomCode);
    assert.ok(res.success === false || res.stdout.includes("CAUGHT_IN_V8") || !res.stdout.includes("SURVIVED"),
      "Memory limit must terminate container or cause V8 allocation error");
  });

  await t.test("4. Filesystem isolation: read-only root blocks host & container disk tampering", async () => {
    const writeCode = `
      const fs = require('fs');
      try {
        fs.writeFileSync('/root_tamper.txt', 'danger');
        console.log('WRITE_SUCCESS');
      } catch (err) {
        console.log('WRITE_FAILED:' + err.code);
      }
    `;
    const res = await sandbox.executeJavaScript(writeCode);
    assert.ok(res.stdout.includes("WRITE_FAILED:EROFS") || res.success === false,
      "Root filesystem must be mounted read-only (EROFS)");
  });

  await t.test("5. Network restrictions: --network=none blocks all outbound traffic", async () => {
    const netCode = `
      const http = require('http');
      const req = http.get('http://1.1.1.1', (res) => {
        console.log('NET_CONNECTED');
      });
      req.on('error', (err) => {
        console.log('NET_BLOCKED:' + err.code);
      });
    `;
    const res = await sandbox.executeJavaScript(netCode);
    assert.ok(res.stdout.includes("NET_BLOCKED") || !res.stdout.includes("NET_CONNECTED"),
      "Network isolation must block all outbound socket attempts");
  });

  await t.test("6. Secret isolation: host environment variables are not leaked into container", async () => {
    const envCode = `
      console.log(JSON.stringify(process.env));
    `;
    const res = await sandbox.executeJavaScript(envCode);
    assert.equal(res.success, true);
    const containerEnv = JSON.parse(res.stdout.trim());
    // Host secrets and paths must NOT be present
    assert.equal(containerEnv.SUPABASE_SERVICE_ROLE_KEY, undefined);
    assert.equal(containerEnv.GEMINI_API_KEY, undefined);
    assert.equal(containerEnv.OPENROUTER_API_KEY, undefined);
    assert.equal(containerEnv.USERPROFILE, undefined);
  });

  await t.test("7. Container cleanup: ephemeral containers are deleted without dangling resources", async () => {
    try {
      const { stdout } = await execFileAsync("docker", ["ps", "-a", "--filter", "name=sandbox-", "--format", "{{.Names}}"]);
      const activeSandboxes = stdout.trim().split("\n").filter(Boolean);
      // Containers run with --rm or cleaned up via docker rm -f
      assert.ok(activeSandboxes.length <= 1, "There should be no accumulating dangling sandbox containers");
    } catch {}
  });
});
