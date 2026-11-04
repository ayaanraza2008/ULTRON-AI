import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { EdgeTtsAdapter, EDGE_VOICES } from "../voice/edge-tts-adapter.js";

describe("Edge-TTS Neural Speech Adapter Suite", () => {
  test("lists supported multilingual voices including Hindi and English", () => {
    const adapter = new EdgeTtsAdapter();
    const voices = adapter.getVoices();

    assert.ok(voices.length >= 5);
    const voiceIds = voices.map(v => v.id);
    assert.ok(voiceIds.includes("hi-IN-MadhurNeural"));
    assert.ok(voiceIds.includes("hi-IN-SwaraNeural"));
    assert.ok(voiceIds.includes("en-US-ChristopherNeural"));
    assert.ok(voiceIds.includes("en-GB-RyanNeural"));
    assert.ok(voiceIds.includes("en-US-JennyNeural"));
  });

  test("builds valid SSML payload with prosody controls", () => {
    const adapter = new EdgeTtsAdapter();
    const ssml = adapter.buildSsml("Hello Ultron", {
      voice: "hi-IN-MadhurNeural",
      rate: "+10%",
      pitch: "+5Hz",
      volume: "+0%"
    });

    assert.ok(ssml.includes("<speak"));
    assert.ok(ssml.includes("xml:lang='hi-IN'"));
    assert.ok(ssml.includes("<voice name='hi-IN-MadhurNeural'>"));
    assert.ok(ssml.includes("rate='+10%'"));
    assert.ok(ssml.includes("pitch='+5Hz'"));
    assert.ok(ssml.includes("Hello Ultron"));
  });

  test("escapes XML special characters in SSML", () => {
    const adapter = new EdgeTtsAdapter();
    const ssml = adapter.buildSsml("Ultron & Naya <AI> 'test' \"quotes\"");

    assert.ok(ssml.includes("Ultron &amp; Naya &lt;AI&gt; &apos;test&apos; &quot;quotes&quot;"));
  });

  test("synthesizes neural audio buffer for Hindi input", async () => {
    const adapter = new EdgeTtsAdapter();
    const res = await adapter.synthesize("नमस्ते, मैं उल्ट्रॉन हूँ।", {
      voice: "hi-IN-MadhurNeural"
    });

    assert.equal(res.success, true);
    assert.equal(res.format, "audio/mpeg");
    assert.equal(res.voice, "hi-IN-MadhurNeural");
    assert.ok(Buffer.isBuffer(res.audioBuffer));
  });

  test("synthesizes neural audio buffer for English input", async () => {
    const adapter = new EdgeTtsAdapter();
    const res = await adapter.synthesize("Ultron systems online and operational.", {
      voice: "en-US-ChristopherNeural"
    });

    assert.equal(res.success, true);
    assert.equal(res.voice, "en-US-ChristopherNeural");
    assert.ok(Buffer.isBuffer(res.audioBuffer));
  });

  test("delegates to fallback engine on upstream network error", async () => {
    let fallbackCalled = false;
    const mockKokoro = {
      synthesize: async (text, options) => {
        fallbackCalled = true;
        return {
          id: "mock-kokoro-123",
          audioKind: "speech",
          voice: "am_onyx",
          dataUrl: "data:audio/wav;base64,UklGRg=="
        };
      }
    };

    const adapter = new EdgeTtsAdapter({
      fallbackEngine: mockKokoro,
      timeoutMs: 500
    });

    // Synthesize should fail upstream (404) and engage mockKokoro fallback
    const res = await adapter.synthesize("Testing fallback delegation.");
    assert.equal(fallbackCalled, true);
    assert.equal(res.success, true);
    assert.equal(res.engine, "kokoro_offline_fallback");
    assert.equal(res.fallbackEngaged, true);
  });

  test("truthfully reports failure when allowSimulatedFallback is false and no engine available", async () => {
    const adapter = new EdgeTtsAdapter({
      allowSimulatedFallback: false,
      timeoutMs: 500
    });

    const res = await adapter.synthesize("Testing strict error reporting.");
    assert.equal(res.success, false);
    assert.equal(res.engine, "edge_tts_failed");
    assert.ok(res.error.includes("Edge-TTS"));
  });

  test("supports barge-in interruption via stopSpeaking", () => {
    const adapter = new EdgeTtsAdapter();
    let interruptedFired = false;
    adapter.on("interrupted", () => { interruptedFired = true; });

    const res = adapter.stopSpeaking();
    assert.equal(res.stopped, true);
    assert.equal(interruptedFired, true);
  });

  test("rejects empty text parameter", async () => {
    const adapter = new EdgeTtsAdapter();
    await assert.rejects(
      async () => adapter.synthesize(""),
      /Text parameter is required/
    );
  });
});
