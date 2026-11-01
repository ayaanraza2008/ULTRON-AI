import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const blueprint = await readFile(new URL("../render.yaml", import.meta.url), "utf8");

function serviceBlocks(yaml) {
  const lines = yaml.replace(/\r\n/g, "\n").split("\n");
  const starts = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (/^  - type: web\s*$/.test(lines[i])) starts.push(i);
  }
  return starts.map((start, index) => {
    const end = starts[index + 1] ?? lines.length;
    const text = lines.slice(start, end).join("\n");
    const name = text.match(/^    name:\s*([^\n#]+)/m)?.[1]?.trim();
    return { name, text };
  });
}

test("Render Blueprint maps exactly the four existing Ultron core services once", () => {
  const services = serviceBlocks(blueprint);
  assert.deepEqual(
    services.map(service => service.name),
    [
      "ultron-ai-core",
      "ultron-core-interface",
      "ultron-browser-use-core",
      "ultron-rea-gateway"
    ]
  );
  assert.equal(new Set(services.map(service => service.name)).size, 4);
  assert.equal(services.length, 4);
});

test("backend and interface health checks use routes served by their applications", () => {
  const services = Object.fromEntries(serviceBlocks(blueprint).map(item => [item.name, item.text]));
  assert.match(services["ultron-ai-core"], /healthCheckPath:\s*\/api\/health/);
  assert.match(services["ultron-core-interface"], /healthCheckPath:\s*\//);
  assert.match(services["ultron-core-interface"], /startCommand:\s*node core-ui-proxy\.mjs/);
  assert.match(services["ultron-ai-core"], /startCommand:\s*npm start/);
});

test("browser bridge targets the existing backend gateway and shares the backend token", () => {
  const services = Object.fromEntries(serviceBlocks(blueprint).map(item => [item.name, item.text]));
  const bridge = services["ultron-browser-use-core"];
  assert.match(bridge, /healthCheckPath:\s*\/health/);
  assert.match(bridge, /ULTRON_MODEL_GATEWAY_BASE_URL/);
  assert.match(bridge, /https:\/\/ultron-ai-core\.onrender\.com\/api\/internal\/browser-use\/v1/);
  assert.match(bridge, /fromService:\r?\n[ \t]+type:\s*web\r?\n[ \t]+name:\s*ultron-ai-core\r?\n[ \t]+envVarKey:\s*ULTRON_BROWSER_USE_TOKEN/);
  assert.match(services["ultron-ai-core"], /key:\s*ULTRON_BROWSER_USE_TOKEN\r?\n[ \t]+sync:\s*false/);
});

test("REA gateway blueprint satisfies its required runtime, secret and readiness contract", () => {
  const services = Object.fromEntries(serviceBlocks(blueprint).map(item => [item.name, item.text]));
  const rea = services["ultron-rea-gateway"];
  assert.match(rea, /runtime:\s*node/);
  assert.match(rea, /NODE_VERSION[\s\S]*?value:\s*24\.22\.1/);
  assert.match(rea, /REA_MCP_TOKEN[\s\S]*?generateValue:\s*true/);
  assert.match(rea, /healthCheckPath:\s*\/healthz/);
  assert.match(rea, /cd rea-gateway && npm install --omit=dev/);
  assert.match(rea, /cd rea-gateway && npm start/);
});

test("retired Fish Audio secrets and duplicate World Intelligence services are absent", () => {
  assert.doesNotMatch(blueprint, /FISH_API_KEY|FISH_AUDIO_|ULTRON_ENABLE_FISH_AUDIO/);
  assert.doesNotMatch(blueprint, /name:\s*ultron-world-intelligence(?:-globe|-live)?\s*$/m);
  assert.match(blueprint, /ULTRON_DEVICE_SIGNING_SECRET[\s\S]*?generateValue:\s*true/);
});
