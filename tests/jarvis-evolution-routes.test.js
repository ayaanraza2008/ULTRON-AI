import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { createJarvisRouter } from "../jarvis-router.js";

async function withRouter({ env = { ULTRON_INTEGRATION_OWNER_USER_ID: "owner-user" }, userId = "owner-user" } = {}, run) {
  const app = express();
  const requireSupabaseUser = (req, _res, next) => {
    req.supabaseUser = { id: userId };
    next();
  };
  app.use(express.json());
  app.use("/api", createJarvisRouter({ env, requireSupabaseUser }));
  const server = createServer(app);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  try {
    await run("http://127.0.0.1:" + address.port);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test("JARVIS Self-Evolution Routes: POST /api/jarvis/evolution/audit runs self-audit", async () => {
  await withRouter({}, async base => {
    const res = await fetch(base + "/api/jarvis/evolution/audit", { method: "POST" });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.ok(body.audit.id.startsWith("audit-"));
    assert.ok(body.audit.healthScore >= 0);
  });
});

test("JARVIS Self-Evolution Routes: POST /api/jarvis/evolution/command handles natural language intent", async () => {
  await withRouter({}, async base => {
    const res = await fetch(base + "/api/jarvis/evolution/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "Ultron, audit yourself" })
    });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.result.intent, "SELF_AUDIT");
    assert.ok(body.result.audit);
  });
});

test("JARVIS Self-Evolution Routes: GET /api/jarvis/evolution/history returns history records", async () => {
  await withRouter({}, async base => {
    const res = await fetch(base + "/api/jarvis/evolution/history");
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.ok(Array.isArray(body.history.audits));
    assert.ok(Array.isArray(body.history.plans));
    assert.ok(Array.isArray(body.history.changes));
  });
});
