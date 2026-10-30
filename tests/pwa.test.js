import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = relative => readFile(path.join(root, relative), "utf8");

test("ULTRON web manifest declares a root-scoped installable cross-device app", async () => {
  const manifest = JSON.parse(await read("public/manifest.webmanifest"));
  assert.equal(manifest.name, "ULTRON AI");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.theme_color, "#020205");
  assert.ok(manifest.icons.some(icon => icon.src === "/icons/ultron-192.png" && icon.sizes === "192x192"));
  assert.ok(manifest.icons.some(icon => icon.src === "/icons/ultron-512.png" && icon.sizes === "512x512"));
});

test("service worker only caches the static shell and bypasses APIs and remote workspaces", async () => {
  const worker = await read("public/sw.js");
  assert.match(worker, /const CACHE_NAME = "ultron-shell-v2"/);
  assert.match(worker, /ultron-192\.png/);
  assert.match(worker, /ultron-512\.png/);
  assert.match(worker, /request\.method !== "GET"/);
  assert.match(worker, /url\.origin !== self\.location\.origin/);
  assert.match(worker, /url\.pathname === "\/api" \|\| url\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(worker, /world-intelligence/);
  assert.match(worker, /SHELL_URLS\.includes\(url\.pathname\)/);
  assert.match(worker, /caches\.match\("\/index\.html"\)/);
  assert.doesNotMatch(worker, /cache\.put\([^,]*\/api/);
});

test("web shell exposes an installation path and registers its root-scoped service worker", async () => {
  const html = await read("public/index.html");
  const app = await read("public/app.js");
  assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/);
  assert.match(html, /id="pwa-install"/);
  assert.match(html, /apple-touch-icon.*ultron-192\.png/);
  assert.match(app, /beforeinstallprompt/);
  assert.match(app, /Add to Home Screen/);
  assert.match(app, /serviceWorker\.register\("\/sw\.js", \{ scope: "\/" \}\)/);
  assert.match(app, /same account/);
});

test("web app instructions distinguish Android wake companion from full iOS web app", async () => {
  const app = await read("public/app.js");
  assert.match(app, /Android wake companion/);
  assert.match(app, /WAKE-WORD ONLY/);
  assert.match(app, /iPhone and iPad/);
  assert.match(app, /Open as Web App/);
});
