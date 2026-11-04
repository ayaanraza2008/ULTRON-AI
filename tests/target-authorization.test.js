import test from "node:test";
import assert from "node:assert/strict";
import { TargetAuthorizationGateway, PERMITTED_ACTIVITIES, TARGET_TYPES } from "../security/target-authorization-gateway.js";
import { UltronGuardian } from "../security/ultron-guardian.js";

test("Target Authorization: Default local lab scope is seeded and active", () => {
  const gateway = new TargetAuthorizationGateway();
  const scopes = gateway.listScopes();

  assert.ok(scopes.length >= 1);
  const defaultScope = scopes.find(s => s.scopeId === "scope-local-default");
  assert.ok(defaultScope);
  assert.equal(defaultScope.isActive, true);
  assert.ok(defaultScope.targets.includes("localhost"));
  assert.ok(defaultScope.targets.includes("127.0.0.1"));
});

test("Target Authorization: Registers scope with valid owner approval and proof", () => {
  const gateway = new TargetAuthorizationGateway();
  const scope = gateway.registerScope({
    organization: "Acme Cyber Lab",
    owner: "Security Lead",
    targets: ["acme-internal.test", "api.acme-internal.test"],
    targetType: TARGET_TYPES.WEB_APP,
    permittedActivities: [PERMITTED_ACTIVITIES.PASSIVE_RECON, PERMITTED_ACTIVITIES.WEB_API_AUDIT],
    validDurationHours: 12,
    ownerApproved: true,
    authorizationProof: "WRITTEN_ENGAGEMENT_LETTER_REF_8819",
    emergencyContact: "sec-ops@acme-internal.test"
  });

  assert.ok(scope.scopeId.startsWith("scope-"));
  assert.equal(scope.organization, "Acme Cyber Lab");
  assert.equal(scope.ownerApproved, true);

  // Assertion succeeds for authorized target and activity
  const auth = gateway.assertAuthorization("api.acme-internal.test", PERMITTED_ACTIVITIES.WEB_API_AUDIT);
  assert.equal(auth.authorized, true);
  assert.equal(auth.organization, "Acme Cyber Lab");
});

test("Target Authorization: Rejects registration without owner approval or proof", () => {
  const gateway = new TargetAuthorizationGateway();

  assert.throws(
    () => gateway.registerScope({
      organization: "Unauthorized Org",
      targets: ["unauthorized.com"],
      ownerApproved: false // Missing approval
    }),
    /Explicit owner approval and verified authorization proof are mandatory/
  );
});

test("Target Authorization: Blocks unauthorized target with TARGET_OUT_OF_SCOPE", () => {
  const gateway = new TargetAuthorizationGateway();

  assert.throws(
    () => gateway.assertAuthorization("target-never-authorized.com", PERMITTED_ACTIVITIES.VULNERABILITY_SCAN),
    /TARGET_OUT_OF_SCOPE/
  );
});

test("Target Authorization: Blocks non-permitted activity with ACTIVITY_NOT_PERMITTED", () => {
  const gateway = new TargetAuthorizationGateway();
  gateway.registerScope({
    organization: "Recon Only Org",
    targets: ["recon-only.test"],
    permittedActivities: [PERMITTED_ACTIVITIES.PASSIVE_RECON],
    ownerApproved: true,
    authorizationProof: "PROOF-RECON-ONLY"
  });

  // Passive recon is allowed
  const auth = gateway.assertAuthorization("recon-only.test", PERMITTED_ACTIVITIES.PASSIVE_RECON);
  assert.equal(auth.authorized, true);

  // Vulnerability scan is blocked
  assert.throws(
    () => gateway.assertAuthorization("recon-only.test", PERMITTED_ACTIVITIES.VULNERABILITY_SCAN),
    /ACTIVITY_NOT_PERMITTED/
  );
});

test("Target Authorization: Emergency stop halts all security testing", () => {
  const guardian = new UltronGuardian({ masterKey: "test-operator-master-key-at-least-32-chars" });
  const gateway = new TargetAuthorizationGateway({ guardian });

  // Engage emergency stop
  gateway.engageEmergencyStop("Operator flagged anomalous traffic");
  assert.equal(gateway.emergencyStopEngaged, true);

  // Even authorized localhost target is blocked
  assert.throws(
    () => gateway.assertAuthorization("localhost", PERMITTED_ACTIVITIES.PASSIVE_RECON),
    /EMERGENCY_STOP/
  );

  // Disengage requires master key
  assert.throws(
    () => gateway.disengageEmergencyStop("wrong-key"),
    /Invalid or unconfigured operator authorization key/
  );

  const resume = gateway.disengageEmergencyStop("test-operator-master-key-at-least-32-chars");
  assert.equal(resume.success, true);
  assert.equal(gateway.emergencyStopEngaged, false);
});
