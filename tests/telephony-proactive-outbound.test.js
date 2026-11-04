import test from "node:test";
import assert from "node:assert/strict";
import { TelephonyGateway, CALL_STATES } from "../telephony/telephony-gateway.js";

test("TelephonyGateway outbound: blocked when owner outbound consent is not granted", () => {
  const gateway = new TelephonyGateway();
  const outcome = gateway.placeCall({ ownerUserId: "owner-user", to: "+919876543210", reason: "Scheduled task complete" });
  assert.equal(outcome.success, false);
  assert.equal(outcome.blocked, true);
  assert.equal(outcome.reason, "OUTBOUND_CALL_CONSENT_REQUIRED");
});

test("TelephonyGateway outbound: allowed when owner consent + destination allowlist permit", () => {
  const gateway = new TelephonyGateway();
  gateway.authorizeOutboundCalling("owner-user", { enabled: true, phoneNumbers: ["+919876543210"] });
  const outcome = gateway.placeCall({ ownerUserId: "owner-user", to: "+919876543210", reason: "Scheduled task complete" });
  assert.equal(outcome.success, true);
  assert.equal(outcome.blocked, false);
  assert.equal(outcome.direction, "OUTBOUND");
  assert.equal(outcome.state, CALL_STATES.RINGING);
  assert.equal(gateway.getActiveCalls().length, 1);
});

test("TelephonyGateway outbound: blocked when destination is not owner-authorized", () => {
  const gateway = new TelephonyGateway();
  gateway.authorizeOutboundCalling("owner-user", { enabled: true, phoneNumbers: ["+919876543210"] });
  const outcome = gateway.placeCall({ ownerUserId: "owner-user", to: "+15550100", reason: "Proactive check-in" });
  assert.equal(outcome.success, false);
  assert.equal(outcome.blocked, true);
  assert.equal(outcome.reason, "OUTBOUND_CALL_TARGET_NOT_AUTHORIZED");
});

test("TelephonyGateway outbound: emergency requires emergency opt-in before placing", () => {
  const gateway = new TelephonyGateway();
  gateway.authorizeOutboundCalling("owner-user", { enabled: true, phoneNumbers: ["+919876543210"], allowEmergency: false });
  const outcome = gateway.placeCall({ ownerUserId: "owner-user", to: "+919876543210", reason: "EMERGENCY_ALERT", type: "EMERGENCY" });
  assert.equal(outcome.success, false);
  assert.equal(outcome.blocked, true);
  assert.equal(outcome.reason, "OUTBOUND_CALL_EMERGENCY_CONSENT_REQUIRED");
});

test("TelephonyGateway outbound: emergency allowed with emergency opt-in and emergency contact", () => {
  const gateway = new TelephonyGateway();
  gateway.authorizeOutboundCalling("owner-user", { enabled: true, phoneNumbers: ["+919876543210"], allowEmergency: true });
  gateway.setEmergencyContacts("owner-user", ["+919876543210"]);
  const outcome = gateway.placeCall({ ownerUserId: "owner-user", to: "+919876543210", reason: "EMERGENCY_ALERT", type: "EMERGENCY" });
  assert.equal(outcome.success, true);
  assert.equal(outcome.blocked, false);
});
