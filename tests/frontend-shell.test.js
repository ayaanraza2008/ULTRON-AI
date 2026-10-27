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

test("frontend calls implemented backend routes and accurately labels capabilities", () => {
  for (const path of ["/api/health", "/api/runtime/readiness", "/api/session", "/api/chat", "/api/models", "/api/conversations", "/api/memory", "/api/integrations", "/api/preferences", "/api/worker/status"]) {
    assert.ok(js.includes(path), "Missing verified API contract: " + path);
  }
  assert.match(js, /tasks:true/);
  assert.match(js, /research:true/);
  assert.match(js, /coding:true/);
  assert.match(js, /documents:true/);
  assert.match(js, /automation:true/);
  assert.match(js, /agentTools:true/);
  for (const path of ["/api/tasks", "/api/research", "/api/coding/assist", "/api/documents/extract", "/api/employees/schedules", "/api/kaligpt/tools"]) {
    assert.ok(js.includes(path), "Missing implemented backend integration: " + path);
  }
  assert.doesNotMatch(js, /(?:sk-[A-Za-z0-9]{20,}|sk-or-v1-[A-Za-z0-9]{20,})/);
  assert.match(js, /WEBGL/);
  assert.match(js, /prefers-reduced-motion/);
  assert.match(js, /cancel-chat|cancel-stream/);
  assert.match(js, /Routine low-risk research and draft\/report tasks can queue automatically/);
  assert.match(js, /saveDocumentToMemory/);
  assert.match(js, /Save extracted text/);
  assert.match(js, /source:"document"/);
  assert.match(js, /Save original file privately/);
  assert.match(js, /\/api\/documents\/upload/);
  assert.ok(js.includes('"/api/documents/"+encodeURIComponent(id)+"/download'));
  assert.ok(js.includes('"/api/documents/"+encodeURIComponent(id)'));
  assert.match(js, /Private document vault/);
  assert.match(js, /Original files are never public/);
  assert.match(js, /original file is not retained/);
  assert.match(js, /Non-routine or higher-risk tasks require approval/);
});

test("frontend respects responsive layout and reduced motion settings", () => {
  assert.match(css, /@media/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /energy-canvas/);
});
