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

test("backend stays API-only while the interface proxy serves an explicit static allowlist", () => {
  assert.doesNotMatch(serverSource, /express\.static\s*\(/);
  assert.doesNotMatch(serverSource, /app\.use\s*\(\s*["']\/voice["']/);
  assert.match(proxySource, /STATIC_ASSETS/);
  assert.match(proxySource, /serveAsset/);
  assert.ok(proxySource.includes('"/particle-swarm-engine.js"'));
  assert.ok(proxySource.includes('"/core-only.css"'));
  assert.ok(proxySource.includes('requestUrl.pathname === "/service-worker.js"'));
  assert.ok(proxySource.includes("ultron-core-shell-"));
});


test("Agora RTC SDK is allowed by the interface proxy security policy", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /download\.agora\.io\/sdk\/release\/AgoraRTC_N-4\.24\.8\.js/);
  assert.match(proxySource, /script-src 'self' https:\/\/download\.agora\.io/);
  assert.match(proxySource, /connect-src 'self' https: wss:/);
});

test("mobile image attachment requests the rear camera when available", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /id="image-input"[^>]*capture="environment"/);
  assert.match(html, /aria-label="Capture or attach an image"/);
});

test("center-only shell keeps the core as the only visible application surface", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const css = await readFile(new URL("../public/core-only.css", import.meta.url), "utf8");
  assert.ok(html.includes('href="/core-only.css"'));
  assert.ok(html.includes('id="core-wrap"'));
  assert.ok(html.includes('id="energy-core"'));
  assert.ok(css.includes(".topbar") && css.includes("display: none !important"));
  assert.ok(css.includes(".interaction-dock"));
  assert.ok(css.includes("width: min(88vmin, 920px)"));
  assert.ok(css.includes("font-family: Arial, \"Segoe UI\", Helvetica, sans-serif !important"));
});


test("interface security policy keeps scripts, APIs, and frames same-origin until optional vision assets ship", async t => {
  const base = await startProxy(t);
  const response = await fetch(base + "/healthz");
  const csp = response.headers.get("content-security-policy") || "";
  const permissions = response.headers.get("permissions-policy") || "";
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /connect-src 'self'/);
  assert.match(csp, /frame-src 'self'/);
  assert.doesNotMatch(csp, /cdn\\.jsdelivr\\.net|storage\\.googleapis\\.com|ultron-world-intelligence/);
  assert.match(permissions, /camera=\\(self\\)/);
  assert.match(permissions, /microphone=\\(self\\)/);
});

test("interface root and API proxy health are both available", async t => {
  const base = await startProxy(t);
  const health = await fetch(base + "/healthz");
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok", service: "ultron-api-proxy" });
  const root = await fetch(base + "/");
  assert.equal(root.status, 200);
  assert.match(root.headers.get("content-type") || "", /^text\/html/);
  assert.match(await root.text(), /ULTRON AI/);
});

test("required core interface assets are served locally without reaching the API", async t => {
  const calls = [];
  const base = await startProxy(t, { fetchImpl: async (...args) => {
    calls.push(args);
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  }});
  const expected = [
    ["/index.html", "text/html"],
    ["/app.js", "javascript"],
    ["/styles.css", "text/css"],
    ["/core-only.css", "text/css"],
    ["/particle-swarm-engine.js", "javascript"],
    ["/favicon.svg", "image/svg+xml"]
  ];
  for (const [path, type] of expected) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200, path);
    assert.ok((response.headers.get("content-type") || "").includes(type), path);
    assert.ok((await response.arrayBuffer()).byteLength > 0, path);
  }
  const missing = await fetch(base + "/manifest.webmanifest");
  assert.equal(missing.status, 404);
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
