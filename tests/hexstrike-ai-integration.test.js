import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import {
  createHexStrikeRouter,
  getHexStrikeReadiness,
  resolveHexStrikeScanTarget
} from "../integrations/hexstrike-ai.js";

const OWNER = "00000000-0000-4000-8000-000000000001";

async function makeWorkspace() {
  return fs.mkdtemp(path.join(os.tmpdir(), "ultron-hexstrike-"));
}

async function withServer(env, fetchImpl, run, { userId = OWNER, authGateway } = {}) {
  const app = express();
  app.use(express.json({ limit: "32kb" }));
  const configuredEnv = {
    HEXSTRIKE_ENABLED: "true",
    HEXSTRIKE_BASE_URL: "http://127.0.0.1:8888",
    HEXSTRIKE_SCAN_ROOT: await makeWorkspace(),
    ULTRON_INTEGRATION_OWNER_USER_ID: OWNER,
    ...env
  };
  const requireSupabaseUser = (req, _res, next) => { req.supabaseUser = { id: userId }; next(); };
  app.use("/api", createHexStrikeRouter({
    env: configuredEnv,
    fetchImpl,
    requireSupabaseUser,
    authGateway: authGateway || { assertAuthorization: target => ({ authorized: true, scopeId: "test-scope", target }) },
    guardian: { recordAudit() {} }
  }));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try { await run("http://127.0.0.1:" + server.address().port, configuredEnv); }
  finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

test("HexStrike remains disabled unless explicitly enabled", () => {
  const readiness = getHexStrikeReadiness({});
  assert.equal(readiness.enabled, false);
  assert.equal(readiness.configured, false);
  assert.equal(readiness.state, "disabled");
});

test("local loopback HexStrike can be configured without a remote gateway token", () => {
  const readiness = getHexStrikeReadiness({
    HEXSTRIKE_ENABLED: "true",
    HEXSTRIKE_BASE_URL: "http://127.0.0.1:8888",
    ULTRON_INTEGRATION_OWNER_USER_ID: OWNER
  });
  assert.equal(readiness.configured, true);
  assert.equal(readiness.scanReady, false);
});

test("remote HexStrike fails closed without a confirmed HTTPS auth gateway and long token", () => {
  const base = {
    HEXSTRIKE_ENABLED: "true",
    HEXSTRIKE_BASE_URL: "https://hexstrike.example.com",
    ULTRON_INTEGRATION_OWNER_USER_ID: OWNER
  };
  assert.equal(getHexStrikeReadiness(base).configured, false);
  assert.equal(getHexStrikeReadiness({
    ...base,
    HEXSTRIKE_REMOTE_GATEWAY_CONFIRMED: "true",
    HEXSTRIKE_API_TOKEN: "short"
  }).configured, false);
  assert.equal(getHexStrikeReadiness({
    ...base,
    HEXSTRIKE_REMOTE_GATEWAY_CONFIRMED: "true",
    HEXSTRIKE_API_TOKEN: "x".repeat(40)
  }).configured, true);
});

test("scan targets must remain within the real shared workspace and reject traversal", async () => {
  const root = await makeWorkspace();
  await fs.mkdir(path.join(root, "project"));
  assert.equal(await resolveHexStrikeScanTarget("project", root), await fs.realpath(path.join(root, "project")));
  await assert.rejects(() => resolveHexStrikeScanTarget("../", root), { code: "INVALID_SCAN_TARGET" });
  await assert.rejects(() => resolveHexStrikeScanTarget("project;whoami", root), { code: "INVALID_SCAN_TARGET" });
  await assert.rejects(() => resolveHexStrikeScanTarget("a".repeat(241), root), { code: "INVALID_SCAN_TARGET" });
  await assert.rejects(() => resolveHexStrikeScanTarget(path.resolve(root, "project"), root), { code: "INVALID_SCAN_TARGET" });
  const outside = await makeWorkspace();
  await fs.symlink(outside, path.join(root, "escape"), "dir");
  await assert.rejects(() => resolveHexStrikeScanTarget("escape", root), { code: "INVALID_SCAN_TARGET" });
});

test("status performs only a bounded health request and returns sanitized readiness", async () => {
  let request;
  await withServer({}, async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ status: "healthy", version: "6.0.0", secret: "must-not-return" }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/integrations/hexstrike/status");
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.reachable, true);
    assert.equal(data.health.version, "6.0.0");
    assert.equal("secret" in data.health, false);
    assert.equal(request.url, "http://127.0.0.1:8888/health");
    assert.equal(request.options.redirect, "error");
  });
});

test("owner guard blocks non-owner before contacting HexStrike", async () => {
  let called = false;
  await withServer({}, async () => {
    called = true;
    throw new Error("non-owner must not reach HexStrike");
  }, async (base) => {
    const response = await fetch(base + "/api/integrations/hexstrike/status");
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, "INTEGRATION_OWNER_ONLY");
    assert.equal(called, false);
  }, { userId: "00000000-0000-4000-8000-000000000002" });
});

test("scan exposes only Trivy filesystem/config and Checkov with fixed arguments", async () => {
  let request;
  await withServer({}, async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({
      success: true,
      return_code: 0,
      execution_time: 1.25,
      stdout: "scan completed",
      stderr: ""
    }), { status: 200 });
  }, async (base, env) => {
    await fs.mkdir(path.join(env.HEXSTRIKE_SCAN_ROOT, "repo"));
    const response = await fetch(base + "/api/integrations/hexstrike/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "trivy-fs", target: "repo" })
    });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.success, true);
    assert.equal(data.status, "completed");
    assert.equal(request.url, "http://127.0.0.1:8888/api/tools/trivy");
    const payload = JSON.parse(request.options.body);
    assert.equal(payload.scan_type, "fs");
    assert.equal(payload.severity, "HIGH,CRITICAL");
    assert.equal(payload.additional_args, "");
    assert.equal(payload.target, path.join(env.HEXSTRIKE_SCAN_ROOT, "repo"));
  });
});

test("Checkov scan maps to the fixed local IaC endpoint and arguments", async () => {
  let request;
  await withServer({}, async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ success: true, return_code: 0, stdout: "checkov complete", stderr: "" }), { status: 200 });
  }, async (base, env) => {
    await fs.mkdir(path.join(env.HEXSTRIKE_SCAN_ROOT, "iac"));
    const response = await fetch(base + "/api/integrations/hexstrike/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "checkov", target: "iac" })
    });
    assert.equal(response.status, 200);
    assert.equal(request.url, "http://127.0.0.1:8888/api/tools/checkov");
    const payload = JSON.parse(request.options.body);
    assert.equal(payload.directory, path.join(env.HEXSTRIKE_SCAN_ROOT, "iac"));
    assert.equal(payload.output_format, "json");
    assert.equal(payload.additional_args, "");
  });
});

test("path validation rejects shell metacharacters before contacting HexStrike", async () => {
  let called = false;
  await withServer({}, async () => {
    called = true;
    throw new Error("unsafe path must not reach HexStrike");
  }, async base => {
    const response = await fetch(base + "/api/integrations/hexstrike/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "trivy-fs", target: "project;whoami" })
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "INVALID_SCAN_TARGET");
    assert.equal(called, false);
  });
});

test("scan rejects arbitrary tool names and caller-supplied command arguments", async () => {
  let called = false;
  await withServer({}, async () => {
    called = true;
    throw new Error("invalid scan request must not reach HexStrike");
  }, async base => {
    for (const body of [
      { tool: "api-command", target: "." },
      { tool: "nmap", target: "." },
      { tool: "trivy-fs", target: ".", additional_args: "--help" }
    ]) {
      const response = await fetch(base + "/api/integrations/hexstrike/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      assert.equal(response.status, 400);
    }
    assert.equal(called, false);
  });
});

test("scan requires ULTRON's existing target authorization gateway", async () => {
  let called = false;
  await withServer({}, async () => {
    called = true;
    throw new Error("out-of-scope target must not reach HexStrike");
  }, async base => {
    const response = await fetch(base + "/api/integrations/hexstrike/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "checkov", target: "." })
    });
    assert.equal(response.status, 403);
    assert.equal(called, false);
  }, {
    authGateway: { assertAuthorization() { throw Object.assign(new Error("out of scope"), { code: "TARGET_OUT_OF_SCOPE" }); } }
  });
});

test("upstream failure is reported as failure, never as a clean security result", async () => {
  await withServer({}, async () => new Response(JSON.stringify({
    success: false,
    return_code: 2,
    stdout: "",
    stderr: "scanner failed"
  }), { status: 200 }), async base => {
    const response = await fetch(base + "/api/integrations/hexstrike/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "trivy-config", target: "." })
    });
    assert.equal(response.status, 502);
    const data = await response.json();
    assert.equal(data.success, false);
    assert.equal(data.status, "failed");
  });
});
