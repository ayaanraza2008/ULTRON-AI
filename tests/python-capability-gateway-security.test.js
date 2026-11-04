import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { PythonCapabilityGateway, GATEWAY_ERROR_CODES } from "../integrations/python-capability-gateway.js";

function makeFakeChild({ stdoutPayload, stderrPayload = "", closeCode = 0 } = {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.killed = false;
  child.kill = signal => {
    child.killed = true;
    child.killSignal = signal;
    return true;
  };
  const stdinChunks = [];
  child.stdin.on("data", chunk => stdinChunks.push(Buffer.from(chunk)));
  const finish = () => {
    if (stderrPayload) child.stderr.end(Buffer.from(stderrPayload));
    if (stdoutPayload !== undefined) child.stdout.end(Buffer.from(stdoutPayload));
    else child.stdout.end();
    child.emit("close", closeCode);
  };
  return { child, stdinChunks, finish };
}

test("Python gateway rejects unknown capability/method pairs without spawning a process", async () => {
  let spawned = false;
  const gateway = new PythonCapabilityGateway({
    runtimeScript: fileURLToPath(import.meta.url),
    spawnImpl: () => { spawned = true; throw new Error("must not spawn"); }
  });
  await assert.rejects(
    () => gateway.invokeRpc("desktop", "run_shell_command", {}),
    error => error.code === GATEWAY_ERROR_CODES.INVALID_METHOD
  );
  await assert.rejects(
    () => gateway.invokeRpc("unknown", "get_status", {}),
    error => error.code === GATEWAY_ERROR_CODES.INVALID_METHOD
  );
  assert.equal(spawned, false);
});

test("Python gateway uses shell-free spawn, bounded minimal environment and bounded JSON input", async () => {
  const original = {
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    SESSION_SECRET: process.env.SESSION_SECRET
  };
  process.env.OPENROUTER_API_KEY = "synthetic-openrouter-secret";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic-supabase-secret";
  process.env.SESSION_SECRET = "synthetic-session-secret";

  let spawnArgs;
  let childFixture;
  const gateway = new PythonCapabilityGateway({
    runtimeScript: fileURLToPath(import.meta.url),
    spawnImpl: (command, args, options) => {
      spawnArgs = { command, args, options };
      childFixture = makeFakeChild({
        stdoutPayload: JSON.stringify({ success: true, data: { volume: 42 } })
      });
      setImmediate(childFixture.finish);
      return childFixture.child;
    }
  });
  try {
    const result = await gateway.invokeRpc("desktop", "get_volume", {});
    assert.deepEqual(result, { volume: 42 });
    assert.equal(spawnArgs.options.shell, false);
    assert.equal(spawnArgs.options.cwd, new URL(".", import.meta.url).pathname.replace(/^\//, "").replaceAll("%20", " "));
    assert.equal(spawnArgs.options.env.OPENROUTER_API_KEY, undefined);
    assert.equal(spawnArgs.options.env.SUPABASE_SERVICE_ROLE_KEY, undefined);
    assert.equal(spawnArgs.options.env.SESSION_SECRET, undefined);
    assert.equal(spawnArgs.options.env.PYTHONUNBUFFERED, "1");
    assert.equal(spawnArgs.args.includes("get_volume"), true);
    assert.deepEqual(JSON.parse(Buffer.concat(childFixture.stdinChunks).toString("utf8")), {});
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("Python gateway rejects oversized input before process creation", async () => {
  let spawned = false;
  const gateway = new PythonCapabilityGateway({
    runtimeScript: fileURLToPath(import.meta.url),
    spawnImpl: () => { spawned = true; throw new Error("must not spawn"); }
  });
  await assert.rejects(
    () => gateway.invokeRpc("cerebro", "semantic_query", { query: "x".repeat(1024 * 1024 + 1) }),
    error => error.code === GATEWAY_ERROR_CODES.INVALID_PAYLOAD
  );
  assert.equal(spawned, false);
});

test("Python gateway kills a child and rejects when stdout exceeds the byte limit", async () => {
  let fixture;
  const gateway = new PythonCapabilityGateway({
    runtimeScript: fileURLToPath(import.meta.url),
    maxBufferBytes: 1024,
    spawnImpl: () => {
      fixture = makeFakeChild();
      setImmediate(() => fixture.child.stdout.write(Buffer.alloc(2048, 0x41)));
      return fixture.child;
    }
  });
  await assert.rejects(
    () => gateway.invokeRpc("desktop", "get_volume", {}),
    error => error.code === "RPC_BUFFER_OVERFLOW"
  );
  assert.equal(fixture.child.killed, true);
  assert.equal(fixture.child.killSignal, "SIGKILL");
});
