import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");
const js = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

test("frontend shell loads local assets and includes every workspace", () => {
  assert.match(html, /id="view-root"/);
  assert.match(html, /\/styles\.css/);
  assert.match(html, /\/app\.js/);
  for (const view of ["home", "chat", "tasks", "voice", "coding", "research", "files", "memory", "integrations", "automation", "security", "system", "settings"]) {
    assert.match(html, new RegExp('data-view="' + view + '"'));
  }
});

test("frontend uses real backend contracts and does not embed provider credentials", () => {
  for (const path of ["/api/health", "/api/capabilities", "/api/session", "/api/chat", "/api/tasks", "/api/research", "/api/coding/assist", "/api/documents/extract", "/api/memory", "/api/integrations", "/api/employees/schedules", "/api/preferences"]) {
    assert.ok(js.includes(path), "Missing API contract: " + path);
  }
  assert.doesNotMatch(js, /(?:sk-[A-Za-z0-9]{20,}|sk-or-v1-[A-Za-z0-9]{20,})/);
  assert.match(js, /WEBGL/);
  assert.match(js, /prefers-reduced-motion/);
  assert.match(js, /cancel-chat|cancel-stream/);
});

test("frontend respects responsive layout and reduced motion settings", () => {
  assert.match(css, /@media/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /energy-canvas/);
});
