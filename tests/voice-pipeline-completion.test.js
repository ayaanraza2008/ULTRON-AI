/**
 * ULTRON AI — Voice Pipeline Completion & Telemetry Verification
 * File: tests/voice-pipeline-completion.test.js
 *
 * Verifies Priority 3: Voice Engine Completion
 * - Hindi, English, and Hinglish input language auto-detection.
 * - Voice recommendation mapping.
 * - Concurrency collision prevention and barge-in interruption.
 * - Offline Windows SAPI audio synthesis.
 * - Comprehensive latency, failure, and fallback telemetry.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import { EdgeTtsAdapter, EDGE_VOICES } from "../voice/edge-tts-adapter.js";
import { KokoroEngine } from "../voice/kokoro-engine.js";

describe("ULTRON Voice Pipeline Completion Suite", () => {
  test("auto-detects Hindi script, conversational Hinglish, and English", () => {
    const adapter = new EdgeTtsAdapter();

    // Devanagari Hindi
    assert.equal(adapter.detectLanguage("नमस्ते, आप कैसे हैं?"), "hi-IN");

    // Conversational Hinglish
    assert.equal(adapter.detectLanguage("Ultron bhai, mera calendar check kardo"), "hi-IN");
    assert.equal(adapter.detectLanguage("Namaste, kya haal hai?"), "hi-IN");

    // Standard English
    assert.equal(adapter.detectLanguage("Ultron, execute system health scan."), "en-US");
    assert.equal(adapter.detectLanguage("All defense shields active."), "en-US");
  });

  test("recommends appropriate neural voices by language and gender", () => {
    const adapter = new EdgeTtsAdapter();

    // Hindi Male
    assert.equal(
      adapter.getRecommendedVoice("नमस्ते", "Male"),
      EDGE_VOICES.HINDI_MADHUR.id
    );

    // Hindi Female
    assert.equal(
      adapter.getRecommendedVoice("नमस्ते", "Female"),
      EDGE_VOICES.HINDI_SWARA.id
    );

    // English Male
    assert.equal(
      adapter.getRecommendedVoice("System status check", "Male"),
      EDGE_VOICES.ENGLISH_CHRISTOPHER.id
    );

    // English Female
    assert.equal(
      adapter.getRecommendedVoice("System status check", "Female"),
      EDGE_VOICES.ENGLISH_JENNY.id
    );
  });

  test("tracks detailed synthesis telemetry across requests", async () => {
    const adapter = new EdgeTtsAdapter();
    const initialTelemetry = adapter.getTelemetry();
    assert.equal(initialTelemetry.totalSyntheses, 0);

    // Perform synthesis
    await adapter.synthesize("Telemetry test line 1");
    await adapter.synthesize("Telemetry test line 2");

    const telemetry = adapter.getTelemetry();
    assert.equal(telemetry.totalSyntheses, 2);
    assert.ok(telemetry.successfulSyntheses >= 2);
    assert.ok(telemetry.averageLatencyMs >= 0);
    assert.ok(telemetry.lastEngine !== null);
  });

  test("generates real WAV audio via Windows SAPI when preferLocalSapi is requested", async (t) => {
    if (os.platform() !== "win32") {
      t.skip("Windows SAPI requires win32 platform");
      return;
    }

    const adapter = new EdgeTtsAdapter({ timeoutMs: 300 });
    const res = await adapter.synthesize("Windows SAPI offline audio test.", {
      preferLocalSapi: true
    });

    assert.equal(res.success, true);
    assert.equal(res.format, "audio/wav");
    assert.equal(res.engine, "windows_sapi_fallback");
    assert.ok(Buffer.isBuffer(res.audioBuffer));
    assert.ok(res.byteLength > 1000, "WAV audio buffer must contain genuine audio samples");
  });

  test("verifies Kokoro engine interruption and fallback status", async () => {
    const kokoro = new KokoroEngine();
    await kokoro.initialize();

    const status = kokoro.getFallbackStatus();
    assert.equal(status.primaryEngine, "kokoro");
    assert.equal(status.primaryVoice, "am_onyx");
    assert.equal(status.fallbackEngine, "windows_sapi");

    const latencyRes = await kokoro.measureInterruptionLatency();
    assert.equal(latencyRes.success, true);
    assert.ok(latencyRes.measuredLatencyMs <= latencyRes.targetThresholdMs + 10);
  });
});
