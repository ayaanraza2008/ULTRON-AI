import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createUltronCoreProxy } from "../core-ui-proxy.mjs";

const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const proxySource = await readFile(new URL("../core-ui-proxy.mjs", import.meta.url), "utf8");

test("the default screen is a black, minimal living-core interface", () => {
  assert.match(html, /id="core-canvas"/);
  assert.match(html, /id="core-stage"/);
  assert.match(css, /--black:\s*#020205/);
  assert.match(css, /\.core-orbit/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(app, /drawArrays\(gl\.POINTS, 0, PARTICLE_COUNT\)/);
  assert.match(app, /const PARTICLE_COUNT = 20000/);
  assert.match(app, /#version 300 es/);
  assert.match(app, /gl_VertexID/);
});

test("center label is removed without crashing core initialization", () => {
  assert.doesNotMatch(html, /class="core-wordmark"/);
  assert.doesNotMatch(html, /class="core-word"/);
  assert.ok(app.includes("if (ui.coreStateLabel) ui.coreStateLabel.textContent"));
  assert.ok(app.includes('setCoreState("idle");\n  startParticleCore();'));
});

test("the glass drawer includes eyes, tools, devices, and readiness panels", () => {
  assert.match(html, /id="drawer-toggle"/);
  assert.match(html, /id="feature-drawer"/);
  for (const feature of ["eyes", "voice-quality", "tasks", "apps", "devices", "control", "system"]) {
    assert.ok(html.includes('data-drawer-view="' + feature + '"'));
  }
  assert.ok(app.includes("function showDrawerView"));
  assert.ok(app.includes("function addCustomConnectorBrief"));
  assert.ok(app.includes("function checkBackend"));
});

test("full system control is an explicit scoped request, never a fake takeover", () => {
  assert.match(html, /data-drawer-view="control"/);
  assert.ok(app.includes('if (name === "control")'));
  assert.ok(app.includes('requestButton.textContent = "REQUEST CONTROL SESSION"'));
  assert.ok(app.includes('requestButton.disabled = selected.size === 0 || !desktopConfigured'));
  assert.ok(app.includes("Status: PREPARED ONLY — NOT ACTIVE"));
  assert.ok(app.includes("current companion adapter is read-only"));
  assert.match(css, /\.system-control-nav/);
});

test("camera access is explicitly permissioned and camera frames can reach vision chat", () => {
  assert.match(html, /id="eye-video"/);
  assert.match(html, /id="camera-live-observe"/);
  assert.ok(app.includes("navigator.mediaDevices.getUserMedia"));
  assert.ok(app.includes("function captureCameraFrame"));
  assert.ok(app.includes("function analyzeCameraFrame"));
  assert.ok(app.includes('[{ dataUrl }]'));
  assert.ok(app.includes("...(attachments.length ? { attachments } : {})"));
  assert.ok(proxySource.includes("camera=(self)"));
  assert.ok(proxySource.includes("microphone=(self)"));
});

test("API errors are explicit instead of crashing the interface silently", () => {
  assert.ok(app.includes("CORE_LINK_FAILED"));
  assert.ok(app.includes("ACCESS SETUP REQUIRED"));
  assert.ok(app.includes("MODEL PROVIDER NOT READY"));
  assert.ok(app.includes("VISION_MODEL_NOT_CONFIGURED"));
});

test("voice mode hides the text box by default and offers an optional open-input control", () => {
  assert.match(html, /id="message-form" class="message-shell" hidden/);
  assert.match(html, /id="open-text-input"/);
  assert.match(app, /ui\.messageForm\.hidden = !composerVisible/);
  assert.match(app, /const composerVisible = mode === "text" \|\| textInputOpen/);
  assert.match(app, /function openOptionalTextInput/);
  assert.match(app, /instance\.continuous = true/);
  assert.match(app, /instance\.interimResults = true/);
  assert.match(app, /scheduleRecognitionRestart/);
});

test("mute is only visible and actionable in Text Mode", () => {
  assert.match(html, /id="mute-toggle"[^>]*hidden/);
  assert.match(app, /ui\.muteToggle\.hidden = mode !== "text"/);
  assert.match(app, /function toggleMute\(\) \{\s*if \(mode !== "text"\) return;/);
  assert.match(app, /function speakResponse/);
});

test("tasks render transient holographic panels with real sources and completion states", () => {
  assert.match(html, /id="task-panel"[^>]*hidden/);
  assert.match(app, /function openTaskPanel/);
  assert.match(app, /function markTaskComplete/);
  assert.match(app, /function schedulePanelHide/);
  assert.ok(app.includes('apiRequest("/api/research"'));
  assert.match(app, /safeUrl\.protocol !== "https:"/);
  assert.match(css, /\.holo-panel\[hidden\]/);
});

test("the interface uses same-origin backend requests and a fixed ULTRON CORE upstream", () => {
  assert.match(app, /credentials: "same-origin"/);
  assert.match(proxySource, /https:\/\/ultron-ai-core\.onrender\.com/);
  assert.match(proxySource, /requestUrl\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(proxySource, /new URL\(requestUrl\.pathname \+ requestUrl\.search, CORE_API_ORIGIN\)/);
  assert.match(proxySource, /forwardedRequestHeaders/);
  assert.match(proxySource, /getSetCookie/);
  assert.doesNotMatch(html, /<script[^>]+src=["']https?:/i);
});

test("the proxy serves local assets and does not forward unknown public paths", async (t) => {
  const calls = [];
  const proxy = createUltronCoreProxy({
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ status: "ok", app: "ULTRON AI" }), {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" }
      });
    },
    logger: { warn() {} }
  });
  await new Promise((resolve, reject) => {
    proxy.once("error", reject);
    proxy.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise(resolve => proxy.close(() => resolve())));
  const address = proxy.address();
  const base = "http://127.0.0.1:" + address.port;

  const page = await fetch(base + "/");
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type") || "", /text\/html/);
  assert.match(await page.text(), /ULTRON AI — Living Core/);
  assert.equal(calls.length, 0);

  const unknown = await fetch(base + "/admin-secret");
  assert.equal(unknown.status, 404);
  assert.equal(calls.length, 0);

  const health = await fetch(base + "/api/health", { headers: { Cookie: "ultron_sb_access=test-cookie" } });
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok", app: "ULTRON AI" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://ultron-ai-core.onrender.com/api/health");
  assert.equal(calls[0].init.headers.get("cookie"), "ultron_sb_access=test-cookie");
});


test("API gateway errors are retried only when they are non-JSON responses", () => {
  assert.ok(proxySource.includes('gatewayRetryDelaysMs = [1500, 3000, 5000, 7000, 9000, 10000, 12000, 12000, 12000]'));
  assert.ok(proxySource.includes('status === 502 ? "CORE_GATEWAY_502"'));
  assert.ok(proxySource.includes('" retries (" + (gatewayRetries + 1) + " attempts)'));
});

test("proxy retries a transient HTML 502 once and returns the backend response", async (t) => {
  let calls = 0;
  const proxy = createUltronCoreProxy({
    gatewayRetryDelaysMs: [0],
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        return new Response("<html>502 Bad Gateway</html>", {
          status: 502,
          headers: { "Content-Type": "text/html" }
        });
      }
      return new Response(JSON.stringify({ status: "ok", answer: "recovered" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    },
    logger: { warn() {} }
  });
  await new Promise((resolve, reject) => {
    proxy.once("error", reject);
    proxy.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise(resolve => proxy.close(() => resolve())));
  const response = await fetch("http://127.0.0.1:" + proxy.address().port + "/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] })
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok", answer: "recovered" });
  assert.equal(calls, 2);
});

test("proxy turns a persistent non-JSON gateway 502 into an actionable API error", async (t) => {
  let calls = 0;
  const proxy = createUltronCoreProxy({
    gatewayRetryDelaysMs: [0],
    fetchImpl: async () => {
      calls += 1;
      return new Response("<html>502 Bad Gateway</html>", {
        status: 502,
        headers: { "Content-Type": "text/html" }
      });
    },
    logger: { warn() {} }
  });
  await new Promise((resolve, reject) => {
    proxy.once("error", reject);
    proxy.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise(resolve => proxy.close(() => resolve())));
  const response = await fetch("http://127.0.0.1:" + proxy.address().port + "/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] })
  });
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), {
    error: {
      code: "CORE_GATEWAY_502",
      message: "ULTRON Core returned an upstream 502 gateway response after 1 retries (2 attempts). This can happen while the free backend wakes from idle; please retry shortly."
    }
  });
  assert.equal(calls, 2);
});

test("proxy does not retry structured JSON model-provider errors", async (t) => {
  let calls = 0;
  const expected = { error: { message: "Model provider request failed after configured fallback attempts", type: "provider_request_failed" } };
  const proxy = createUltronCoreProxy({
    gatewayRetryDelaysMs: [0],
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify(expected), {
        status: 502,
        headers: { "Content-Type": "application/json; charset=utf-8" }
      });
    },
    logger: { warn() {} }
  });
  await new Promise((resolve, reject) => {
    proxy.once("error", reject);
    proxy.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise(resolve => proxy.close(() => resolve())));
  const response = await fetch("http://127.0.0.1:" + proxy.address().port + "/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] })
  });
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), expected);
  assert.equal(calls, 1);
});


test("voice output prefers installed male voices and uses language-specific speech segments", () => {
  assert.match(html, /data-drawer-view="voice-quality"/);
  assert.ok(app.includes("function chooseSpeechVoice(language)"));
  assert.ok(app.includes("const maleVoiceName ="));
  assert.ok(app.includes("function splitSpeechSegments(text)"));
  assert.ok(app.includes('utterance.lang = segment.lang'));
  assert.ok(app.includes('utterance.pitch = 0.80'));
  assert.ok(app.includes('utterance.rate = 1.08'));
  assert.ok(app.includes('function speechVoiceLabel(language)'));
  assert.ok(app.includes('let speechLanguageMode = "auto"'));
  assert.ok(app.includes('instance.lang = speechLanguageMode === "hi-IN" ? "hi-IN" : "en-IN"'));
});

test("voice quality panel reports Fish Audio readiness and can preview Hindi and English", () => {
  assert.ok(app.includes('if (name === "voice-quality")'));
  assert.ok(app.includes('drawerButton("PREVIEW HINDI + ENGLISH VOICE"'));
  assert.ok(app.includes("speechCapabilities.premiumTtsConfigured"));
  assert.ok(app.includes("speechCapabilities.premiumSttConfigured"));
  assert.doesNotMatch(app, /db9ad6eb7fb84294b2046cf05ef64718/); // voice IDs are kept server-side
  assert.ok(app.includes("Kamal · deep Indian male · Hindi-English"));
  assert.ok(app.includes('drawerButton("AUTO · HINDI + ENGLISH"'));
  assert.ok(app.includes('drawerButton("HINDI · hi-IN"'));
  assert.ok(app.includes('drawerButton("ENGLISH · en-IN"'));
  assert.ok(app.includes("For Hindi-English replies, write Hindi words in Devanagari and English words in Latin script"));
  assert.ok(app.includes("मैं हिंदी और English दोनों में जवाब दूँगा"));
});

test("gateway recovery keeps trying through a longer cold start and returns when the backend wakes", async (t) => {
  let calls = 0;
  const proxy = createUltronCoreProxy({
    gatewayRetryDelaysMs: [0, 0, 0, 0],
    fetchImpl: async () => {
      calls += 1;
      if (calls < 5) {
        return new Response("<html>503 Service Unavailable</html>", {
          status: 503,
          headers: { "Content-Type": "text/html" }
        });
      }
      return new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    },
    logger: { warn() {} }
  });
  await new Promise((resolve, reject) => {
    proxy.once("error", reject);
    proxy.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise(resolve => proxy.close(() => resolve())));
  const response = await fetch("http://127.0.0.1:" + proxy.address().port + "/api/health");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
  assert.equal(calls, 5);
});


test("voice listening starts without waiting for backend readiness and submits short pauses quickly", () => {
  assert.ok(app.includes("void ensureSpeechCapabilities();"));
  assert.ok(app.includes("if (Recognition && !forceFallbackRecognition)"));
  assert.ok(app.includes("now - session.lastVoiceAt >= 300"));
  assert.ok(app.includes("}, 75);"));
  assert.ok(app.includes("nativeSilenceTimer = window.setTimeout"));
  assert.ok(app.includes("}, 300);"));
  assert.ok(app.includes("pendingInterimCommand && voiceActive"));
  assert.ok(app.includes("async function streamChatRequest(body, onDelta)"));
  assert.ok(app.includes("speechCapabilities.premiumSttConfigured"));
  assert.ok(app.includes('body: {\n          audioBase64,\n          mimeType,\n          ...(speechLanguageMode === "hi-IN" ? { language: "hi" } : speechLanguageMode === "en-IN" ? { language: "en" } : {})'));
  assert.ok(app.includes("body: JSON.stringify({ ...body, stream: true })"));
  assert.ok(app.includes("async function speakStreamingSegment(text, epoch, preferFishAudio)"));
  assert.ok(app.includes("Never cut Fish Audio or browser speech at an arbitrary word count"));
  assert.ok(app.includes("if (force) {\n          enqueueStreamSpeech(streamSpeechBuffer.trim());"));
  assert.doesNotMatch(app, /streamSpeechBuffer\.length >= (?:72|22)/);
  assert.ok(app.includes("const fishAudioBlobPromise = streamSpeechUsesFish"));
  assert.ok(app.includes("ALWAYS reply in clear, natural English, regardless of the input language"));
  assert.ok(app.includes("one short, complete English sentence"));
  assert.ok(app.includes("No greeting, filler, markdown, bullets, stage directions, or pronunciation spellings"));
});

test("spoken prompts skip unnecessary pre-search and use a smaller conversational context", () => {
  assert.ok(app.includes('source !== "voice" || explicitResearchIntent'));
  assert.ok(app.includes('history.slice(streamVoiceReply ? -8 : -18)'));
});
