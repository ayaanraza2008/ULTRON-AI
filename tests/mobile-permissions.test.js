import test from "node:test";
import assert from "node:assert/strict";
import {
  MobilePermissionEngine,
  MOBILE_PERMISSION_LEVELS,
  ACTION_PERMISSION_TIERS,
  SENSITIVE_PACKAGES
} from "../mobile/mobile-permission-engine.js";

test("MobilePermissions: verifies 4-tier permission hierarchy mapping", () => {
  assert.equal(ACTION_PERMISSION_TIERS.mobile_list_available_devices, MOBILE_PERMISSION_LEVELS.LEVEL_1_READ);
  assert.equal(ACTION_PERMISSION_TIERS.mobile_take_screenshot, MOBILE_PERMISSION_LEVELS.LEVEL_1_READ);
  assert.equal(ACTION_PERMISSION_TIERS.mobile_click_on_screen_at_coordinates, MOBILE_PERMISSION_LEVELS.LEVEL_2_INTERACTION);
  assert.equal(ACTION_PERMISSION_TIERS.mobile_terminate_app, MOBILE_PERMISSION_LEVELS.LEVEL_3_SENSITIVE);
  assert.equal(ACTION_PERMISSION_TIERS.mobile_install_app, MOBILE_PERMISSION_LEVELS.LEVEL_4_CRITICAL);
  assert.equal(ACTION_PERMISSION_TIERS.mobile_make_payment, MOBILE_PERMISSION_LEVELS.LEVEL_4_CRITICAL);
});

test("MobilePermissions: generates and consumes single-use confirmation token with anti-replay", () => {
  const engine = new MobilePermissionEngine({ tokenTtlMs: 60000 });

  // Generate confirmation token
  const tokenRecord = engine.requestConfirmation("mobile_install_app", { apk: "/safe/app.apk" }, "Test install");
  assert.ok(tokenRecord.token, "Must return a cryptographically generated token");
  assert.equal(tokenRecord.action, "mobile_install_app");
  assert.ok(tokenRecord.expiresAt > Date.now());

  // First consumption must succeed
  const firstConsume = engine.consumeConfirmation(tokenRecord.token, "mobile_install_app");
  assert.equal(firstConsume.valid, true);
  assert.equal(firstConsume.request.action, "mobile_install_app");

  // Replay attempt must be blocked
  const replayConsume = engine.consumeConfirmation(tokenRecord.token, "mobile_install_app");
  assert.equal(replayConsume.valid, false);
  assert.ok(replayConsume.reason.includes("anti-replay") || replayConsume.reason.includes("not found"));
});

test("MobilePermissions: rejects expired confirmation token", async () => {
  const engine = new MobilePermissionEngine({ tokenTtlMs: 10 }); // 10ms TTL

  const tokenRecord = engine.requestConfirmation("mobile_terminate_app", { package: "com.test" }, "Test term");
  await new Promise(resolve => setTimeout(resolve, 30)); // Wait for expiration

  const consume = engine.consumeConfirmation(tokenRecord.token, "mobile_terminate_app");
  assert.equal(consume.valid, false);
  assert.ok(consume.reason.includes("expired"));
});

test("MobilePermissions: enforces sensitive app shield on financial, messaging, and settings packages", () => {
  const engine = new MobilePermissionEngine();

  for (const pkg of SENSITIVE_PACKAGES) {
    const check = engine.checkAction("launch_app", { package: pkg, autonomyLevel: 2 });
    assert.equal(check.allowed, false, `Package ${pkg} must be guarded`);
    assert.equal(check.requiresConfirmation, true);
    assert.equal(check.level, MOBILE_PERMISSION_LEVELS.LEVEL_4_CRITICAL);
  }

  // Non-sensitive package passes at autonomy level 2
  const safeCheck = engine.checkAction("click_on_screen", { package: "com.google.android.calculator", autonomyLevel: 2 });
  assert.equal(safeCheck.allowed, true);
  assert.equal(safeCheck.requiresConfirmation, false);
});

test("MobilePermissions: blocks SSRF and non-HTTP URL schemes", () => {
  const engine = new MobilePermissionEngine();

  // Allowed public HTTPS URL
  assert.equal(engine.sanitizeUrl("https://en.wikipedia.org/wiki/Main_Page").safe, true);
  assert.equal(engine.sanitizeUrl("http://example.com/test").safe, true);

  // Blocked dangerous protocols
  assert.equal(engine.sanitizeUrl("javascript:alert(1)").safe, false);
  assert.equal(engine.sanitizeUrl("file:///data/system/users/0/settings.xml").safe, false);
  assert.equal(engine.sanitizeUrl("content://media/external/images/media").safe, false);

  // Blocked private / internal loopbacks and cloud metadata
  assert.equal(engine.sanitizeUrl("http://localhost:8080/admin").safe, false);
  assert.equal(engine.sanitizeUrl("http://127.0.0.1:3000/internal").safe, false);
  assert.equal(engine.sanitizeUrl("http://169.254.169.254/latest/meta-data/").safe, false);
  assert.equal(engine.sanitizeUrl("http://192.168.1.1/router").safe, false);
  assert.equal(engine.sanitizeUrl("http://10.0.0.1/private").safe, false);
});

test("MobilePermissions: records tamper-resistant audit logs", () => {
  const engine = new MobilePermissionEngine();

  engine.authorizeDevice("emulator-5554", MOBILE_PERMISSION_LEVELS.LEVEL_3_SENSITIVE, "admin");
  engine.requestConfirmation("mobile_install_app", {}, "Audit test");

  const logs = engine.getAuditLogs();
  assert.ok(logs.length >= 2);
  assert.ok(logs.some(l => l.type === "DEVICE_AUTHORIZED"));
  assert.ok(logs.some(l => l.type === "CONFIRMATION_REQUESTED"));
  assert.ok(logs[0].id && logs[0].timestamp);
});
