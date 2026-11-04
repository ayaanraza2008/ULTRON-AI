# ULTRON AI — Voice Synthesis & Edge-TTS Verification Report

**Date:** November 4, 2026  
**Auditor:** Antigravity Advanced Agentic Coding System  
**Audit Branch:** `audit/ultron-combined-integration-verification`  
**Modules Audited:** `voice/edge-tts-adapter.js`, `core/tool-registry.js`, `voice/kokoro-engine.js`  

---

## 1. Adversarial Unmasking of Baseline Edge-TTS

### The Claimed Behavior
The integration report claimed that a zero-dependency, zero-cost multilingual Edge-TTS neural speech client had been integrated from Source B ULTRONMAIN, producing live Hindi and English speech without third-party services.

### The Adversarial Probe
During the audit, network requests made by `EdgeTtsAdapter._fetchEdgeAudio` were intercepted and inspected.

1. **Protocol Mismatch:**
   The adapter attempted to send an HTTP POST request with an SSML payload to:
   ```
   https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1
   ```
   Microsoft Edge's read-aloud service deprecated raw HTTP POST endpoints in favor of an authenticated WebSocket protocol (`wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=...`). Consequently, the Bing HTTP endpoint returns:
   ```
   HTTP/1.1 404 Not Found
   ```
2. **The Swallowed Error & Fake Audio Buffer:**
   In the baseline commit `5c2c3613`:
   ```javascript
   try {
     const res = await fetch(endpoint, ...);
     if (res.ok) { ... }
   } catch {}

   // Return valid audio frame buffer
   const mockMp3Frame = Buffer.alloc(1024, 0xFF);
   mockMp3Frame[1] = 0xFB; // MPEG-1 Layer 3 sync word
   return mockMp3Frame;
   ```
   When the fetch failed or returned HTTP 404, the catch block silently swallowed the failure and returned a dummy 1024-byte buffer containing `0xFF` and `0xFB` bytes!
   The public method `synthesize()` then wrapped this dummy buffer and returned:
   ```javascript
   {
     success: true,
     audioBuffer: mockMp3Frame,
     format: "audio/mpeg",
     voice: "en-US-ChristopherNeural",
     engine: "edge_tts",
     byteLength: 1024
   }
   ```
   **This was a critical finding:** The system claimed live `edge_tts` cloud synthesis succeeded, when in reality it was returning dummy bytes because the cloud endpoint returned 404!

---

## 2. Hardened Architecture & Automatic Kokoro Fallback

### The Solution
1. **No Fake Success:** Swallowing HTTP errors is strictly eliminated. If the upstream network fails or returns 404, `_fetchEdgeAudio` throws an explicit error: `Edge-TTS upstream HTTP error: 404 Not Found`.
2. **Automatic Kokoro Fallback:**
   When an upstream network failure occurs, `synthesize()` catches the error, emits `synthesis_failed`, and checks `this.fallbackEngine`.
   In `core/tool-registry.js`, `defaultEdgeTtsAdapter.fallbackEngine` is automatically wired to `this.adapters.kokoroEngine`.
   Kokoro Engine synthesizes speech locally via CPU using the audited `am_onyx` voice, returning:
   ```javascript
   {
     success: true,
     ...kokoroPayload,
     engine: "kokoro_offline_fallback",
     fallbackEngaged: true,
     primaryError: "Edge-TTS upstream HTTP error: 404 Not Found"
   }
   ```
3. **Truthful Offline Mode:**
   If no fallback engine is configured, and `allowSimulatedFallback` is enabled, the result explicitly reports `engine: "simulated_offline_fallback"` with `simulated: true`.
   If `allowSimulatedFallback` is false, it returns `{ success: false, engine: "edge_tts_failed" }`.
   **Live Edge-TTS success is NEVER claimed unless real cloud audio bytes were received.**

---

## 3. Multilingual Voice Inventory & SSML Generation

### Voice Profiles Supported
- **Hindi Neural Voices:**
  - `hi-IN-MadhurNeural` (Hindi Male — Conversational, Natural)
  - `hi-IN-SwaraNeural` (Hindi Female — Calm, Clear)
- **English Neural Voices:**
  - `en-US-ChristopherNeural` (US Male — Authoritative, Deep)
  - `en-GB-RyanNeural` (UK Male — Sophisticated)
  - `en-US-JennyNeural` (US Female — Expressive)

### SSML & Character Escaping
SSML is generated with dynamic prosody control:
```xml
<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='hi-IN'>
  <voice name='hi-IN-MadhurNeural'>
    <prosody pitch='+0Hz' rate='+0%' volume='+0%'>
      नमस्ते, मैं उल्ट्रॉन हूँ।
    </prosody>
  </voice>
</speak>
```
All XML metacharacters (`&`, `<`, `>`, `"`, `'`) are escaped strictly to prevent SSML injection.

### Barge-In Interruption Support
`stopSpeaking()` sets `isPlaying = false`, aborts the current audio stream, and emits the `interrupted` event with a microsecond-accurate timestamp.

---

## 4. Voice Subsystem Verification Matrix

| Capability | Initial Audit Finding | Hardened Status | Test Evidence |
| :--- | :--- | :--- | :--- |
| **Edge HTTP Cloud API** | Returns HTTP 404 on readaloud REST | **PARTIAL (Upstream Protocol)** | Verified: Throws upstream HTTP error |
| **Mock Buffer Swallowing** | Swallowed 404 and returned dummy buffer | **ELIMINATED** | Verified: Never reports fake `edge_tts` success |
| **Kokoro CPU Fallback** | Fallback was unwired (`null`) | **OPERATIONAL** | Verified: Delegates to Kokoro with `engine: "kokoro_offline_fallback"` |
| **Multilingual Voices** | 5 voices (Hindi + English) | **PASS** | Verified across all 5 profiles |
| **SSML Prosody & Escaping**| Clean XML generation & escaping | **PASS** | Special characters tested & escaped |
| **Barge-In Interruption** | Emits `interrupted` event | **PASS** | Verified in test suite |
