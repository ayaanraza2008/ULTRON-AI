import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

test("server exits cleanly after SIGTERM instead of leaving its listener open", async () => {
  const port = await freePort();
  const script = fileURLToPath(new URL("../server.js", import.meta.url));
  const child = spawn(process.execPath, [script], {
    env: { ...process.env, PORT: String(port), NODE_ENV: "test", ULTRON_EMPLOYEES_ENABLED: "false" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", chunk => { output += chunk.toString(); });
  child.stderr.on("data", chunk => { output += chunk.toString(); });

  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Server did not become ready in time. Output: " + output.slice(-1200))), 15000);
      const clear = () => clearTimeout(timer);
      const checkReady = () => {
        if (output.includes("ULTRON AI listening on port")) { clear(); resolve(); }
      };
      child.stdout.on("data", checkReady);
      child.once("error", error => { clear(); reject(error); });
      child.once("exit", (code, signal) => {
        clear();
        reject(new Error("Server exited before readiness (" + (signal || code) + "). Output: " + output.slice(-1200)));
      });
    });

    const exited = new Promise(resolve => child.once("exit", (code, signal) => resolve({ code, signal })));
    child.kill("SIGTERM");
    const result = await Promise.race([
      exited,
      new Promise(resolve => setTimeout(() => resolve({ timedOut: true }), 5000))
    ]);
    assert.notEqual(result.timedOut, true, "server must stop accepting requests and exit after SIGTERM");
    assert.equal(result.signal, null);
    assert.equal(result.code, 0);
    assert.match(output, /draining HTTP connections/);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
});
