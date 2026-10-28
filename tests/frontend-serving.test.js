import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server.js";

test("Express serves the command center and its assets from the same origin", async t => {
  const server = createApp({ env: { NODE_ENV: "test" } }).listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  t.after(() => new Promise(resolve => {
    server.close(resolve);
    server.closeAllConnections?.();
  }));

  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;

  const indexResponse = await fetch(base + "/");
  assert.equal(indexResponse.status, 200);
  assert.match(indexResponse.headers.get("content-type") || "", /text\/html/i);
  const html = await indexResponse.text();
  assert.match(html, /ULTRON AI — Command Center/);
  assert.match(html, /href="\/styles\.css"/);
  assert.match(html, /src="\/app\.js"/);

  const [jsResponse, cssResponse, healthResponse] = await Promise.all([
    fetch(base + "/app.js"),
    fetch(base + "/styles.css"),
    fetch(base + "/api/health")
  ]);
  assert.equal(jsResponse.status, 200);
  assert.match(jsResponse.headers.get("content-type") || "", /javascript/i);
  assert.match(await jsResponse.text(), /\/api\/chat/);
  assert.equal(cssResponse.status, 200);
  assert.match(await cssResponse.text(), /\.energy-core/);
  assert.equal(healthResponse.status, 200);
});
