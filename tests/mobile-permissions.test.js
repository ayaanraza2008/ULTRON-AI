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
  const tokenRecord = engine.requestConfirmation("mobile_install_app", { apk: "/safe/app.apk", device: "emulator-5554" }, "Test install", "admin");
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

  const tokenRecord = engine.requestConfirmation("mobile_terminate_app", { package: "com.test", device: "emulator-5554" }, "Test term", "admin");
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


test("MobilePermissions: binds device authorization to its owner and requires approval for Level 3+", async () => {
  const engine = new MobilePermissionEngine();
  engine.authorizeDevice("phone-1", MOBILE_PERMISSION_LEVELS.LEVEL_2_INTERACTION, "owner-a");

  const crossUser = await engine.checkPermission(
    "mobile_click_on_screen_at_coordinates", { x: 10, y: 10 }, "phone-1", "owner-b"
  );
  assert.equal(crossUser.permitted, false);
  assert.equal(crossUser.code, "DEVICE_UNAUTHORIZED");

  const sensitive = await engine.checkPermission(
    "mobile_terminate_app", { package: "com.example.app", device: "phone-1" }, "phone-1", "owner-a"
  );
  assert.equal(sensitive.permitted, false);
  assert.equal(sensitive.requiresConfirmation, true);
  assert.ok(sensitive.confirmationToken);

  const wrongOwner = await engine.checkPermission(
    "mobile_terminate_app", { package: "com.example.app", device: "phone-1" }, "phone-1", "owner-b", sensitive.confirmationToken
  );
  assert.equal(wrongOwner.permitted, false);
  assert.equal(wrongOwner.code, "DEVICE_UNAUTHORIZED");

  const approved = await engine.checkPermission(
    "mobile_terminate_app", { package: "com.example.app", device: "phone-1" }, "phone-1", "owner-a", sensitive.confirmationToken
  );
  assert.equal(approved.permitted, true);
});

test("MobilePermissions: confirmation token is bound to exact action parameters", async () => {
  const engine = new MobilePermissionEngine();
  engine.authorizeDevice("phone-1", MOBILE_PERMISSION_LEVELS.LEVEL_2_INTERACTION, "owner-a");
  const approvedParams = { device: "phone-1", packageName: "com.example.safe", apk: "/safe/app.apk" };

  const pending = await engine.checkPermission("mobile_install_app", approvedParams, "phone-1", "owner-a");
  assert.equal(pending.requiresConfirmation, true);

  const tampered = await engine.checkPermission(
    "mobile_install_app",
    { ...approvedParams, apk: "/unreviewed/other.apk" },
    "phone-1",
    "owner-a",
    pending.confirmationToken
  );
  assert.equal(tampered.permitted, false);
  assert.equal(tampered.code, "INVALID_CONFIRMATION_TOKEN");

  const exact = await engine.checkPermission(
    "mobile_install_app",
    approvedParams,
    "phone-1",
    "owner-a",
    pending.confirmationToken
  );
  assert.equal(exact.permitted, true);
});

test("MobilePermissions: refuses persistent sensitive-level device grants and anonymous authorization", () => {
  const engine = new MobilePermissionEngine();
  assert.throws(() => engine.authorizeDevice("phone-1", MOBILE_PERMISSION_LEVELS.LEVEL_3_SENSITIVE, "owner-a"), /limited to read and ordinary interaction/);
  assert.throws(() => engine.authorizeDevice("phone-1", MOBILE_PERMISSION_LEVELS.LEVEL_2_INTERACTION), /authenticated owner ID/);
});

test("MobilePermissions: records tamper-resistant audit logs", () => {
  const engine = new MobilePermissionEngine();

  engine.authorizeDevice("emulator-5554", MOBILE_PERMISSION_LEVELS.LEVEL_2_INTERACTION, "admin");
  engine.requestConfirmation("mobile_install_app", { device: "emulator-5554" }, "Audit test", "admin");

  const logs = engine.getAuditLogs();
  assert.ok(logs.length >= 2);
  assert.ok(logs.some(l => l.type === "DEVICE_AUTHORIZED"));
  assert.ok(logs.some(l => l.type === "CONFIRMATION_REQUESTED"));
  assert.ok(logs[0].id && logs[0].timestamp);
});


test("MobilePermissions: confirmation fingerprints normalize sparse slots to JSON null", async () => {
  const engine = new MobilePermissionEngine();
  engine.authorizeDevice("phone-1", MOBILE_PERMISSION_LEVELS.LEVEL_2_INTERACTION, "owner-a");
  const approvedParams = { device: "phone-1", values: [null] };
  const pending = await engine.checkPermission("mobile_install_app", approvedParams, "phone-1", "owner-a");
  assert.equal(pending.requiresConfirmation, true);

  const sparseExpected = { device: "phone-1", values: new Array(1) };
  const verified = engine.verifyConfirmationToken(
    pending.confirmationToken,
    "mobile_install_app",
    "phone-1",
    "owner-a",
    sparseExpected
  );
  assert.equal(verified.valid, true);
});

test("MobilePermissions: confirmation fingerprints do not collapse sparse slots into empty arrays", async () => {
  const engine = new MobilePermissionEngine();
  engine.authorizeDevice("phone-1", MOBILE_PERMISSION_LEVELS.LEVEL_2_INTERACTION, "owner-a");
  const approvedParams = { device: "phone-1", values: [] };
  const pending = await engine.checkPermission("mobile_install_app", approvedParams, "phone-1", "owner-a");
  assert.equal(pending.requiresConfirmation, true);

  const sparseExpected = { device: "phone-1", values: new Array(1) };
  const verified = engine.verifyConfirmationToken(
    pending.confirmationToken,
    "mobile_install_app",
    "phone-1",
    "owner-a",
    sparseExpected
  );
  assert.equal(verified.valid, false);
  assert.match(verified.reason, /parameters do not match/i);
});
