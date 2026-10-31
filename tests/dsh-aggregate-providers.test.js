import test from "node:test";
import assert from "node:assert/strict";
import { resolveProviderAuth, getProvider } from "../integrations/dsh-god/provider-registry.js";
import { dispatchProviderTurn } from "../integrations/dsh-god/aggregate-providers.js";

test("DSH Aggregate Providers: resolves auth and headers for chat, responses, and messages", () => {
  const groqAuth = resolveProviderAuth("groq");
  assert.equal(groqAuth.providerId, "groq");
  assert.equal(groqAuth.format, "openai-chat");
  assert.equal(groqAuth.authKind, "apiKey");

  const cohereAuth = resolveProviderAuth("cohere");
  assert.equal(cohereAuth.providerId, "cohere");
  assert.equal(cohereAuth.format, "openai-chat");

  const anthropic = getProvider("anthropic");
  if (anthropic) {
    const anthAuth = resolveProviderAuth("anthropic");
    assert.equal(anthAuth.format, "anthropic-messages");
  }
});

test("DSH Aggregate Providers: parses composite target and catches missing baseUrl", async () => {
  await assert.rejects(
    async () => {
      await dispatchProviderTurn({
        target: "invalid_target_without_slash",
        messages: [{ role: "user", content: "hello" }],
      });
    },
    /Invalid target format/
  );

  await assert.rejects(
    async () => {
      await dispatchProviderTurn({
        target: "nonexistent_provider/some-model",
        messages: [{ role: "user", content: "hello" }],
      });
    },
    /Invalid target format/
  );
});
