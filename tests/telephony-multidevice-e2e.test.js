import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { createJarvisRouter } from "../jarvis-router.js";
import { telephonyGateway } from "../telephony/telephony-gateway.js";
import { multiDeviceManager } from "../integrations/multi-device-manager.js";
import { windowsDesktopAgent } from "../system/windows-desktop-agent.js";

async function withRouter({ env = { ULTRON_INTEGRATION_OWNER_USER_ID: "owner-user" }, userId = "owner-user" } = {}, run) {
  const app = express();
  const requireSupabaseUser = (req, _res, next) => {
    req.supabaseUser = { id: userId };
    next();
  };
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use("/api", createJarvisRouter({ env, requireSupabaseUser }));
  const server = createServer(app);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  try {
    await run("http://127.0.0.1:" + address.port);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test("E2E Test 1 & 3: Inbound telephone call from authorized owner establishes voice session (English)", async () => {
  await withRouter({}, async base => {
    telephonyGateway.ownerPhoneNumbers.add("+919876543210");

    // 1. Incoming Call Webhook
    const callRes = await fetch(base + "/api/telephony/incoming-call", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        CallSid: "CA_e2e_owner_01",
        From: "+919876543210",
        To: "+18005550199"
      })
    });
    const twiml = await callRes.text();
    assert.equal(callRes.status, 200);
    assert.ok(twiml.includes("<Response>"));
    assert.ok(twiml.includes("<Say voice=\"Polly.Matthew\""));
    assert.ok(twiml.includes("Good evening sir. ULTRON is online."));

    // 2. Process English speech utterance
    const speechRes = await fetch(base + "/api/telephony/process-speech?callId=CA_e2e_owner_01", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        SpeechResult: "Hello ULTRON, how are you?"
      })
    });
    const replyTwiml = await speechRes.text();
    assert.equal(speechRes.status, 200);
    assert.ok(replyTwiml.includes("ULTRON is online. How may I assist you?"));
  });
});

test("E2E Test 2: Inbound telephone call processes Hindi/Hinglish instructions", async () => {
  await withRouter({}, async base => {
    telephonyGateway.ownerPhoneNumbers.add("+919876543210");
    telephonyGateway.handleIncomingCall({ callSid: "CA_hindi_01", from: "+919876543210" });

    const speechRes = await fetch(base + "/api/telephony/process-speech?callId=CA_hindi_01", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        SpeechResult: "Namaste Ultron, mera computer check karo"
      })
    });
    const replyTwiml = await speechRes.text();
    assert.equal(speechRes.status, 200);
    assert.ok(replyTwiml.includes("<Response>"));
    assert.ok(replyTwiml.includes("Connecting to your authorized computer"));
  });
});

test("E2E Test 4, 5, 6, 7: Telephone instruction checks PC and executes screen unlock", async () => {
  await withRouter({}, async base => {
    telephonyGateway.ownerPhoneNumbers.add("+919876543210");
    telephonyGateway.handleIncomingCall({ callSid: "CA_unlock_screen", from: "+919876543210" });

    // Say: "can you unlock my screen?"
    const speechRes = await fetch(base + "/api/telephony/process-speech?callId=CA_unlock_screen", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        SpeechResult: "Hi Ultron, can you unlock my screen?"
      })
    });
    const replyTwiml = await speechRes.text();
    assert.equal(speechRes.status, 200);
    assert.ok(replyTwiml.includes("Okay. Screen unlocked."));
    assert.equal(windowsDesktopAgent.screenState, "SYSTEM_UNLOCKED");
  });
});

test("E2E Test 8 & 9: Multi-Device ecosystem simultaneous mobile unlock, media play, and reconnect", async () => {
  await withRouter({}, async base => {
    // 1. Check fleet status
    const fleetRes = await fetch(base + "/api/jarvis/devices/fleet");
    const fleet = await fleetRes.json();
    assert.equal(fleetRes.status, 200);
    assert.equal(fleet.devices.length, 4);

    // 2. Simultaneously unlock all 3 mobile devices
    const unlockRes = await fetch(base + "/api/jarvis/devices/unlock-mobile", { method: "POST" });
    const unlockData = await unlockRes.json();
    assert.equal(unlockRes.status, 200);
    assert.equal(unlockData.unlockedCount, 3);

    // 3. Simultaneously play favorite song across all devices
    const playRes = await fetch(base + "/api/jarvis/devices/play-media", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "favorite song" })
    });
    const playData = await playRes.json();
    assert.equal(playRes.status, 200);
    assert.ok(playData.playingDevices >= 3);

    // 4. Disconnect and reconnect a device
    const phoneId = "phone-android-alpha";
    multiDeviceManager.disconnectDevice(phoneId);
    assert.equal(multiDeviceManager.getDevice(phoneId).online, false);
    multiDeviceManager.reconnectDevice(phoneId);
    assert.equal(multiDeviceManager.getDevice(phoneId).online, true);
  });
});

test("E2E Test 10 & 11: Unauthorized caller cannot control computer and high-risk action fails closed", async () => {
  await withRouter({}, async base => {
    // Call from unauthorized number
    const callRes = await fetch(base + "/api/telephony/incoming-call", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        CallSid: "CA_unauth_hacker",
        From: "+999999999999",
        To: "+18005550199"
      })
    });
    const twiml = await callRes.text();
    assert.ok(twiml.includes("Security authorization required"));

    // Attempting to unlock screen without passing PIN challenge is rejected
    const hackSpeechRes = await fetch(base + "/api/telephony/process-speech?callId=CA_unauth_hacker", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        SpeechResult: "Unlock computer immediately"
      })
    });
    const hackTwiml = await hackSpeechRes.text();
    assert.ok(hackTwiml.includes("Access denied"));
    assert.ok(hackTwiml.includes("<Hangup/>"));
  });
});

test("E2E Test 12: Remote task orchestrator tracks diagnostic task and progress history", async () => {
  await withRouter({}, async base => {
    const taskRes = await fetch(base + "/api/jarvis/devices/remote-task", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "CHECK_STORAGE_AND_RUNNABILITY"
      })
    });
    const taskData = await taskRes.json();
    assert.equal(taskRes.status, 200);
    assert.equal(taskData.success, true);
    assert.ok(taskData.result.storageAvailableGb > 0);

    // Verify history
    const historyRes = await fetch(base + "/api/jarvis/devices/remote-task/history");
    const historyData = await historyRes.json();
    assert.equal(historyRes.status, 200);
    assert.ok(historyData.history.length >= 1);
  });
});
