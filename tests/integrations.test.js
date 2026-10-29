import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createIntegrationRouter } from "../integrations/router.js";
import { OPEN_HIGGSFIELD_PAID_CONFIRMATION } from "../integrations/open-higgsfield.js";
import { OPEN_DESIGN_PAID_CONFIRMATION } from "../integrations/open-design.js";
import { OPEN_GENERATIVE_AI_PAID_CONFIRMATION } from "../integrations/open-generative-ai.js";

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


test("OpenHiggsfield routes expose static 38-model catalog and safe disabled status", async () => {
  await withServer({}, async () => {
    throw new Error("Catalog and readiness must not contact the provider.");
  }, async base => {
    const catalogResponse = await fetch(base + "/api/integrations/open-higgsfield/models");
    assert.equal(catalogResponse.status, 200);
    const catalog = await catalogResponse.json();
    assert.equal(catalog.modelCount, 38);
    assert.equal(catalog.models.length, 38);

    const statusResponse = await fetch(base + "/api/integrations/open-higgsfield/status");
    assert.equal(statusResponse.status, 200);
    const status = await statusResponse.json();
    assert.equal(status.configured, false);
    assert.equal(status.state, "disabled_by_config");
  });
});

test("OpenHiggsfield generation route requires explicit paid-use confirmation before outbound requests", async () => {
  let calls = 0;
  await withServer({
    ULTRON_OPEN_HIGGSFIELD_ENABLED: "true",
    HF_API_BASE_URL: "https://api.higgsfield.ai",
    OPEN_HIGGSFIELD_API_KEY: "test-id:secret-value-123456",
    ULTRON_INTEGRATION_OWNER_USER_ID: "00000000-0000-4000-8000-000000000001"
  }, async () => {
    calls++;
    throw new Error("Unapproved media generation must not reach the provider.");
  }, async base => {
    const response = await fetch(base + "/api/integrations/open-higgsfield/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "soul-cinema", prompt: "a cinematic red planet", userPrompt: "Generate an image" })
    });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).state, "approval_required");
    assert.equal(calls, 0);
  });
});

test("OpenHiggsfield generation route queues only after explicit confirmation and keeps credentials server-side", async () => {
  let request;
  const apiKey = "test-id:secret-value-123456";
  const env = {
    ULTRON_OPEN_HIGGSFIELD_ENABLED: "true",
    HF_API_BASE_URL: "https://api.higgsfield.ai",
    OPEN_HIGGSFIELD_API_KEY: apiKey,
    ULTRON_INTEGRATION_OWNER_USER_ID: "00000000-0000-4000-8000-000000000001"
  };
  await withServer(env, async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ request_id: "req_123", status: "queued" }), { status: 200, headers: { "content-type": "application/json" } });
  }, async base => {
    const response = await fetch(base + "/api/integrations/open-higgsfield/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "soul-cinema",
        prompt: "cinematic red planet at dawn",
        settings: { batchSize: 1, aspectRatio: "1:1" },
        confirmPaidGeneration: true,
        confirmationText: OPEN_HIGGSFIELD_PAID_CONFIRMATION,
        userPrompt: "I explicitly approve paid generation using my provider credits."
      })
    });
    assert.equal(response.status, 202);
    const body = await response.json();
    assert.equal(body.state, "queued");
    assert.equal(body.requestId, "req_123");
    assert.equal(request.url, "https://api.higgsfield.ai/higgsfield-ai/soul/cinema");
    assert.equal(request.options.headers.Authorization, "Key " + apiKey);
    assert.equal(request.options.redirect, "error");
    assert.equal(JSON.stringify(body).includes(apiKey), false);
  });
});


const openDesignEnv = {
  OPEN_DESIGN_ENABLED: "true",
  OPEN_DESIGN_BASE_URL: "https://design.example.com",
  OPEN_DESIGN_API_TOKEN: "od-test-daemon-token",
  OPEN_DESIGN_PROJECT_ID: "personal_project_123",
  OPEN_DESIGN_BYOK_PROTOCOL: "openai",
  OPEN_DESIGN_BYOK_BASE_URL: "https://openrouter.ai/api/v1",
  OPEN_DESIGN_BYOK_API_KEY: "provider-key-synthetic",
  OPEN_DESIGN_BYOK_MODEL: "openrouter/free",
  ULTRON_INTEGRATION_OWNER_USER_ID: "00000000-0000-4000-8000-000000000001"
};

test("OpenDesign integration status remains disabled by default without network access", async () => {
  await withServer({}, async () => {
    throw new Error("OpenDesign status must not contact an upstream service.");
  }, async base => {
    const response = await fetch(base + "/api/integrations/open-design/status");
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.state, "disabled_by_config");
    assert.equal(result.configured, false);
  });
});

test("OpenDesign route lists projects only for the configured owner and keeps token server-side", async () => {
  let request;
  await withServer(openDesignEnv, async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ projects: [{ id: "personal_project_123", name: "Personal Design" }] }), {
      status: 200, headers: { "content-type": "application/json" }
    });
  }, async base => {
    const response = await fetch(base + "/api/integrations/open-design/projects");
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual(result.projects, [{ id: "personal_project_123", name: "Personal Design" }]);
    assert.equal(request.url, "https://design.example.com/api/projects");
    assert.equal(request.options.headers.Authorization, "Bearer " + openDesignEnv.OPEN_DESIGN_API_TOKEN);
    assert.equal(JSON.stringify(result).includes(openDesignEnv.OPEN_DESIGN_API_TOKEN), false);
  });
});

test("OpenDesign run route rejects unapproved requests before forwarding model-provider credentials", async () => {
  let calls = 0;
  await withServer(openDesignEnv, async () => {
    calls++;
    throw new Error("Unapproved task must not reach OpenDesign.");
  }, async base => {
    const response = await fetch(base + "/api/integrations/open-design/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Create a landing page", userPrompt: "Create a landing page" })
    });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).state, "approval_required");
    assert.equal(calls, 0);
  });
});

test("OpenDesign run route submits a confirmed task with server-side BYOK configuration", async () => {
  let request;
  await withServer(openDesignEnv, async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ runId: "run_123", conversationId: "conversation_1", assistantMessageId: "message_1" }), {
      status: 202, headers: { "content-type": "application/json" }
    });
  }, async base => {
    const response = await fetch(base + "/api/integrations/open-design/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "Create a responsive product landing page in index.html.",
        confirmPaidRun: true,
        confirmationText: OPEN_DESIGN_PAID_CONFIRMATION,
        userPrompt: "I approve this task using my configured provider credits in OpenDesign."
      })
    });
    assert.equal(response.status, 202);
    const result = await response.json();
    assert.equal(result.state, "queued");
    assert.equal(result.runId, "run_123");
    assert.equal(request.url, "https://design.example.com/api/runs");
    assert.equal(request.options.headers.Authorization, "Bearer " + openDesignEnv.OPEN_DESIGN_API_TOKEN);
    const body = JSON.parse(request.options.body);
    assert.equal(body.projectId, openDesignEnv.OPEN_DESIGN_PROJECT_ID);
    assert.equal(body.agentId, "byok-opencode");
    assert.equal(body.byokProvider.apiKey, openDesignEnv.OPEN_DESIGN_BYOK_API_KEY);
    assert.equal(JSON.stringify(result).includes(openDesignEnv.OPEN_DESIGN_API_TOKEN), false);
    assert.equal(JSON.stringify(result).includes(openDesignEnv.OPEN_DESIGN_BYOK_API_KEY), false);
  });
});

test("OpenDesign run status routes only return validated status and deliverable metadata", async () => {
  let requestUrl;
  await withServer(openDesignEnv, async url => {
    requestUrl = url;
    return new Response(JSON.stringify({
      status: "succeeded",
      deliverableValid: true,
      deliverableEntryFile: "index.html",
      apiKey: "must-not-return"
    }), { status: 200, headers: { "content-type": "application/json" } });
  }, async base => {
    const response = await fetch(base + "/api/integrations/open-design/runs/run_123");
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(requestUrl, "https://design.example.com/api/runs/run_123");
    assert.equal(result.status, "succeeded");
    assert.equal(result.verified, true);
    assert.equal(result.deliverableEntryFile, "index.html");
    assert.equal(JSON.stringify(result).includes("must-not-return"), false);
  });
});


test("Open Generative AI readiness and model catalog require no external API call", async () => {
  await withServer({}, async () => {
    throw new Error("MuAPI readiness and static catalog must not contact the provider.");
  }, async base => {
    const statusResponse = await fetch(base + "/api/integrations/open-generative-ai/status");
    assert.equal(statusResponse.status, 200);
    const status = await statusResponse.json();
    assert.equal(status.configured, false);
    assert.equal(status.state, "disabled_by_config");

    const modelsResponse = await fetch(base + "/api/integrations/open-generative-ai/models");
    assert.equal(modelsResponse.status, 200);
    const models = await modelsResponse.json();
    assert.equal(models.modelCount, 38);
    assert.equal(models.models.length, 38);
  });
});

test("Open Generative AI generation route blocks unapproved paid requests before network", async () => {
  let calls = 0;
  await withServer({
    ULTRON_OPEN_GENERATIVE_AI_ENABLED: "true",
    MUAPI_API_KEY: "muapi-route-secret-123456",
    ULTRON_INTEGRATION_OWNER_USER_ID: "00000000-0000-4000-8000-000000000001"
  }, async () => {
    calls++;
    throw new Error("Unapproved generation must not reach MuAPI.");
  }, async base => {
    const response = await fetch(base + "/api/integrations/open-generative-ai/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "nano-banana-pro",
        prompt: "A cinematic red planet",
        userPrompt: "Make an image."
      })
    });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).state, "approval_required");
    assert.equal(calls, 0);
  });
});

test("Open Generative AI generation route submits confirmed jobs with server-side API key only", async () => {
  let request;
  const apiKey = "muapi-route-secret-123456";
  await withServer({
    ULTRON_OPEN_GENERATIVE_AI_ENABLED: "true",
    MUAPI_API_KEY: apiKey,
    ULTRON_INTEGRATION_OWNER_USER_ID: "00000000-0000-4000-8000-000000000001"
  }, async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ request_id: "req_media_123", status: "queued" }), {
      status: 202, headers: { "content-type": "application/json" }
    });
  }, async base => {
    const response = await fetch(base + "/api/integrations/open-generative-ai/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "nano-banana-pro",
        prompt: "A cinematic red planet at sunrise",
        settings: { aspectRatio: "16:9", resolution: "2k" },
        confirmPaidGeneration: true,
        confirmationText: OPEN_GENERATIVE_AI_PAID_CONFIRMATION,
        userPrompt: "I explicitly approve this paid image generation using my MuAPI provider credits."
      })
    });
    assert.equal(response.status, 202);
    const result = await response.json();
    assert.equal(result.state, "queued");
    assert.equal(result.requestId, "req_media_123");
    assert.equal(request.url, "https://api.muapi.ai/api/v1/nano-banana-pro");
    assert.equal(request.options.headers["x-api-key"], apiKey);
    assert.equal(JSON.stringify(result).includes(apiKey), false);
  });
});

test("Open Generative AI status route polls only a validated job ID and sanitizes output URLs", async () => {
  let requestUrl;
  await withServer({
    ULTRON_OPEN_GENERATIVE_AI_ENABLED: "true",
    MUAPI_API_KEY: "muapi-route-secret-123456",
    ULTRON_INTEGRATION_OWNER_USER_ID: "00000000-0000-4000-8000-000000000001"
  }, async url => {
    requestUrl = url;
    return new Response(JSON.stringify({
      status: "completed",
      outputs: ["https://cdn.muapi.ai/video.mp4", "http://127.0.0.1/private.mp4"]
    }), { status: 200, headers: { "content-type": "application/json" } });
  }, async base => {
    const response = await fetch(base + "/api/integrations/open-generative-ai/jobs/req_media_123");
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(requestUrl, "https://api.muapi.ai/api/v1/predictions/req_media_123/result");
    assert.equal(result.status, "completed");
    assert.deepEqual(result.outputs, ["https://cdn.muapi.ai/video.mp4"]);
    assert.equal(JSON.stringify(result).includes("127.0.0.1"), false);
  });
});
