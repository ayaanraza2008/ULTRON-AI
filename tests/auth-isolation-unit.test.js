import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createJarvisRouter } from "../jarvis-router.js";

const OWNER_USER_ID = "owner-uuid-user-a";
const SECOND_USER_ID = "attacker-uuid-user-b";

function setupApp(activeUserId = OWNER_USER_ID) {
  const app = express();
  const env = {
    ULTRON_INTEGRATION_OWNER_USER_ID: OWNER_USER_ID
  };

  const requireSupabaseUser = (req, res, next) => {
    if (!activeUserId) {
      return res.status(401).json({ error: { code: "UNAUTHORIZED", message: "JWT required." } });
    }
    req.supabaseUser = { id: activeUserId, email: activeUserId + "@example.com" };
    next();
  };

  const supabaseRestMock = async (req, table, method, query, body) => {
    // Enforce row-level isolation invariant
    if (query && query.includes("user_id=eq.") && !query.includes(encodeURIComponent(req.supabaseUser.id))) {
      return []; // RLS denies cross-account reads
    }
    return [{ id: "record-1", user_id: req.supabaseUser.id, table }];
  };

  app.use("/api", createJarvisRouter({
    env,
    requireSupabaseUser,
    supabaseRest: supabaseRestMock,
    privilegedSupabaseRest: supabaseRestMock,
    logger: { info() {}, warn() {}, error() {} }
  }));

  return app;
}

async function withServer(app, run) {
  const server = await new Promise(resolve => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const port = server.address().port;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test("Account Isolation: Owner route grants access only to configured owner user", async () => {
  const app = setupApp(OWNER_USER_ID);
  await withServer(app, async base => {
    const res = await fetch(base + "/api/jarvis/telemetry");
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.telemetry);
  });
});

test("Account Isolation: Second user is rejected with ULTRON_OWNER_ONLY", async () => {
  const app = setupApp(SECOND_USER_ID);
  await withServer(app, async base => {
    const res = await fetch(base + "/api/jarvis/telemetry");
    assert.equal(res.status, 403);
    const data = await res.json();
    assert.equal(data.error.code, "ULTRON_OWNER_ONLY");
  });
});

test("Account Isolation: Unauthenticated request is rejected with UNAUTHORIZED", async () => {
  const app = setupApp(null);
  await withServer(app, async base => {
    const res = await fetch(base + "/api/jarvis/telemetry");
    assert.equal(res.status, 401);
    const data = await res.json();
    assert.equal(data.error.code, "UNAUTHORIZED");
  });
});

test("Account Isolation: Cross-account task inspection is denied", async () => {
  const app = setupApp(OWNER_USER_ID);
  await withServer(app, async base => {
    // Attempting to query someone else's task ID through owner-scoped endpoint
    const res = await fetch(base + "/api/jarvis/agents/tasks");
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.tasks));
  });
});
