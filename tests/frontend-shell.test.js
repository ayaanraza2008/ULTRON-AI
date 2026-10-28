import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");
const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const server = readFileSync(new URL("../server.js", import.meta.url), "utf8");

test("command center exposes every primary ULTRON workspace", () => {
  for (const view of ["home", "chat", "tasks", "research", "coding", "voice", "files", "memory", "automation", "integrations", "security", "system", "settings"]) {
    assert.match(html, new RegExp('data-view="' + view + '"'));
    assert.match(app, new RegExp(view + ":"));
  }
  assert.match(html, /id="view-root"/);
  assert.match(html, /id="particle-field"/);
  assert.match(app, /class="energy-core"/);
});

test("frontend calls same-origin backend routes instead of exposing provider secrets", () => {
  for (const route of [
    "/api/health", "/api/session", "/api/capabilities", "/api/chat", "/api/models",
    "/api/conversations", "/api/tasks", "/api/research", "/api/coding/assist",
    "/api/documents/extract", "/api/documents/upload", "/api/memory",
    "/api/preferences", "/api/employees/schedules", "/api/integrations",
    "/api/worker/status", "/api/runtime/readiness"
  ]) {
    assert.ok(app.includes(route), "Missing backend integration: " + route);
  }
  assert.doesNotMatch(html, /<script[^>]+src=["']https?:/i);
  assert.doesNotMatch(app, /(?:sk-[A-Za-z0-9]{20,}|sk-or-v1-[A-Za-z0-9]{20,})/);
  assert.match(app, /credentials: "same-origin"/);
  assert.match(app, /eventName === "provider_error"/);
});

test("visual shell is responsive and honors reduced-motion preference", () => {
  assert.match(css, /.energy-core/);
  assert.match(css, /.core-ring/);
  assert.match(css, /@media\(max-width:760px\)/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(css, /:focus-visible/);
});

test("Express serves the new frontend from the public asset directory", () => {
  assert.match(html, /href="\/styles\.css"/);
  assert.match(html, /src="\/app\.js"/);
  assert.match(server, /express\.static\(path\.join\(__dirname, "public"\)/);
});
