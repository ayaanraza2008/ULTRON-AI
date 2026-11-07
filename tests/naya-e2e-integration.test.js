import test from "node:test";
import assert from "node:assert/strict";
import { nayaPersonalitySystem, NAYA_PERSONALITY_MODES } from "../intelligence/naya/index.js";
import { createApp } from "../server.js";

test("NAYA E2E Integration: Endpoints and personality modes via live server", async () => {
  const env = {
    PORT: "0",
    ACCESS_PASSWORD: "test-access-password",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
    ULTRON_OWNER_USER_ID: "owner-user-123"
  };

  const app = createApp({ env, logger: { info() {}, warn() {}, error() {} } });
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. GET /api/naya/personality/modes
    const modesRes = await fetch(`${baseUrl}/api/naya/personality/modes`);
    assert.equal(modesRes.status, 200);
    const modesData = await modesRes.json();
    assert.equal(modesData.success, true);
    assert.equal(modesData.modes.length, 20, "Must return all 20 ERA modes");
    assert.ok(modesData.modes.some(m => m.id === "PROFESSIONAL_JARVIS"));
    assert.ok(modesData.modes.some(m => m.id === "AUTONOMOUS_AGENT"));

    // 2. GET /api/health
    const healthRes = await fetch(`${baseUrl}/api/health`);
    assert.equal(healthRes.status, 200);
    const healthData = await healthRes.json();
    assert.equal(healthData.status, "ok");
    assert.equal(healthData.app, "ULTRON AI");

    // 3. POST /api/chat with persona: "naya" and personalityMode: "CODING_PARTNER"
    // Auth is required for /api/chat, returns 401 when unauthenticated
    const unauthChat = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Review my code" }],
        persona: "naya",
        personalityMode: "CODING_PARTNER"
      })
    });
    assert.ok([401, 503].includes(unauthChat.status), "Chat endpoint enforces security / configuration boundary");

    // 4. Verify NAYA prompt generation matches CODING_PARTNER
    const prompt = nayaPersonalitySystem.generateSystemPrompt({
      mode: NAYA_PERSONALITY_MODES.CODING_PARTNER
    });
    assert.ok(prompt.includes("NAYA — AUTONOMOUS INTELLIGENCE CORE"));
    assert.ok(prompt.includes("CODING PARTNER"));
    assert.ok(prompt.includes("10x pair programmer"));

    // 5. Verify ULTRON primary identity is completely preserved and distinct
    const ultronPromptFragment = "You are ULTRON, the primary AI personality: confident, strategic, direct";
    assert.ok(!prompt.includes(ultronPromptFragment), "NAYA system prompt must not masquerade as ULTRON");

  } finally {
    await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
});
