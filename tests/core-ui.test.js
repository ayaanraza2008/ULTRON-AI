import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createUltronCoreProxy } from "../core-ui-proxy.mjs";

const serverSource = await readFile(new URL("../server.js", import.meta.url), "utf8");
const proxySource = await readFile(new URL("../core-ui-proxy.mjs", import.meta.url), "utf8");

async function startProxy(t, options = {}) {
  const proxy = createUltronCoreProxy(options);
  await new Promise((resolve, reject) => {
    proxy.once("error", reject);
    proxy.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise(resolve => {
    proxy.closeAllConnections?.();
    proxy.close(() => resolve());
  }));
  return "http://127.0.0.1:" + proxy.address().port;
}

test("backend serves its public command-center shell while the compatibility proxy stays API-only", () => {
  assert.ok(serverSource.includes("app.use(express.static(publicDir, {"));
  assert.ok(!serverSource.includes('app.use("/voice"'));
  assert.ok(serverSource.includes('app.get("/service-worker.js"'));
  assert.ok(!proxySource.includes("STATIC_ASSETS"));
  assert.ok(!proxySource.includes("serveAsset"));
  assert.ok(serverSource.includes('app.get("/", (_req, res, next) =>'));
  assert.ok(serverSource.includes("ultron-core-shell-"));
});

test("API proxy health remains available and the root is API-only", async t => {
  const base = await startProxy(t);
  const health = await fetch(base + "/healthz");
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok", service: "ultron-api-proxy" });
  const root = await fetch(base + "/");
  assert.equal(root.status, 404);
  assert.equal((await root.json()).error.code, "FRONTEND_REMOVED");
});

test("HTML, JS, CSS, manifest and icon paths are no longer served", async t => {
  const calls = [];
  const base = await startProxy(t, { fetchImpl: async (...args) => {
    calls.push(args);
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  }});
  for (const path of ["/index.html", "/app.js", "/styles.css", "/manifest.webmanifest", "/icons/icon-512.png"]) {
    const response = await fetch(base + path);
    assert.equal(response.status, 404, path);
    assert.equal((await response.json()).error.code, "FRONTEND_REMOVED", path);
  }
  assert.equal(calls.length, 0);
});

test("legacy PWA service worker unregisters itself and clears only ULTRON shell caches", async t => {
  const base = await startProxy(t);
  const response = await fetch(base + "/service-worker.js");
  assert.equal(response.status, 200);
  assert.ok((response.headers.get("content-type") || "").startsWith("application/javascript"));
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  const script = await response.text();
  assert.ok(script.includes("self.registration.unregister()"));
  assert.ok(script.includes('key.startsWith("ultron-core-shell-")'));
  assert.ok(script.includes("client.navigate(client.url)"));
  assert.ok(script.includes('cacheKeys.filter(key => key.startsWith("ultron-core-shell-")).map(key => caches.delete(key))'));
  assert.equal((script.match(/caches\.delete/g) || []).length, 1);
});

test("API proxy preserves auth cookies and uses the fixed backend origin", async t => {
  const calls = [];
  const base = await startProxy(t, { fetchImpl: async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ status: "ok", app: "ULTRON AI" }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8", "Set-Cookie": "ultron_sb_access=test-response; HttpOnly; Path=/; SameSite=Lax" }
    });
  }});
  const response = await fetch(base + "/api/health?check=1", { headers: { Cookie: "ultron_sb_access=test-request" }});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok", app: "ULTRON AI" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://ultron-ai-core.onrender.com/api/health?check=1");
  assert.equal(calls[0].init.headers.get("cookie"), "ultron_sb_access=test-request");
  assert.match(response.headers.get("set-cookie") || "", /ultron_sb_access=test-response/);
});

test("Jarvis APIs remain proxied but browser-only world-intelligence routes are removed", async t => {
  const calls = [];
  const base = await startProxy(t, { fetchImpl: async url => {
    calls.push(String(url));
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  }});
  const response = await fetch(base + "/jarvis/capabilities");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true });
  assert.equal(calls[0], "https://ultron-ai-core.onrender.com/jarvis/capabilities");
  const world = await fetch(base + "/world-intelligence");
  assert.equal(world.status, 404);
  assert.equal(calls.length, 1);
});

test("structured API errors are not retried; transient non-JSON gateway errors are retried", async t => {
  let calls = 0;
  const base = await startProxy(t, { gatewayRetryDelaysMs: [0], fetchImpl: async () => {
    calls++;
    if (calls === 1) return new Response("<html>502</html>", { status: 502, headers: { "Content-Type": "text/html" }});
    return new Response(JSON.stringify({ status: "ok" }), { status: 200, headers: { "Content-Type": "application/json" }});
  }});
  const response = await fetch(base + "/api/health");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
  assert.equal(calls, 2);
});
