import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  getCodeSandboxReadiness,
  runSandboxedPython,
  codeSandboxLimits
} from "../integrations/code-sandbox.js";

const image = "python:3.12-slim@sha256:" + "a".repeat(64);
const env = {
  ULTRON_CODE_SANDBOX_ENABLED: "true",
  ULTRON_CODE_SANDBOX_IMAGE: image,
  OPENROUTER_API_KEY: "must-not-reach-container",
  SUPABASE_SERVICE_ROLE_KEY: "must-not-reach-container"
};

function fakeSpawn({ stdout = "", stderr = "", exitCode = 0 } = {}) {
  let capturedSource = "";
  let capturedArgs;
  let capturedOptions;
  let killArgs = null;
  let killed = false;
  const spawnImpl = (command, args, options) => {
    if (args[0] === "run") {
      capturedArgs = args;
      capturedOptions = options;
    } else if (args[0] === "kill") {
      killArgs = args;
    }
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { end(value) {
      capturedSource = value;
      queueMicrotask(() => {
        if (stdout) child.stdout.emit("data", Buffer.from(stdout));
        if (stderr) child.stderr.emit("data", Buffer.from(stderr));
        child.emit("close", exitCode, null);
      });
    } };
    child.kill = () => {
      killed = true;
      queueMicrotask(() => child.emit("close", null, "SIGKILL"));
      return true;
    };
    return child;
  };
  return {
    spawnImpl,
    get source() { return capturedSource; },
    get args() { return capturedArgs; },
    get options() { return capturedOptions; },
    get killed() { return killed; }
  };
}

test("sandbox is fail-closed when disabled or not pinned to an image digest", async () => {
  assert.equal(getCodeSandboxReadiness({}).state, "disabled");
  assert.equal(getCodeSandboxReadiness({ ...env, ULTRON_CODE_SANDBOX_ENABLED: "false" }).configured, false);
  assert.equal(getCodeSandboxReadiness({ ...env, ULTRON_CODE_SANDBOX_IMAGE: "python:3.12-slim" }).state, "blocked");
  const result = await runSandboxedPython({ env: {}, code: "print('must not run')", spawnImpl: () => { throw new Error("must not spawn"); } });
  assert.equal(result.code, "CODE_SANDBOX_NOT_CONFIGURED");
});

test("sandbox runs bounded Python source with fixed no-network, no-mount container policy", async () => {
  const fake = fakeSpawn({ stdout: "ULTRON_SANDBOX_OK\n" });
  const source = "print('ULTRON_SANDBOX_OK')";
  const result = await runSandboxedPython({ env, code: source, spawnImpl: fake.spawnImpl });
  assert.equal(result.state, "completed");
  assert.equal(result.stdout, "ULTRON_SANDBOX_OK\n");
  assert.equal(fake.source, source);
  assert.equal(fake.args[0], "run");
  assert.ok(fake.args.includes("--network=none"));
  assert.ok(fake.args.includes("--read-only"));
  assert.ok(fake.args.includes("--cap-drop=ALL"));
  assert.ok(fake.args.includes("--security-opt=no-new-privileges:true"));
  assert.ok(fake.args.includes("--pids-limit=32"));
  assert.ok(fake.args.includes("--memory=128m"));
  assert.ok(fake.args.includes("--cpus=0.5"));
  assert.ok(fake.args.includes("--user=65532:65532"));
  assert.ok(fake.args.includes("--pull=never"));
  assert.ok(fake.args.includes("--name"));
  assert.ok(fake.args.some(value => String(value).startsWith("ultron-sandbox-")));
  assert.equal(fake.args.some(value => String(value).includes("must-not-reach-container")), false);
  assert.equal(fake.options.env.OPENROUTER_API_KEY, undefined);
  assert.equal(fake.options.env.SUPABASE_SERVICE_ROLE_KEY, undefined);
  assert.deepEqual(codeSandboxLimits, {
    maxCodeChars: 20000,
    maxOutputBytes: 16384,
    maxTimeoutMs: 8000,
    defaultTimeoutMs: 4000,
    maxConcurrentRuns: 2
  });
});

test("sandbox refuses oversized source before starting Docker", async () => {
  let calls = 0;
  const result = await runSandboxedPython({ env, code: "x".repeat(20001), spawnImpl: () => { calls += 1; } });
  assert.equal(result.code, "CODE_SANDBOX_INVALID_SOURCE");
  assert.equal(calls, 0);
});

test("sandbox kills a process that floods its bounded output", async () => {
  const fake = fakeSpawn({ stdout: "x".repeat(codeSandboxLimits.maxOutputBytes + 1) });
  const result = await runSandboxedPython({ env, code: "print('x')", spawnImpl: fake.spawnImpl });
  assert.equal(result.code, "CODE_SANDBOX_OUTPUT_LIMIT");
  assert.equal(fake.killed, true);
  assert.equal(fake.killArgs && fake.killArgs[0], "kill");
  assert.match((fake.killArgs && fake.killArgs[1]) || "", /^ultron-sandbox-/);
});

test("sandbox reports a missing Docker executable without leaking environment", async () => {
  const spawnImpl = () => {
    const error = new Error("not found");
    error.code = "ENOENT";
    throw error;
  };
  const result = await runSandboxedPython({ env, code: "print(1)", spawnImpl });
  assert.equal(result.code, "DOCKER_NOT_INSTALLED");
});
