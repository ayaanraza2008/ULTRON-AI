import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server.js";

async function startApp(t) {
  const app = createApp({ env: { NODE_ENV: "test" }, logger: { info() {}, warn() {}, error() {} } });
  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
    instance.once("error", reject);
  });
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  return `http://127.0.0.1:${server.address().port}`;
}

test("the live command interface is served by the existing backend origin", async (t) => {
  const base = await startApp(t);
  const response = await fetch(base + "/");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") || "", /text\/html/);
  assert.match(response.headers.get("cache-control") || "", /no-store/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-powered-by"), null);
  assert.match(response.headers.get("content-security-policy") || "", /script-src 'self'/);
  assert.match(response.headers.get("permissions-policy") || "", /camera=\(self\)/);
  assert.match(await response.text(), /ULTRON AI — Living Core/);
});

test("all required UI assets are served as same-origin static files", async (t) => {
  const base = await startApp(t);
  const cases = [
    ["/app.js", /javascript/],
    ["/styles.css", /text\/css/],
    ["/favicon.svg", /image\/svg\+xml/]
  ];
  for (const [asset, expectedType] of cases) {
    const response = await fetch(base + asset);
    assert.equal(response.status, 200, asset);
    assert.match(response.headers.get("content-type") || "", expectedType, asset);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    const body = await response.text();
    assert.ok(body.length > 100, asset);
  }
});

test("Living Core exposes notes, reminders and study-library routes in the navigation", async (t) => {
  const base = await startApp(t);
  const html = await (await fetch(base + "/")).text();
  assert.match(html, /data-drawer-view="employees"/);
  assert.match(html, /data-drawer-view="documents"/);
  assert.match(html, /data-drawer-view="memory"/);
  assert.match(html, /data-drawer-view="models"/);
  assert.match(html, /data-drawer-view="preferences"/);
  assert.match(html, /data-drawer-view="history"/);
  assert.match(html, /data-drawer-view="notes"/);
  assert.match(html, /data-drawer-view="reminders"/);
  assert.match(html, /data-drawer-view="study"/);
  const app = await (await fetch(base + "/app.js")).text();
  assert.match(app, /api\/employees\/schedules/);
  assert.match(app, /api\/documents\/upload/);
  assert.match(app, /api\/documents\/.*\/download/);
  assert.match(app, /api\/memory/);
  assert.match(app, /api\/models/);
  assert.match(app, /api\/runtime\/readiness/);
  assert.match(app, /Capability readiness matrix/);
  assert.match(app, /api\/preferences/);
  assert.match(app, /api\/conversations/);
  assert.match(app, /api\/notes/);
  assert.match(app, /api\/reminders/);
  assert.match(app, /api\/study-packs/);
  assert.match(app, /GENERATE \+ SAVE STUDY PACK/);
});

test("static serving does not expose dotfiles or change API route behavior", async (t) => {
  const base = await startApp(t);
  const hidden = await fetch(base + "/.gitignore");
  assert.equal(hidden.status, 404);

  const unknown = await fetch(base + "/missing-ui-asset.js");
  assert.equal(unknown.status, 404);

  const health = await fetch(base + "/api/health");
  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, "ok");
});
