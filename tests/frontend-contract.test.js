import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => readFileSync(resolve(root, name), "utf8");

test("frontend JavaScript parses under the project's Node module mode", () => {
  for (const file of ["public/ultron-app.js", "public/ultron-core.js"]) {
    const result = spawnSync(process.execPath, ["--check", resolve(root, file)], { encoding: "utf8" });
    assert.equal(result.status, 0, file + " syntax error:\n" + (result.stderr || result.stdout));
  }
});

test("Express-served HTML references the new same-origin frontend assets", () => {
  const html = read("public/index.html");
  assert.match(html, /href="\/ultron\.css"/);
  assert.match(html, /src="\/ultron-app\.js"/);
  assert.match(html, /id="viewContent"/);
  assert.match(html, /id="authGate"/);
});

test("all specified workspaces have real navigation entries and render routes", () => {
  const html = read("public/index.html");
  const app = read("public/ultron-app.js");
  for (const page of ["home", "chat", "voice", "tasks", "coding", "research", "files", "memory", "integrations", "automation", "security", "system", "settings"]) {
    assert.ok(html.includes('data-nav="' + page + '"'), "missing nav entry: " + page);
    assert.ok(app.includes(page + ":"), "missing view mapping: " + page);
  }
});

test("frontend calls only established API path families and does not embed provider secrets", () => {
  const app = read("public/ultron-app.js");
  for (const path of [
    "/health", "/session", "/models", "/chat", "/conversations", "/memory",
    "/preferences", "/tasks", "/runtime/readiness", "/worker/status", "/capabilities",
    "/research", "/documents/extract", "/coding/assist", "/speech/synthesize", "/speech/transcribe",
    "/integrations/catalog", "/integrations/voicestudio/status", "/employees/schedules"
  ]) {
    assert.ok(app.includes('"' + path + '"') || app.includes("'" + path + "'"), "missing API path: " + path);
  }
  assert.doesNotMatch(app, /SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*["'][^"']+["']/);
  assert.doesNotMatch(app, /OPENROUTER_API_KEY\s*[:=]\s*["'][^"']+["']/);
});

test("core quality settings rebuild the particle geometry and preserve a fallback", () => {
  const core = read("public/ultron-core.js");
  assert.match(core, /WebGLRenderer/);
  assert.match(core, /rebuildParticleClouds\(options\.particles\)/);
  assert.match(core, /fallbackCore\(host/);
  assert.match(core, /webglcontextlost/);
});
