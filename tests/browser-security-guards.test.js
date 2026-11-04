import test from "node:test";
import assert from "node:assert/strict";
import { EgoSecurityGuard } from "../integrations/browser/ego-lite/ego-security-guard.js";
import { EgoActionExecutor } from "../integrations/browser/ego-lite/ego-action-executor.js";
import { EgoSnapshotEngine } from "../integrations/browser/ego-lite/ego-snapshot-engine.js";

test("Ego URL guard blocks DNS answers in private and loopback ranges", async () => {
  const guard = new EgoSecurityGuard({
    dnsLookup: async hostname => hostname === "public.example"
      ? [{ address: "1.1.1.1", family: 4 }]
      : [{ address: "127.0.0.1", family: 4 }]
  });

  assert.equal((await guard.validateUrlAsync("https://public.example")).allowed, true);
  const rebinding = await guard.validateUrlAsync("https://private.example");
  assert.equal(rebinding.allowed, false);
  assert.match(rebinding.reason, /DNS resolution includes/);
});

test("Ego URL guard blocks IPv6 ULA, link-local, loopback and IPv4-mapped private addresses", () => {
  const guard = new EgoSecurityGuard();
  for (const address of [
    "http://[::1]/",
    "http://[fd00::1]/",
    "http://[fe80::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[2001:db8::1]/"
  ]) {
    assert.equal(guard.validateUrl(address).allowed, false, address);
  }
});

test("Ego URL guard fails closed when DNS resolution fails or returns no records", async () => {
  const failed = new EgoSecurityGuard({ dnsLookup: async () => { throw new Error("NXDOMAIN"); } });
  assert.equal((await failed.validateUrlAsync("https://unresolved.example")).allowed, false);

  const empty = new EgoSecurityGuard({ dnsLookup: async () => [] });
  assert.equal((await empty.validateUrlAsync("https://empty.example")).allowed, false);
});

test("Ego browser gates page script and raw CDP behind owner-bound single-use approval", async () => {
  const tokens = new Set([
    "owner-a:evaluate:evaluate-once",
    "owner-a:cdp:cdp-once"
  ]);
  const guard = new EgoSecurityGuard({
    approvalVerifier: async ({ actionName, actorId, approvalToken }) => {
      const key = `${actorId}:${actionName}:${approvalToken}`;
      if (!tokens.has(key)) return false;
      tokens.delete(key);
      return true;
    }
  });
  const calls = [];
  const executor = new EgoActionExecutor({
    securityGuard: guard,
    driver: {
      evaluate: async (_pageId, script) => { calls.push(["evaluate", script]); return 42; },
      cdp: async method => { calls.push(["cdp", method]); return { ok: true }; }
    }
  });

  await assert.rejects(
    () => executor.evaluate("page-1", "document.cookie"),
    error => error.code === "BROWSER_APPROVAL_REQUIRED"
  );
  await assert.rejects(
    () => executor.evaluate("page-1", "document.cookie", { actorId: "owner-b", approvalToken: "evaluate-once" }),
    error => error.code === "BROWSER_APPROVAL_REQUIRED"
  );
  assert.equal(await executor.evaluate("page-1", "1 + 1", {
    actorId: "owner-a",
    approvalToken: "evaluate-once"
  }), 42);
  await assert.rejects(
    () => executor.evaluate("page-1", "1 + 1", { actorId: "owner-a", approvalToken: "evaluate-once" }),
    error => error.code === "BROWSER_APPROVAL_REQUIRED"
  );

  await assert.rejects(
    () => executor.cdp("Browser.getVersion"),
    error => error.code === "BROWSER_APPROVAL_REQUIRED"
  );
  assert.deepEqual(await executor.cdp("Browser.getVersion", {}, {
    actorId: "owner-a",
    approvalToken: "cdp-once"
  }), { ok: true });
  assert.deepEqual(calls, [["evaluate", "1 + 1"], ["cdp", "Browser.getVersion"]]);
});

test("Ego browser requires owner approval for button clicks, uploads and Enter submission", async () => {
  const tokens = new Set(["owner-a:click:click-once"]);
  const guard = new EgoSecurityGuard({
    approvalVerifier: async ({ actionName, actorId, approvalToken }) => {
      const key = `${actorId}:${actionName}:${approvalToken}`;
      if (!tokens.has(key)) return false;
      tokens.delete(key);
      return true;
    }
  });
  const snapshotEngine = new EgoSnapshotEngine();
  const executor = new EgoActionExecutor({ securityGuard: guard, snapshotEngine });
  await snapshotEngine.snapshot({
    pageId: "page-2",
    simulatedElements: [{ role: "button", name: "Open settings" }]
  });

  await assert.rejects(
    () => executor.click("page-2", "@1"),
    error => error.code === "BROWSER_APPROVAL_REQUIRED"
  );
  assert.equal((await executor.click("page-2", "@1", {
    actorId: "owner-a",
    approvalToken: "click-once"
  })).clicked, true);

  await assert.rejects(
    () => executor.setInputFiles("page-2", "@1", ["C:/private/report.pdf"]),
    error => error.code === "BROWSER_APPROVAL_REQUIRED"
  );
  await assert.rejects(
    () => executor.press("page-2", "Enter"),
    error => error.code === "BROWSER_APPROVAL_REQUIRED"
  );
});

test("Ego browser emergency stop overrides even an otherwise valid approval token", async () => {
  const guard = new EgoSecurityGuard({
    approvalVerifier: async () => true
  });
  const executor = new EgoActionExecutor({ securityGuard: guard });
  guard.triggerEmergencyStop("test emergency stop");
  await assert.rejects(
    () => executor.evaluate("page-1", "1 + 1", {
      actorId: "owner-a",
      approvalToken: "valid"
    }),
    /Emergency Stop is engaged/
  );
});
