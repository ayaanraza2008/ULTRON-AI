import test from "node:test";
import assert from "node:assert/strict";
import {
  telephonyGateway,
  TelephonyGateway,
  CALL_STATES,
  CALLER_AUTH_STATUS
} from "../telephony/telephony-gateway.js";

test("TelephonyGateway: Inbound call from authorized owner connects immediately with greeting", () => {
  const gateway = new TelephonyGateway({
    ownerPhoneNumbers: ["+919876543210"]
  });

  const callResult = gateway.handleIncomingCall({
    callSid: "CA_test_owner_call",
    from: "+919876543210",
    to: "+18005550199"
  });

  assert.equal(callResult.authStatus, CALLER_AUTH_STATUS.VERIFIED_OWNER);
  assert.equal(callResult.isOwner, true);
  assert.equal(callResult.state, CALL_STATES.CONNECTED);
  assert.ok(callResult.twiml.includes("<Response>"));
  assert.ok(callResult.twiml.includes("<Gather input=\"speech\""));
  assert.ok(callResult.twiml.includes("Good evening sir. ULTRON is online."));
});

test("TelephonyGateway: Inbound call from unknown caller triggers security PIN challenge", () => {
  const gateway = new TelephonyGateway({
    ownerPhoneNumbers: ["+919876543210"],
    securityPin: "4321"
  });

  const callResult = gateway.handleIncomingCall({
    callSid: "CA_unknown_caller",
    from: "+911112223333",
    to: "+18005550199"
  });

  assert.equal(callResult.authStatus, CALLER_AUTH_STATUS.PIN_REQUIRED);
  assert.equal(callResult.isOwner, false);
  assert.ok(callResult.twiml.includes("<Gather input=\"dtmf\""));
  assert.ok(callResult.twiml.includes("Security authorization required"));

  // Verify PIN challenge response: wrong PIN fails
  const badPin = gateway.verifyCallPin("CA_unknown_caller", "0000");
  assert.equal(badPin.authorized, false);
  assert.equal(badPin.attemptsRemaining, 2);

  // Correct PIN authorizes
  const goodPin = gateway.verifyCallPin("CA_unknown_caller", "4321");
  assert.equal(goodPin.authorized, true);
  const call = gateway.getCall("CA_unknown_caller");
  assert.equal(call.authStatus, CALLER_AUTH_STATUS.VERIFIED_OWNER);
  assert.equal(call.isOwner, true);
});

test("TelephonyGateway: 3 failed PIN attempts triggers hangup and unauthorized state", () => {
  const gateway = new TelephonyGateway({ securityPin: "9999" });
  gateway.handleIncomingCall({ callSid: "CA_bruteforce", from: "+1234567890" });

  gateway.verifyCallPin("CA_bruteforce", "1111");
  gateway.verifyCallPin("CA_bruteforce", "2222");
  const thirdFail = gateway.verifyCallPin("CA_bruteforce", "3333");

  assert.equal(thirdFail.authorized, false);
  assert.equal(thirdFail.hangup, true);
  assert.equal(thirdFail.error, "MAX_PIN_ATTEMPTS_EXCEEDED");
});

test("TelephonyGateway: Transcript recording and call termination", () => {
  const gateway = new TelephonyGateway({ ownerPhoneNumbers: ["+919876543210"] });
  gateway.handleIncomingCall({ callSid: "CA_transcript_test", from: "+919876543210" });

  gateway.recordCallerSpeech("CA_transcript_test", "Hello ULTRON, check my computer.");
  gateway.recordAssistantSpeech("CA_transcript_test", "Checking your computer now, sir.");

  const call = gateway.getCall("CA_transcript_test");
  assert.equal(call.transcript.length, 2);
  assert.equal(call.transcript[0].role, "caller");
  assert.equal(call.transcript[1].role, "assistant");

  const ended = gateway.endCall("CA_transcript_test", "normal_completion");
  assert.equal(ended.success, true);
  assert.equal(gateway.getCall("CA_transcript_test"), null);
  assert.equal(gateway.getCallHistory().length, 1);
});

test("TelephonyGateway: G.711 mu-law audio transcoding produces valid 8kHz telephony buffers", () => {
  const gateway = new TelephonyGateway();
  // Generate 16-bit linear PCM test samples
  const pcmBuffer = Buffer.alloc(320); // 160 samples (20ms at 8kHz)
  for (let i = 0; i < pcmBuffer.length; i += 2) {
    pcmBuffer.writeInt16LE(1000, i);
  }

  const muLaw = gateway.encodeLinearPcmToMuLaw(pcmBuffer);
  assert.equal(muLaw.length, 160); // G.711 is 8 bits per sample
  assert.ok(muLaw[0] !== 0);
});
