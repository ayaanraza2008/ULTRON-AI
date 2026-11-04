import test from "node:test";
import assert from "node:assert/strict";
import { UltronGuardian, PERMISSION_SCOPES } from "../security/ultron-guardian.js";

test("UltronGuardian: capability token issuance and least-privilege scoping", () => {
  const guardian = new UltronGuardian();

  const readToken = guardian.issueCapabilityToken("service-reader", [PERMISSION_SCOPES.READ_ONLY]);
  assert.ok(readToken.startsWith("cap_"));

  // Permitted read
  assert.equal(guardian.assertPermission(readToken, PERMISSION_SCOPES.READ_ONLY), true);

  // Denied write
  assert.throws(() => {
    guardian.assertPermission(readToken, PERMISSION_SCOPES.SANDBOX_WRITE);
  }, /Token lacks required scope/);

  // Expired token rejection
  const shortToken = guardian.issueCapabilityToken("temp-actor", [PERMISSION_SCOPES.READ_ONLY], -100);
  assert.throws(() => {
    guardian.assertPermission(shortToken, PERMISSION_SCOPES.READ_ONLY);
  }, /Capability token has expired/);
});

test("UltronGuardian: secret redaction masks API keys, JWTs, and database URLs", () => {
  const guardian = new UltronGuardian();

  const fakeOpenAiKey = ["sk", "proj1234567890abcdef1234"].join("-");
  const fakeDbUrl = ["postgresql://user", "secretpass123@db.supabase.co/prod"].join(":");
  const sensitiveLog = "Connecting with " + fakeOpenAiKey + " and " + fakeDbUrl;
  const redacted = guardian.redactSecrets(sensitiveLog);

  assert.equal(redacted.includes("sk-proj"), false);
  assert.equal(redacted.includes("secretpass123"), false);
  assert.ok(redacted.includes("[REDACTED_SECRET:"));
});

test("UltronGuardian: cryptographic hash-chained audit log detects tampering", () => {
  const guardian = new UltronGuardian();

  guardian.recordAudit("SYSTEM_INIT", "CORE", { status: "ready" });
  guardian.recordAudit("USER_QUERY", "ayan", { prompt: "Deploy model" });
  guardian.recordAudit("TASK_DISPATCH", "ORCHESTRATOR", { taskId: "101" });

  assert.equal(guardian.auditLogChain.length, 3);

  // Initial integrity passes
  const initialCheck = guardian.verifyAuditIntegrity();
  assert.equal(initialCheck.valid, true);
  assert.equal(initialCheck.totalBlocks, 3);

  // Tamper with block 1 payload
  guardian.auditLogChain[1].payload.prompt = "TAMPERED_PROMPT_CONTENT";

  // Re-verification must catch the tampering
  const tamperedCheck = guardian.verifyAuditIntegrity();
  assert.equal(tamperedCheck.valid, false);
  assert.equal(tamperedCheck.brokenIndex, 1);
  assert.ok(tamperedCheck.reason.includes("corruption detected"));
});

test("UltronGuardian: sandboxed code execution enforces safe evaluation and limits", () => {
  const guardian = new UltronGuardian();

  // Safe pure computation
  const calcRes = guardian.executeSandboxed("const x = 10; const y = 20; x * y;");
  assert.equal(calcRes.success, true);
  assert.equal(calcRes.result, 200);

  // Denied access to process or child_process
  const procRes = guardian.executeSandboxed("process.exit(1)");
  assert.equal(procRes.success, false);
  assert.ok(procRes.error.includes("process is not defined"));
});

test("UltronGuardian: latching Emergency Stop revokes tokens and enforces shutdown", () => {
  const guardian = new UltronGuardian({ masterKey: "MY_SECRET_KEY" });
  const token = guardian.issueCapabilityToken("actor-1", [PERMISSION_SCOPES.ADMIN_CONTROL]);

  guardian.engageEmergencyStop("Unauthorized elevation detected");
  assert.equal(guardian.emergencyStopLatched, true);

  // Operations rejected under e-stop
  assert.throws(() => {
    guardian.assertPermission(token, PERMISSION_SCOPES.READ_ONLY);
  }, /All operations halted under Emergency Stop/);

  // Disengage with wrong key fails
  assert.throws(() => {
    guardian.disengageEmergencyStop("wrong_key");
  }, /Invalid or unconfigured operator key/);

  // Disengage with valid key restores
  const restoreRes = guardian.disengageEmergencyStop("MY_SECRET_KEY");
  assert.equal(restoreRes.latched, false);
  assert.equal(guardian.emergencyStopLatched, false);
});


test("UltronGuardian: emergency stop fails closed without a configured operator key", () => {
  const guardian = new UltronGuardian();
  const token = guardian.issueCapabilityToken("actor", [PERMISSION_SCOPES.READ_ONLY]);
  const stopped = guardian.engageEmergencyStop("test");
  assert.equal(stopped.revokedTokensCount, 1);
  assert.equal(guardian.activeCapabilityTokens.size, 0);
  assert.throws(() => guardian.disengageEmergencyStop("ULTRON_OPERATOR_MASTER_KEY_SECRET"), /Invalid or unconfigured operator key/);
  assert.throws(() => guardian.disengageEmergencyStop("OVERRIDE_AUTH_KEY_2026"), /Invalid or unconfigured operator key/);
  assert.equal(guardian.emergencyStopLatched, true);
  assert.notEqual(token, "");
});
