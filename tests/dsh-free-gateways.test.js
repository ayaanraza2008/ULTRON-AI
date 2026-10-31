import test from "node:test";
import assert from "node:assert/strict";
import {
  CLIENT_UA,
  FINGERPRINT_TOOLS,
  OFFICIAL_TOOL_DEFINITIONS,
  canonicalizeSession,
  isCanonicalSession,
  getEndpointForModel,
  prepareOpenCodePayload,
  getOpenCodeStatus,
} from "../integrations/dsh-god/open-code-gateway.js";
import { listKiloFreeModels, getKiloStatus } from "../integrations/dsh-god/kilo-gateway.js";
import { redact, redactObject, checkPrivacyClearance } from "../integrations/dsh-god/privacy-policy.js";

test("DSH OpenCode Gateway: mirrors official CLI v2.0.26 fingerprint and tool schema", () => {
  assert.equal(CLIENT_UA, "opencode/latest/2.0.26/cli");
  assert.deepEqual(FINGERPRINT_TOOLS, ["read", "shell"]);
  assert.equal(OFFICIAL_TOOL_DEFINITIONS.length, 2);

  const readTool = OFFICIAL_TOOL_DEFINITIONS.find(t => t.function.name === "read");
  assert.ok(readTool);
  assert.ok(readTool.function.description.includes("Read the contents of a file"));
  assert.ok(readTool.function.parameters.properties.path);

  const shellTool = OFFICIAL_TOOL_DEFINITIONS.find(t => t.function.name === "shell");
  assert.ok(shellTool);
  assert.ok(shellTool.function.description.includes("Execute a shell command"));
  assert.ok(shellTool.function.parameters.properties.command);
});

test("DSH OpenCode Gateway: session canonicalization produces valid inverted descending hex", () => {
  const session1 = canonicalizeSession("user_conversation_turn_1");
  assert.ok(isCanonicalSession(session1), `Session ${session1} must be canonical descending format`);

  const session2 = canonicalizeSession("user_conversation_turn_2");
  assert.ok(isCanonicalSession(session2));

  // Same seed produces stable session
  const session1Repeat = canonicalizeSession("user_conversation_turn_1");
  assert.equal(session1, session1Repeat);

  // Invalid strings are rejected
  assert.equal(isCanonicalSession("ses_1234"), false);
  assert.equal(isCanonicalSession("not_a_session"), false);
});

test("DSH OpenCode Gateway: resolves per-model endpoints and cleans payloads", () => {
  assert.equal(getEndpointForModel("deepseek-chat"), "/inference/v1/chat/completions");
  assert.equal(getEndpointForModel("muse-spark-1.2-contributor-free"), "/inference/v1/responses");
  assert.equal(getEndpointForModel("union-alpha"), "/inference/v1/messages");

  // Suppress tool_choice: "none"
  const rawPayload = {
    model: "deepseek-chat",
    messages: [{ role: "user", content: "hello" }],
    tool_choice: "none",
  };
  const clean = prepareOpenCodePayload(rawPayload);
  assert.equal(clean.tool_choice, undefined);
  assert.ok(clean.tools.some(t => t.function.name === "read"));
  assert.ok(clean.tools.some(t => t.function.name === "shell"));
});

test("DSH Kilo AI Gateway: returns free pool status and handles listing offline fallback", async () => {
  const status = getKiloStatus();
  assert.equal(status.lane, "kilo-free-pool");
  assert.equal(status.enabled, true);
  assert.ok(status.disclosure.includes("logged"));

  const models = await listKiloFreeModels({ forceRefresh: true });
  assert.ok(Array.isArray(models));
  assert.ok(models.length > 0);
  assert.ok(models.every(m => m.isFree === true));
});

test("DSH Privacy Policy: redacts API keys and secrets with zero trace leakage", () => {
  const textWithKey = "Connecting with sk-proj-1234567890abcdef1234567890 to endpoint";
  const redacted = redact(textWithKey);
  assert.ok(!redacted.includes("sk-proj-1234567890abcdef"));
  assert.ok(redacted.includes("[REDACTED_KEY]"));

  const obj = { apiKey: "secret_12345", nested: { token: "token_999", safe: "hello" } };
  const redObj = redactObject(obj);
  assert.equal(redObj.apiKey, "[REDACTED]");
  assert.equal(redObj.nested.token, "[REDACTED]");
  assert.equal(redObj.nested.safe, "hello");

  const safePrompt = checkPrivacyClearance("kilo", "How do I reverse a string in JavaScript?");
  assert.equal(safePrompt.allowed, true);

  const dangerousPrompt = checkPrivacyClearance("kilo", "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...");
  assert.equal(dangerousPrompt.allowed, false);
  assert.ok(dangerousPrompt.warning.includes("Blocking free-tier egress"));
});
