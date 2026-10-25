import test from "node:test";
import assert from "node:assert/strict";
import { allowedDesktopApps, normalizeDesktopActionResult, normalizeDesktopFailureCode, validateDesktopAction } from "../desktop-companion/action-policy.js";

test("desktop action policy permits only the read-only system info action and three named apps", () => {
  assert.deepEqual(validateDesktopAction("system_info", {}), { ok: true, actionType: "system_info", payload: {} });
  for (const app of ["notepad", "calculator", "file_explorer"]) {
    assert.deepEqual(validateDesktopAction("launch_app", { app }), { ok: true, actionType: "launch_app", payload: { app } });
  }
  assert.deepEqual(allowedDesktopApps(), ["notepad", "calculator", "file_explorer"]);
});

test("desktop action policy rejects shells, arbitrary arguments, command strings, and unknown payload keys", () => {
  for (const [type, payload] of [
    ["run_shell", { command: "whoami" }],
    ["launch_app", { app: "powershell" }],
    ["launch_app", { app: "notepad", args: ["secret.txt"] }],
    ["launch_app", { app: "notepad.exe" }],
    ["system_info", { includeEnvironment: true }],
    ["launch_app", null]
  ]) assert.equal(validateDesktopAction(type, payload).ok, false);
});

test("system info result is reduced to safe bounded fields and rejects private extra fields", () => {
  const result = {
    platform: "win32", architecture: "x64", nodeVersion: "v24.1.0", osRelease: "10.0",
    uptimeSeconds: 10, totalMemoryBytes: 8_000_000_000, freeMemoryBytes: 4_000_000_000, logicalCpuCount: 8
  };
  assert.deepEqual(normalizeDesktopActionResult("system_info", {}, result), { ok: true, result });
  assert.equal(normalizeDesktopActionResult("system_info", {}, { ...result, hostname: "do-not-store" }).ok, true);
  assert.equal("hostname" in normalizeDesktopActionResult("system_info", {}, { ...result, hostname: "do-not-store" }).result, false);
  assert.equal(normalizeDesktopActionResult("system_info", {}, { ...result, platform: "linux" }).ok, false);
  assert.equal(normalizeDesktopActionResult("system_info", {}, { ...result, freeMemoryBytes: result.totalMemoryBytes + 1 }).ok, false);
});

test("app launch completion must match the approved allowlisted app", () => {
  assert.deepEqual(normalizeDesktopActionResult("launch_app", { app: "notepad" }, { app: "notepad", started: true }), {
    ok: true, result: { app: "notepad", started: true }
  });
  assert.equal(normalizeDesktopActionResult("launch_app", { app: "notepad" }, { app: "calculator", started: true }).ok, false);
  assert.equal(normalizeDesktopActionResult("launch_app", { app: "notepad" }, { app: "notepad", started: true, command: "secret" }).ok, false);
});

test("failure codes are fixed allowlist values, never arbitrary exception messages", () => {
  assert.equal(normalizeDesktopFailureCode("APP_LAUNCH_FAILED"), "APP_LAUNCH_FAILED");
  assert.equal(normalizeDesktopFailureCode("C:\\Users\\name\\secret"), "ACTION_NOT_SUPPORTED");
});
