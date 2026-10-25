import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { executeDesktopAction, runWindowsCompanion, validateDesktopCompanionClientConfig } from "../desktop-companion/windows-agent.js";

const BASE_ENV = {
  ULTRON_DESKTOP_SERVER_URL: "https://ultron.example.com",
  ULTRON_DESKTOP_POLL_TOKEN: "synthetic-poll-token",
  ULTRON_DESKTOP_DEVICE_ID: "desktop-test-01",
  ULTRON_DESKTOP_AGENT_ENABLED: "true"
};
const UUID = "00000000-0000-4000-8000-000000000099";

test("Windows companion requires explicit opt-in and safe public HTTPS configuration", () => {
  assert.equal(validateDesktopCompanionClientConfig(BASE_ENV).configured, true);
  assert.equal(validateDesktopCompanionClientConfig({ ...BASE_ENV, ULTRON_DESKTOP_SERVER_URL: "http://ultron.example.com" }).configured, false);
  assert.equal(validateDesktopCompanionClientConfig({ ...BASE_ENV, ULTRON_DESKTOP_SERVER_URL: "https://192.168.1.20" }).configured, false);
  assert.equal(validateDesktopCompanionClientConfig({ ...BASE_ENV, ULTRON_DESKTOP_DEVICE_ID: "../bad" }).configured, false);
});

test("system info action returns a minimal schema and no hostname or environment values", async () => {
  const result = await executeDesktopAction({ actionType: "system_info", payload: {}, requiresApproval: false }, {
    processLike: { platform: "win32", arch: "x64", version: "v24.1.0" },
    osImpl: {
      totalmem: () => 8_000_000_000,
      freemem: () => 4_000_000_000,
      cpus: () => Array.from({ length: 8 }, () => ({})),
      release: () => "10.0",
      uptime: () => 600
    }
  });
  assert.equal(result.status, "completed");
  assert.equal(result.result.platform, "win32");
  assert.equal(result.result.logicalCpuCount, 8);
  assert.equal("hostname" in result.result, false);
  assert.equal("env" in result.result, false);
});

test("approved app launcher uses only a fixed System32 binary and no shell or arguments", async () => {
  let called;
  const child = new EventEmitter();
  child.unref = () => {};
  const resultPromise = executeDesktopAction({
    actionType: "launch_app", payload: { app: "notepad" }, requiresApproval: true, approvedAt: "2026-10-25T18:00:00Z"
  }, {
    platform: "win32",
    env: { SystemRoot: "C:\\Windows" },
    existsImpl: () => true,
    spawnImpl: (executable, args, options) => {
      called = { executable, args, options };
      queueMicrotask(() => child.emit("spawn"));
      return child;
    }
  });
  const result = await resultPromise;
  assert.equal(result.status, "completed");
  assert.equal(result.result.app, "notepad");
  assert.equal(called.executable.toLowerCase(), "c:\\windows\\system32\\notepad.exe");
  assert.deepEqual(called.args, []);
  assert.equal(called.options.shell, false);
  assert.equal(called.options.detached, true);
});

test("app launcher refuses to run off Windows and refuses unapproved actions", async () => {
  let spawnCalls = 0;
  const action = { actionType: "launch_app", payload: { app: "notepad" }, requiresApproval: true };
  const unapproved = await executeDesktopAction(action, { platform: "win32", spawnImpl: () => { spawnCalls += 1; } });
  assert.equal(unapproved.status, "failed");
  assert.equal(unapproved.errorCode, "ACTION_NOT_APPROVED");
  const wrongPlatform = await executeDesktopAction({ ...action, approvedAt: "not-a-timestamp" }, {
    platform: "linux", spawnImpl: () => { spawnCalls += 1; }
  });
  assert.equal(wrongPlatform.status, "failed");
  assert.equal(spawnCalls, 0);
});

test("local PC refuses an app launch even when a server omits the approval-required flag", async () => {
  let spawnCalls = 0;
  const result = await executeDesktopAction({
    actionType: "launch_app",
    payload: { app: "notepad" },
    requiresApproval: false,
    approvedAt: null
  }, {
    platform: "win32",
    env: { SystemRoot: "C:\\\\Windows" },
    existsImpl: () => true,
    spawnImpl: () => { spawnCalls += 1; throw new Error("must not spawn"); }
  });
  assert.deepEqual(result, { status: "failed", errorCode: "ACTION_NOT_APPROVED" });
  assert.equal(spawnCalls, 0);
});

test("app launch approval metadata must contain a parseable timestamp", async () => {
  let spawnCalls = 0;
  const result = await executeDesktopAction({
    actionType: "launch_app",
    payload: { app: "notepad" },
    requiresApproval: true,
    approvedAt: "approved"
  }, {
    platform: "win32",
    env: { SystemRoot: "C:\\\\Windows" },
    existsImpl: () => true,
    spawnImpl: () => { spawnCalls += 1; throw new Error("must not spawn"); }
  });
  assert.deepEqual(result, { status: "failed", errorCode: "ACTION_NOT_APPROVED" });
  assert.equal(spawnCalls, 0);
});

test("companion polls with bearer token and reports only bounded allowlisted results", async () => {
  const calls = [];
  let polls = 0;
  const result = await runWindowsCompanion({
    env: BASE_ENV,
    maxPolls: 2,
    sleepImpl: async () => {},
    logger: { info() {}, warn() {} },
    executeAction: async action => {
      assert.equal(action.actionType, "system_info");
      return { status: "completed", result: {
        platform: "win32", architecture: "x64", nodeVersion: "v24.1.0", osRelease: "10.0",
        uptimeSeconds: 10, totalMemoryBytes: 8_000_000_000, freeMemoryBytes: 4_000_000_000, logicalCpuCount: 8
      } };
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      assert.equal(options.redirect, "error");
      assert.equal(options.headers.Authorization, "Bearer synthetic-poll-token");
      if (url.endsWith("/api/desktop-companion/poll")) {
        polls += 1;
        const body = polls === 1 ? { action: {
          id: UUID, actionType: "system_info", payload: {}, requiresApproval: false, approvedAt: null
        } } : { action: null, pollAfterMs: 5000 };
        return new Response(JSON.stringify(body), { status: 200 });
      }
      return new Response(JSON.stringify({ action: { id: UUID, status: "completed" } }), { status: 200 });
    }
  });
  assert.equal(result.polls, 2);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].url, "https://ultron.example.com/api/desktop-companion/poll");
  assert.ok(calls[1].url.endsWith("/api/desktop-companion/actions/" + UUID + "/complete"));
  assert.equal(JSON.stringify(calls).includes("hostname"), false);
});
