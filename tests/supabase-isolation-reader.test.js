import test from "node:test";
import assert from "node:assert/strict";
import { readJsonLimited } from "../scripts/supabase-e2e-response.js";

test("Supabase E2E JSON reader parses bounded streaming JSON and rejects oversized payloads", async () => {
  assert.deepEqual(await readJsonLimited(new Response(JSON.stringify({ ok: true })), 100), { ok: true });
  await assert.rejects(readJsonLimited(new Response("x".repeat(1000)), 32), /exceeded the configured size limit/);
});

test("Supabase E2E JSON reader refuses non-streaming response fallbacks before reading", async () => {
  let textCalls = 0;
  const nonStreaming = {
    headers: { get: () => null },
    text: async () => { textCalls += 1; return "x".repeat(10_000_000); }
  };
  await assert.rejects(readJsonLimited(nonStreaming, 10), /without a streaming body/);
  assert.equal(textCalls, 0);
});

test("Supabase E2E JSON reader rejects malformed JSON clearly", async () => {
  await assert.rejects(readJsonLimited(new Response("not-json"), 100), /returned malformed JSON/);
});
