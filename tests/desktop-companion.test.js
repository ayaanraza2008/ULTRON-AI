import test from "node:test";
import assert from "node:assert/strict";
import { checkDesktopCompanion, getDesktopCompanionReadiness } from "../integrations/desktop-companion.js";

const OWNER = "00000000-0000-4000-8000-000000000001";
const env = {
  ULTRON_DESKTOP_AGENT_URL: "https://desktop.example.com",
  ULTRON_DESKTOP_AGENT_TOKEN: "synthetic-desktop-token",
  ULTRON_INTEGRATION_OWNER_USER_ID: OWNER
};

function statusPayload(overrides = {}) {
  return {
    protocolVersion: 1,
    device: {
      id: "windows-device-01",
      name: "Ayaan-PC",
      platform: "windows",
      paired: true,
      online: true,
      lastSeenAt: "2026-10-25T15:00:00.000Z"
    },
    capabilities: ["status", "system_info", "run_shell", "read_files", "status"],
    ...overrides
  };
}

test("desktop companion status is owner-scoped and exposes only allowlisted read-only capabilities", async () => {
  let request;
  const result = await checkDesktopCompanion({
    env,
    userId: OWNER,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify(statusPayload()), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  assert.equal(result.state, "completed");
  assert.equal(result.reachable, true);
  assert.deepEqual(result.capabilities, ["status", "system_info"]);
  assert.equal(result.device.id, "windows-device-01");
  assert.equal(result.device.platform, "windows");
  assert.deepEqual(result.actionsExecuted, []);
  assert.equal(request.url, "https://desktop.example.com/v1/ultron/status");
  assert.equal(request.options.method, "GET");
  assert.equal(request.options.redirect, "error");
  assert.equal(request.options.headers.Authorization, "Bearer synthetic-desktop-token");
  assert.equal(request.options.headers["X-ULTRON-Protocol-Version"], "1");
  assert.equal(JSON.stringify(result).includes("synthetic-desktop-token"), false);
});

test("desktop companion readiness distinguishes configuration from a paired live device", () => {
  const configured = getDesktopCompanionReadiness(env, OWNER);
  assert.equal(configured.configured, true);
  assert.equal(configured.ownerAuthorized, true);
  assert.equal(configured.state, "configured_unverified");

  const missing = getDesktopCompanionReadiness({}, OWNER);
  assert.equal(missing.configured, false);
  assert.equal(missing.state, "blocked");

  const unsafe = getDesktopCompanionReadiness({
    ...env,
    ULTRON_DESKTOP_AGENT_URL: "https://192.168.1.10"
  }, OWNER);
  assert.equal(unsafe.configured, false);
  assert.equal(unsafe.state, "blocked");
});

test("desktop companion denies a non-owner without making an outbound request", async () => {
  let calls = 0;
  const result = await checkDesktopCompanion({
    env,
    userId: "00000000-0000-4000-8000-000000000002",
    fetchImpl: async () => {
      calls += 1;
      throw new Error("must not contact the companion for a non-owner");
    }
  });
  assert.equal(result.state, "blocked");
  assert.equal(result.code, "INTEGRATION_OWNER_ONLY");
  assert.equal(result.reachable, false);
  assert.equal(calls, 0);
});

test("desktop companion fails closed on protocol mismatch and filters unknown actions", async () => {
  const badProtocol = await checkDesktopCompanion({
    env,
    userId: OWNER,
    fetchImpl: async () => new Response(JSON.stringify(statusPayload({ protocolVersion: 2 })), { status: 200 })
  });
  assert.equal(badProtocol.state, "failed");
  assert.equal(badProtocol.code, "DESKTOP_COMPANION_PROTOCOL_MISMATCH");

  const unknownActions = await checkDesktopCompanion({
    env,
    userId: OWNER,
    fetchImpl: async () => new Response(JSON.stringify(statusPayload({
      capabilities: ["status", "run_shell", "execute_powershell", "read_files"]
    })), { status: 200 })
  });
  assert.equal(unknownActions.state, "completed");
  assert.deepEqual(unknownActions.capabilities, ["status"]);
});

test("desktop companion cancels oversized responses before parsing", async () => {
  let cancelled = false;
  const result = await checkDesktopCompanion({
    env,
    userId: OWNER,
    fetchImpl: async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{}"));
      },
      cancel() { cancelled = true; }
    }), {
      status: 200,
      headers: { "content-type": "application/json", "content-length": String(64 * 1024 + 1) }
    })
  });
  assert.equal(result.state, "failed");
  assert.equal(result.code, "DESKTOP_COMPANION_RESPONSE_TOO_LARGE");
  assert.equal(cancelled, true);
});

test("desktop companion reports unauthenticated upstream errors without exposing tokens", async () => {
  const result = await checkDesktopCompanion({
    env,
    userId: OWNER,
    fetchImpl: async () => new Response("private error details", { status: 401 })
  });
  assert.equal(result.state, "failed");
  assert.equal(result.code, "DESKTOP_COMPANION_AUTH_FAILED");
  assert.equal(JSON.stringify(result).includes("synthetic-desktop-token"), false);
  assert.equal(JSON.stringify(result).includes("private error details"), false);
});
