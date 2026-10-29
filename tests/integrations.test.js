import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createIntegrationRouter } from "../integrations/router.js";

async function withServer(env, fetchImpl, run, { userId = "00000000-0000-4000-8000-000000000001" } = {}) {
  const app = express();
  app.use(express.json({ limit: "12mb" }));
  const configuredEnv = { ...env };
  if (!Object.hasOwn(configuredEnv, "ULTRON_INTEGRATION_OWNER_USER_ID")) {
    configuredEnv.ULTRON_INTEGRATION_OWNER_USER_ID = "00000000-0000-4000-8000-000000000001";
  }
  const requireSupabaseUser = (req, _res, next) => { req.supabaseUser = { id: userId }; next(); };
  app.use("/api", createIntegrationRouter({ env: configuredEnv, fetchImpl, requireSupabaseUser }));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try { await run("http://127.0.0.1:" + server.address().port); }
  finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

test("shared ComfyUI credentials fail closed when the integration owner is not configured", async () => {
  let called = false;
  await withServer({
    ULTRON_INTEGRATION_OWNER_USER_ID: "",
    COMFYUI_BASE_URL: "https://comfy.example.com",
    COMFYUI_API_KEY: "synthetic-comfy-key"
  }, async () => {
    called = true;
    throw new Error("Unconfigured owner must never reach the upstream provider.");
  }, async base => {
    const response = await fetch(base + "/api/integrations/comfyui/queue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workflow: { "1": { class_type: "CheckpointLoaderSimple", inputs: {} } } })
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "INTEGRATION_OWNER_NOT_CONFIGURED");
    assert.equal(called, false);
  });
});

test("non-owner accounts cannot consume or inspect shared integration credentials", async () => {
  let calls = 0;
  const env = {
    ULTRON_INTEGRATION_OWNER_USER_ID: "00000000-0000-4000-8000-000000000002",
    COMFYUI_BASE_URL: "https://comfy.example.com",
    COMFYUI_API_KEY: "synthetic-comfy-key",
    OMNIVOICE_API_BASE_URL: "https://voice.example.com",
    OMNIVOICE_API_KEY: "synthetic-voice-key",
    OMNIVOICE_SYNTHESIS_PATH: "/v1/synthesize",
    ULTRON_HANDY_BRIDGE_URL: "https://handy.example.com",
    ULTRON_HANDY_BRIDGE_TOKEN: "synthetic-handy-token",
    ULTRON_HANDY_TRANSCRIBE_PATH: "/transcribe"
  };
  const fetchImpl = async () => {
    calls++;
    throw new Error("A non-owner must not invoke configured shared services.");
  };
  await withServer(env, fetchImpl, async base => {
    const comfy = await fetch(base + "/api/integrations/comfyui/status");
    assert.equal(comfy.status, 403);
    assert.equal((await comfy.json()).error.code, "INTEGRATION_OWNER_ONLY");

    const voice = await fetch(base + "/api/integrations/omnivoice/synthesize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload: { text: "hello" } })
    });
    assert.equal(voice.status, 403);
    assert.equal((await voice.json()).error.code, "INTEGRATION_OWNER_ONLY");

    const handy = await fetch(base + "/api/integrations/handy/transcribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload: { audioBase64: "YXVkaW8=" } })
    });
    assert.equal(handy.status, 403);
    assert.equal((await handy.json()).error.code, "INTEGRATION_OWNER_ONLY");
    assert.equal(calls, 0);
  });
});


test("ComfyUI queue forwards workflow to the configured API and returns prompt id", async () => {
  let request;
  await withServer({ COMFYUI_BASE_URL: "https://comfy.example.com", COMFYUI_API_KEY: "test-token" }, async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ prompt_id: "prompt_123", node_errors: {} }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/integrations/comfyui/queue", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workflow: { "1": { class_type: "CheckpointLoaderSimple", inputs: {} } } })
    });
    assert.equal(response.status, 202);
    assert.equal((await response.json()).promptId, "prompt_123");
    assert.equal(request.url, "https://comfy.example.com/prompt");
    assert.equal(request.options.headers.Authorization, "Bearer test-token");
    assert.equal(request.options.redirect, "error");
    assert.equal(JSON.parse(request.options.body).prompt["1"].class_type, "CheckpointLoaderSimple");
  });
});

test("ComfyUI queue rejects malformed workflow before network call", async () => {
  let called = false;
  await withServer({ COMFYUI_BASE_URL: "https://comfy.example.com" }, async () => {
    called = true;
    throw new Error("unexpected network call");
  }, async base => {
    const response = await fetch(base + "/api/integrations/comfyui/queue", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workflow: [] })
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "INVALID_COMFYUI_WORKFLOW");
    assert.equal(called, false);
  });
});

test("OmniVoice requires an explicit configured API path and text", async () => {
  let called = false;
  await withServer({ OMNIVOICE_API_BASE_URL: "https://voice.example.com", OMNIVOICE_API_KEY: "token" }, async () => {
    called = true;
    return new Response("{}", { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/integrations/omnivoice/synthesize", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payload: { text: "hello" } })
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "OMNIVOICE_NOT_CONFIGURED");
    assert.equal(called, false);
  });
});

test("OmniVoice sends payload to the configured provider path", async () => {
  let request;
  await withServer({
    OMNIVOICE_API_BASE_URL: "https://voice.example.com",
    OMNIVOICE_API_KEY: "token",
    OMNIVOICE_SYNTHESIS_PATH: "/v1/synthesize"
  }, async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ audioBase64: "YXVkaW8=" }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/integrations/omnivoice/synthesize", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payload: { text: "hello", language: "en" } })
    });
    assert.equal(response.status, 200);
    assert.equal(request.url, "https://voice.example.com/v1/synthesize");
    assert.equal(request.options.headers.Authorization, "Bearer token");
    assert.equal(request.options.redirect, "error");
    assert.equal((await response.json()).result.audioBase64, "YXVkaW8=");
  });
});

test("Handy rejects malformed or non-canonical base64 audio without calling the local bridge", async () => {
  for (const audioBase64 of ["not audio!", "Y===", "!!!!", "YQ"]) {
    let called = false;
    await withServer({
      ULTRON_HANDY_BRIDGE_URL: "https://handy.example.com",
      ULTRON_HANDY_BRIDGE_TOKEN: "token",
      ULTRON_HANDY_TRANSCRIBE_PATH: "/transcribe"
    }, async () => {
      called = true;
      return new Response("{}", { status: 200 });
    }, async base => {
      const response = await fetch(base + "/api/integrations/handy/transcribe", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payload: { audioBase64 } })
      });
      assert.equal(response.status, 400, audioBase64);
      assert.equal((await response.json()).error.code, "HANDY_AUDIO_REQUIRED");
      assert.equal(called, false);
    });
  }
});

test("Handy forwards valid canonical base64 audio to the configured bridge", async () => {
  let request;
  await withServer({
    ULTRON_HANDY_BRIDGE_URL: "https://handy.example.com",
    ULTRON_HANDY_BRIDGE_TOKEN: "token",
    ULTRON_HANDY_TRANSCRIBE_PATH: "/transcribe"
  }, async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ text: "hello" }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/integrations/handy/transcribe", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload: { audioBase64: "UklGRg==", language: "en" } })
    });
    assert.equal(response.status, 200);
    assert.equal(request.url, "https://handy.example.com/transcribe");
    assert.equal(request.options.headers.Authorization, "Bearer token");
    assert.equal(request.options.redirect, "error");
    assert.equal(JSON.parse(request.options.body).audioBase64, "UklGRg==");
    assert.equal((await response.json()).result.text, "hello");
  });
});

test("ComfyUI status reports device and queue counts", async () => {
  const urls = [];
  await withServer({ COMFYUI_BASE_URL: "https://comfy.example.com" }, async url => {
    urls.push(url);
    if (url.endsWith("/system_stats")) return new Response(JSON.stringify({ devices: [{ name: "GPU 0", type: "cuda", vram_total: 8000, vram_free: 4000 }] }), { status: 200 });
    if (url.endsWith("/queue")) return new Response(JSON.stringify({ queue_running: [[1, "running_1"]], queue_pending: [[2, "pending_1"], [3, "pending_2"]] }), { status: 200 });
    throw new Error("Unexpected URL " + url);
  }, async base => {
    const response = await fetch(base + "/api/integrations/comfyui/status");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.reachable, true);
    assert.equal(body.system.devices[0].name, "GPU 0");
    assert.deepEqual(body.queue, { running: 1, pending: 2 });
  });
  assert.deepEqual(urls.sort(), ["https://comfy.example.com/queue", "https://comfy.example.com/system_stats"].sort());
});

test("ComfyUI queue inspection summarizes jobs without returning workflow payloads", async () => {
  let requestedUrl;
  await withServer({ COMFYUI_BASE_URL: "https://comfy.example.com" }, async url => {
    requestedUrl = url;
    return new Response(JSON.stringify({
      queue_running: [[1, "active_123", { secret: "large workflow" }, { extra_pnginfo: { workflow: { name: "Test workflow" } } }]],
      queue_pending: [[2, "waiting_456", { prompt: "omitted" }, {}]]
    }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/integrations/comfyui/queue");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.running[0].promptId, "active_123");
    assert.equal(body.running[0].workflowName, "Test workflow");
    assert.equal(body.pending[0].promptId, "waiting_456");
    assert.equal(JSON.stringify(body).includes("large workflow"), false);
    assert.equal(requestedUrl, "https://comfy.example.com/queue");
  });
});

test("ComfyUI queued-job cancellation sends only the requested prompt id", async () => {
  let request;
  await withServer({ COMFYUI_BASE_URL: "https://comfy.example.com", COMFYUI_API_KEY: "token" }, async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/integrations/comfyui/jobs/queued_123", { method: "DELETE" });
    assert.equal(response.status, 200);
    assert.equal(request.url, "https://comfy.example.com/queue");
    assert.equal(request.options.method, "POST");
    assert.deepEqual(JSON.parse(request.options.body), { delete: ["queued_123"] });
    assert.equal(request.options.headers.Authorization, "Bearer token");
  });
});

test("ComfyUI cancellation rejects unsafe prompt ids", async () => {
  let called = false;
  await withServer({ COMFYUI_BASE_URL: "https://comfy.example.com" }, async () => {
    called = true;
    return new Response("{}", { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/integrations/comfyui/jobs/%2Fetc%2Fpasswd", { method: "DELETE" });
    assert.equal(response.status, 400);
    assert.equal(called, false);
  });
});


test("integration catalog reports readiness without exposing credentials or claiming connectivity", async () => {
  await withServer({
    REA_MCP_ENABLED: "true",
    REA_MCP_URL: "https://rea.example.com/mcp",
    REA_MCP_TOKEN: "rea-test-secret",
    REA_ANALYSIS_ROOT: "/srv/rea/targets",
    ULTRON_EMPLOYEES_ENABLED: "true",
    COMFYUI_BASE_URL: "https://comfy.example.com",
    COMFYUI_API_KEY: "secret-comfy-test",
    OMNIVOICE_API_BASE_URL: "https://voice.example.com",
    OMNIVOICE_API_KEY: "secret-voice-test",
    OMNIVOICE_SYNTHESIS_PATH: "/synthesize"
  }, async () => { throw new Error("catalog must not call upstream services"); }, async base => {
    const response = await fetch(base + "/api/integrations/catalog");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json();
    assert.equal(body.verification, "configuration_only");
    const comfy = body.integrations.find(item => item.id === "comfyui");
    const voice = body.integrations.find(item => item.id === "omnivoice");
    const employees = body.integrations.find(item => item.id === "ai-employees");
    const rea = body.integrations.find(item => item.id === "rea-reverse-engineering");
    assert.equal(rea.state, "configured_unverified");
    assert.equal(rea.configured, true);
    assert.equal(comfy.state, "configured_unverified");
    assert.equal(voice.configured, true);
    assert.equal(employees.state, "enabled_guarded_templates");
    assert.equal(JSON.stringify(body).includes("rea-test-secret"), false);
    assert.equal(JSON.stringify(body).includes("/srv/rea/targets"), false);
    assert.equal(JSON.stringify(body).includes("secret-comfy-test"), false);
    assert.equal(JSON.stringify(body).includes("secret-voice-test"), false);
  });
});

test("productivity connector readiness requires owner guard and omits credentials", async () => {
  await withServer({
    ULTRON_INTEGRATION_OWNER_USER_ID: "00000000-0000-4000-8000-000000000001",
    CHATWOOT_BASE_URL: "https://chat.example.com",
    CHATWOOT_API_TOKEN: "chat-secret",
    CHATWOOT_ACCOUNT_ID: "12",
    OPENPROJECT_BASE_URL: "https://projects.example.com",
    OPENPROJECT_API_TOKEN: "openproject-secret",
    CALDIY_BASE_URL: "https://cal.example.com",
    CALDIY_API_TOKEN: "cal-secret"
  }, async () => { throw new Error("catalog must not call upstream services"); }, async base => {
    const response = await fetch(base + "/api/integrations/catalog");
    assert.equal(response.status, 200);
    const body = await response.json();
    const chatwoot = body.integrations.find(item => item.id === "chatwoot");
    const openproject = body.integrations.find(item => item.id === "openproject");
    const caldiy = body.integrations.find(item => item.id === "caldiy");
    assert.equal(chatwoot.state, "configured_unverified");
    assert.equal(openproject.state, "configured_unverified");
    assert.equal(caldiy.state, "configured_unverified");
    assert.equal(JSON.stringify(body).includes("chat-secret"), false);
    assert.equal(JSON.stringify(body).includes("openproject-secret"), false);
    assert.equal(JSON.stringify(body).includes("cal-secret"), false);
  });
});

test("integration catalog does not mark unsupported local URL schemes as configured", async () => {
  await withServer({
    COMFYUI_BASE_URL: "ftp://localhost:8188",
    HEYGEM_API_BASE_URL: "https://user:password@avatar.example.com",
    HEYGEM_API_KEY: "test-key",
    HEYGEM_JOB_PATH: "/jobs"
  }, async () => {
    throw new Error("catalog readiness must not make provider requests");
  }, async base => {
    const response = await fetch(base + "/api/integrations/catalog");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.integrations.find(item => item.id === "comfyui").state, "blocked");
    assert.equal(body.integrations.find(item => item.id === "heygem").state, "blocked");
  });
});

test("integration catalog accepts HTTPS and HTTP loopback development endpoints", async () => {
  await withServer({
    COMFYUI_BASE_URL: "http://127.0.0.1:8188",
    VOICESTUDIO_BASE_URL: "https://voice.example.com",
    VOICESTUDIO_API_KEY: "test-key"
  }, async () => {
    throw new Error("catalog readiness must not make provider requests");
  }, async base => {
    const response = await fetch(base + "/api/integrations/catalog");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.integrations.find(item => item.id === "comfyui").state, "configured_unverified");
    assert.equal(body.integrations.find(item => item.id === "voicestudio").state, "configured_unverified");
  });
});


test("integration adapter stops reading provider responses after the 2 MB limit", async () => {
  let responseBodyCancelled = false;
  await withServer({
    OMNIVOICE_API_BASE_URL: "https://voice.example.com",
    OMNIVOICE_API_KEY: "token",
    OMNIVOICE_SYNTHESIS_PATH: "/synthesize"
  }, async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("x".repeat(2 * 1024 * 1024)));
        controller.enqueue(new TextEncoder().encode("y"));
      },
      cancel() { responseBodyCancelled = true; }
    });
    return new Response(body, { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/integrations/omnivoice/synthesize", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload: { text: "hello" } })
    });
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error.code, "PROVIDER_RESPONSE_TOO_LARGE");
  });
});

test("ComfyUI adapter rejects a base URL containing query parameters before network access", async () => {
  const secret = "query-secret-must-not-be-forwarded";
  let called = false;
  await withServer({ COMFYUI_BASE_URL: "https://comfy.example.com?token=" + secret }, async () => {
    called = true;
    throw new Error("invalid base URL must not reach the ComfyUI provider");
  }, async base => {
    const response = await fetch(base + "/api/integrations/comfyui/status");
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error.code, "COMFYUI_NOT_CONFIGURED");
    assert.equal(JSON.stringify(body).includes(secret), false);
    assert.equal(called, false);
  });
});


test("integration catalog and live adapters block private service URLs before any upstream request", async () => {
  let called = false;
  const env = {
    COMFYUI_BASE_URL: "https://192.168.1.10",
    COMFYUI_API_KEY: "synthetic-token",
    HEYGEM_API_BASE_URL: "https://169.254.169.254/metadata",
    HEYGEM_API_KEY: "synthetic-heygem-token",
    HEYGEM_JOB_PATH: "/jobs"
  };
  const fetchImpl = async () => {
    called = true;
    throw new Error("Private provider endpoint must never be called.");
  };
  await withServer(env, fetchImpl, async base => {
    const catalogResponse = await fetch(base + "/api/integrations/catalog");
    assert.equal(catalogResponse.status, 200);
    const catalog = await catalogResponse.json();
    assert.equal(catalog.integrations.find(item => item.id === "comfyui").state, "blocked");
    assert.equal(catalog.integrations.find(item => item.id === "heygem").state, "blocked");

    const comfy = await fetch(base + "/api/integrations/comfyui/status");
    assert.equal(comfy.status, 503);
    assert.equal((await comfy.json()).error.code, "COMFYUI_NOT_CONFIGURED");

    const heygem = await fetch(base + "/api/integrations/heygem/jobs", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload: { text: "test" } })
    });
    assert.equal(heygem.status, 503);
    assert.equal((await heygem.json()).error.code, "HEYGEM_NOT_CONFIGURED");
    assert.equal(called, false);
  });
});
