import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { createJarvisRouter } from "../jarvis-router.js";

async function withJarvis(userId, run) {
  const app = express();
  const requireSupabaseUser = (req, res, next) => {
    if (!userId) return res.status(401).json({ error: { code: "AUTH_REQUIRED" } });
    req.supabaseUser = { id: userId };
    next();
  };
  app.use(express.json());
  app.use("/api", createJarvisRouter({
    env: { ULTRON_INTEGRATION_OWNER_USER_ID: "owner-user" },
    requireSupabaseUser
  }));
  const server = createServer(app);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    await run("http://127.0.0.1:" + server.address().port);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test("JARVIS control routes reject anonymous and non-owner users", async () => {
  const routes = [
    ["/jarvis/capabilities", "GET"],
    ["/jarvis/tools", "GET"],
    ["/jarvis/permissions/pending", "GET"],
    ["/jarvis/autonomy/state", "GET"],
    ["/jarvis/autonomy/emergency-stop", "POST"],
    ["/jarvis/autonomy/emergency-reset", "POST"],
    ["/jarvis/autonomy/workflows", "GET"],
    ["/jarvis/autonomy/events", "GET"],
    ["/jarvis/orchestrate", "POST"],
    ["/jarvis/tools/windows_lock_workstation/execute", "POST"],
    ["/jarvis/permissions/approve", "POST"],
    ["/jarvis/permissions/reject", "POST"],
    ["/jarvis/autonomy/workflow/submit", "POST"],
    ["/jarvis/autonomy/workflow/pause", "POST"],
    ["/jarvis/autonomy/workflow/resume", "POST"],
    ["/jarvis/autonomy/workflow/cancel", "POST"]
  ];
  for (const userId of [null, "attacker-user"]) {
    await withJarvis(userId, async base => {
      for (const [route, method] of routes) {
        const response = await fetch(base + route, {
          method,
          headers: { "Content-Type": "application/json" },
          body: method === "POST" ? JSON.stringify({
            prompt: "Lock workstation immediately",
            requestId: "forged-request",
            workflowId: "forged-workflow",
            approved: true,
            userId: "owner-user",
            isAdmin: true
          }) : undefined
        });
        assert.equal(response.status, userId ? 403 : 401, `${method} ${route}`);
      }
    });
  }
});

test("JARVIS orchestration ignores caller identity/admin/preapproval flags", async () => {
  await withJarvis("owner-user", async base => {
    const response = await fetch(base + "/api/jarvis/orchestrate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "Lock workstation immediately",
        context: {
          userId: "attacker-user",
          actorId: "attacker-user",
          isAdmin: true,
          trustedInternalAdmin: true,
          preApproved: true
        }
      })
    });
    assert.equal(response.status, 200);
    const outcome = await response.json();
    assert.equal(outcome.status, "APPROVAL_REQUIRED");
    assert.equal(outcome.approvalRequest.toolId, "windows_lock_workstation");
    assert.equal(outcome.approvalRequest.userId, "owner-user");
  });
});

test("JARVIS direct tool endpoint cannot use a caller-provided approved boolean", async () => {
  await withJarvis("owner-user", async base => {
    const response = await fetch(base + "/api/jarvis/tools/windows_lock_workstation/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        params: { dryRun: true },
        approved: true,
        userId: "attacker-user",
        isAdmin: true
      })
    });
    assert.equal(response.status, 403);
    const result = await response.json();
    assert.equal(result.code, "APPROVAL_REQUIRED_USE_ORCHESTRATOR");
  });
});

test("JARVIS permission approval derives approver identity from Supabase auth", async () => {
  let approvalId;
  await withJarvis("owner-user", async base => {
    const created = await fetch(base + "/api/jarvis/orchestrate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Lock workstation immediately" })
    });
    const createdBody = await created.json();
    assert.equal(created.status, 200);
    assert.equal(createdBody.status, "APPROVAL_REQUIRED");
    approvalId = createdBody.approvalRequest.id;

    const approved = await fetch(base + "/api/jarvis/permissions/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: approvalId, userId: "attacker-user", isAdmin: true })
    });
    assert.equal(approved.status, 200);
    const result = await approved.json();
    assert.equal(result.success, true);
    assert.equal(result.request.approvedBy, "owner-user");
  });

  await withJarvis("attacker-user", async base => {
    const forged = await fetch(base + "/api/jarvis/permissions/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: approvalId, userId: "owner-user", isAdmin: true })
    });
    assert.equal(forged.status, 403);
    assert.equal((await forged.json()).error.code, "ULTRON_OWNER_ONLY");
  });
});
