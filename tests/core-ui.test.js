import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createUltronCoreProxy } from "../core-ui-proxy.mjs";

const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const proxySource = await readFile(new URL("../core-ui-proxy.mjs", import.meta.url), "utf8");

test("the default screen is a black, minimal living-core interface", () => {
  assert.match(html, /id="core-canvas"/);
  assert.match(html, /id="core-stage"/);
  assert.match(css, /--black:\s*#020205/);
  assert.match(css, /\.core-orbit/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(app, /drawArrays\(gl\.POINTS, 0, PARTICLE_COUNT\)/);
  assert.match(app, /const PARTICLE_COUNT = 20000/);
  assert.match(app, /#version 300 es/);
  assert.match(app, /gl_VertexID/);
});

test("center label is removed without crashing core initialization", () => {
  assert.doesNotMatch(html, /class="core-wordmark"/);
  assert.doesNotMatch(html, /class="core-word"/);
  assert.ok(app.includes("if (ui.coreStateLabel) ui.coreStateLabel.textContent"));
  assert.ok(app.includes('setCoreState("idle");\n  startParticleCore();'));
});

test("the glass drawer includes eyes, tools, devices, and readiness panels", () => {
  assert.match(html, /id="drawer-toggle"/);
  assert.match(html, /id="feature-drawer"/);
  for (const feature of ["eyes", "tasks", "apps", "devices", "control", "system"]) {
    assert.ok(html.includes('data-drawer-view="' + feature + '"'));
  }
  assert.ok(app.includes("function showDrawerView"));
  assert.ok(app.includes("function addCustomConnectorBrief"));
  assert.ok(app.includes("function checkBackend"));
});

test("full system control is an explicit scoped request, never a fake takeover", () => {
  assert.match(html, /data-drawer-view="control"/);
  assert.ok(app.includes('if (name === "control")'));
  assert.ok(app.includes('requestButton.textContent = "REQUEST CONTROL SESSION"'));
  assert.ok(app.includes('requestButton.disabled = selected.size === 0 || !desktopConfigured'));
  assert.ok(app.includes("Status: PREPARED ONLY — NOT ACTIVE"));
  assert.ok(app.includes("current companion adapter is read-only"));
  assert.match(css, /\.system-control-nav/);
});

test("camera access is explicitly permissioned and camera frames can reach vision chat", () => {
  assert.match(html, /id="eye-video"/);
  assert.match(html, /id="camera-live-observe"/);
  assert.ok(app.includes("navigator.mediaDevices.getUserMedia"));
  assert.ok(app.includes("function captureCameraFrame"));
  assert.ok(app.includes("function analyzeCameraFrame"));
  assert.ok(app.includes('[{ dataUrl }]'));
  assert.ok(app.includes("...(attachments.length ? { attachments } : {})"));
  assert.ok(proxySource.includes("camera=(self)"));
  assert.ok(proxySource.includes("microphone=(self)"));
});

test("API errors are explicit instead of crashing the interface silently", () => {
  assert.ok(app.includes("CORE_LINK_FAILED"));
  assert.ok(app.includes("ACCESS SETUP REQUIRED"));
  assert.ok(app.includes("MODEL PROVIDER NOT READY"));
  assert.ok(app.includes("VISION_MODEL_NOT_CONFIGURED"));
});

test("voice mode hides the text box by default and offers an optional open-input control", () => {
  assert.match(html, /id="message-form" class="message-shell" hidden/);
  assert.match(html, /id="open-text-input"/);
  assert.match(app, /ui\.messageForm\.hidden = !composerVisible/);
  assert.match(app, /const composerVisible = mode === "text" \|\| textInputOpen/);
  assert.match(app, /function openOptionalTextInput/);
  assert.match(app, /instance\.continuous = true/);
  assert.match(app, /instance\.interimResults = true/);
  assert.match(app, /scheduleRecognitionRestart/);
});

test("mute is only visible and actionable in Text Mode", () => {
  assert.match(html, /id="mute-toggle"[^>]*hidden/);
  assert.match(app, /ui\.muteToggle\.hidden = mode !== "text"/);
  assert.match(app, /function toggleMute\(\) \{\s*if \(mode !== "text"\) return;/);
  assert.match(app, /function speakResponse/);
});

test("tasks render transient holographic panels with real sources and completion states", () => {
  assert.match(html, /id="task-panel"[^>]*hidden/);
  assert.match(app, /function openTaskPanel/);
  assert.match(app, /function markTaskComplete/);
  assert.match(app, /function schedulePanelHide/);
  assert.ok(app.includes('apiRequest("/api/research"'));
  assert.match(app, /safeUrl\.protocol !== "https:"/);
  assert.match(css, /\.holo-panel\[hidden\]/);
});

test("the interface uses same-origin backend requests and a fixed ULTRON CORE upstream", () => {
  assert.match(app, /credentials: "same-origin"/);
  assert.match(proxySource, /https:\/\/ultron-ai-core\.onrender\.com/);
  assert.match(proxySource, /requestUrl\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(proxySource, /new URL\(requestUrl\.pathname \+ requestUrl\.search, CORE_API_ORIGIN\)/);
  assert.match(proxySource, /forwardedRequestHeaders/);
  assert.match(proxySource, /getSetCookie/);
  assert.doesNotMatch(html, /<script[^>]+src=["']https?:/i);
});

test("the proxy serves local assets and does not forward unknown public paths", async (t) => {
  const calls = [];
  const proxy = createUltronCoreProxy({
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ status: "ok", app: "ULTRON AI" }), {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" }
      });
    },
    logger: { warn() {} }
  });
  await new Promise((resolve, reject) => {
    proxy.once("error", reject);
    proxy.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise(resolve => proxy.close(() => resolve())));
  const address = proxy.address();
  const base = "http://127.0.0.1:" + address.port;

  const page = await fetch(base + "/");
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type") || "", /text\/html/);
  assert.match(await page.text(), /ULTRON AI — Living Core/);
  assert.equal(calls.length, 0);

  const unknown = await fetch(base + "/admin-secret");
  assert.equal(unknown.status, 404);
  assert.equal(calls.length, 0);

  const health = await fetch(base + "/api/health", { headers: { Cookie: "ultron_sb_access=test-cookie" } });
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok", app: "ULTRON AI" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://ultron-ai-core.onrender.com/api/health");
  assert.equal(calls[0].init.headers.get("cookie"), "ultron_sb_access=test-cookie");
});
