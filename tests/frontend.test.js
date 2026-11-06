import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createApp } from "../server.js";
import { particleCountForViewport, generateParticleData } from "../public/particle-swarm-engine.js";

const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
const appSource = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

async function withApp(run) {
  const app = createApp({ env: {}, logger: { info() {}, warn() {}, error() {} } });
  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
    instance.once("error", reject);
  });
  try {
    await run("http://127.0.0.1:" + server.address().port);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test("home route serves the custom black ULTRON command center", async () => {
  await withApp(async base => {
    const response = await fetch(base + "/");
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") || "", /text\/html/);
    const body = await response.text();
    assert.match(body, /ULTRON AI/);
    assert.match(body, /energy-core/);
    assert.match(body, /voice-mode/);
    assert.match(body, /text-mode/);
  });
});

test("backend serves tracked frontend assets and retains its API health route", async () => {
  await withApp(async base => {
    for (const [url, mime] of [
      ["/styles.css", /text\/css/],
      ["/app.js", /javascript/],
      ["/particle-swarm-engine.js", /javascript/],
      ["/favicon.svg", /image\/svg\+xml/]
    ]) {
      const response = await fetch(base + url);
      assert.equal(response.status, 200, url);
      assert.match(response.headers.get("content-type") || "", mime);
    }
    const health = await fetch(base + "/api/health");
    assert.equal(health.status, 200);
    assert.equal((await health.json()).status, "ok");
  });
});

test("visual design is black, purple-crimson, responsive and reduced-motion aware", () => {
  assert.match(css, /--black:\s*#050308/i);
  assert.match(css, /--violet:\s*#a06aff/i);
  assert.match(css, /--crimson:\s*#f03f78/i);
  assert.match(css, /max-width:\s*760px/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(html, /class="drawer"/);
  assert.match(html, /id="settings-drawer"/);
});

test("frontend wires existing same-origin auth, chat, memory and activity APIs", () => {
  for (const route of [
    "/api/session",
    "/api/auth/signin",
    "/api/chat",
    "/api/conversations",
    "/api/memory",
    "/api/documents/upload",
    "/api/jarvis/agents/task",
    "/api/preferences",
    "/api/models",
    "/api/jarvis/tools",
    "/api/jarvis/agents/tasks"
  ]) assert.ok(appSource.includes(route), "missing route " + route);
  assert.match(appSource, /composer\.hidden\s*=\s*state\.mode\s*!==\s*"text"/);
  assert.match(appSource, /credentials:\s*"same-origin"/);
});

test("settings and activity drawers expose real conversation, memory, document and employee-task controls", () => {
  for (const id of ["conversation-list", "memory-form", "memory-items", "task-form", "task-role", "task-mode", "document-input", "document-list"]) {
    assert.ok(html.includes('id="' + id + '"'), "missing control " + id);
  }
  for (const route of ["/api/memory", "/api/documents/upload", "/api/jarvis/agents/task", "/api/conversations/"]) {
    assert.ok(appSource.includes(route), "missing data route " + route);
  }
  assert.match(appSource, /The task is queued, not completed/);
});

test("the core stop control aborts in-flight chat requests and auth overlay makes the main app inert", () => {
  assert.ok(appSource.includes("state.requestController?.abort()"));
  assert.ok(appSource.includes("signal: state.requestController.signal"));
  assert.ok(appSource.includes('error?.name === "AbortError"'));
  assert.ok(appSource.includes("app.inert = true"));
  assert.ok(appSource.includes("app.inert = false"));
  assert.ok(html.includes('role="dialog" aria-modal="true"'));
});

test("particle count adapts to mobile and desktop viewports", () => {
  assert.equal(particleCountForViewport(390), 12000);
  assert.equal(particleCountForViewport(700), 16000);
  assert.equal(particleCountForViewport(1280), 20000);
});

test("20,000-particle swarm buffers contain deterministic finite coordinates", () => {
  const first = generateParticleData(20000, 12345);
  const second = generateParticleData(20000, 12345);
  assert.equal(first.length, 80000);
  assert.deepEqual(first, second);
  for (const value of first) assert.ok(Number.isFinite(value));
});
