import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const OUTBOUND_CALLERS = [
  "server.js",
  "worker.js",
  "agent-runtime.js",
  "features.js",
  "agentmemory-integration.js",
  "integrations/desktop-companion.js",
  "integrations/hermes-agent.js",
  "integrations/obscura-mcp.js",
  "integrations/openviking.js",
  "integrations/paperclip-services.js",
  "integrations/productivity-services.js",
  "integrations/router.js",
  "integrations/voicestudio.js",
  "scripts/model-provider-smoke.mjs",
  "scripts/model-vision-smoke.mjs",
  "scripts/supabase-auth-diagnostics.mjs",
  "scripts/worker-smoke.mjs"
];

function sourceFor(path) {
  return readFileSync(new URL("../" + path, import.meta.url), "utf8");
}

test("server-side outbound callers default to the DNS-pinned transport", () => {
  for (const path of OUTBOUND_CALLERS) {
    const source = sourceFor(path);
    assert.match(
      source,
      /import\s*\{[^}]*\bsafePinnedFetch\b[^}]*\}\s*from\s*["'](?:\.\.\/|\.\/)*network-safety\.js["']/s,
      path + " must import the shared pinned transport"
    );
    assert.match(
      source,
      /\bfetchImpl\s*=\s*safePinnedFetch\b/,
      path + " must default injected HTTP calls to safePinnedFetch"
    );
  }
});

test("server-side outbound callers do not invoke the ambient global fetch directly", () => {
  for (const path of OUTBOUND_CALLERS) {
    const source = sourceFor(path);
    assert.doesNotMatch(
      source,
      /(?<![\w.$])fetch\s*\(/,
      path + " must use the injectable DNS-pinned transport, not ambient fetch()"
    );
    assert.doesNotMatch(
      source,
      /\bglobalThis\.fetch\s*\(/,
      path + " must not bypass the shared outbound policy through globalThis.fetch"
    );
  }
});
