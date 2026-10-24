import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createFeatureRouter } from "../features.js";

async function withServer(env, run, extras = {}) {
  const app = express();
  app.use(express.json());
  const requireSession = (_req, _res, next) => next();
  const requireSupabaseUser = (req, _res, next) => { req.supabaseUser = { id: "00000000-0000-4000-8000-000000000001" }; next(); };
  const supabaseRest = extras.supabaseRest || (async () => []);
  app.use("/api", createFeatureRouter({
    env, requireSession, requireSupabaseUser, supabaseRest,
    fetchImpl: extras.fetchImpl || globalThis.fetch,
    logger: { warn() {} }
  }));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try {
    const address = server.address();
    await run("http://127.0.0.1:" + address.port);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test("capabilities endpoint reports provider readiness without exposing secrets", async () => {
  await withServer({ OPENROUTER_API_KEY: "do-not-return-this", OPENROUTER_DEFAULT_MODEL: "openrouter/free" }, async base => {
    const response = await fetch(base + "/api/capabilities");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.providers.cloud.configured, true);
    assert.equal(body.providers.local.configured, false);
    assert.equal(JSON.stringify(body).includes("do-not-return-this"), false);
  });
});

test("local model endpoint fails closed when no endpoint is configured", async () => {
  await withServer({}, async base => {
    const response = await fetch(base + "/api/local/models");
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "LOCAL_MODEL_NOT_CONFIGURED");
  });
});

test("research endpoint rejects an empty query before making network calls", async () => {
  let called = false;
  await withServer({}, async base => {
    const response = await fetch(base + "/api/research", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: " " })
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "INVALID_RESEARCH_QUERY");
    assert.equal(called, false);
  }, { fetchImpl: async () => { called = true; throw new Error("must not be called"); } });
});

test("task creation records a queued plan and audit event, without claiming execution", async () => {
  const writes = [];
  const fakeSupabaseRest = async (_req, table, method, _query, body) => {
    writes.push({ table, method, body });
    if (table === "agent_tasks") return [{ id: "00000000-0000-4000-8000-000000000002", title: body.title, input: body.input, status: body.status, created_at: new Date().toISOString() }];
    return [];
  };
  await withServer({}, async base => {
    const response = await fetch(base + "/api/tasks", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Summarize research", description: "Gather sources and draft a summary", risk: "medium" })
    });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.task.status, "WAITING_FOR_PERMISSION");
    assert.match(body.notice, /will not execute unless its type is supported/i);
    assert.equal(writes.some(w => w.table === "audit_events"), true);
  }, { supabaseRest: fakeSupabaseRest });
});

test("document extraction parses JSON and marks extracted text as untrusted", async () => {
  await withServer({}, async base => {
    const response = await fetch(base + "/api/documents/extract", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: "notes.json", format: "json", content: "{\"goal\":\"test\"}" })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.match(body.extractedText, /"goal": "test"/);
    assert.match(body.notice, /untrusted input/i);
  });
});

test("document extraction rejects malformed PDF payloads", async () => {
  await withServer({}, async base => {
    const response = await fetch(base + "/api/documents/extract", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: "report.pdf", format: "pdf", fileBase64: Buffer.from("not a pdf").toString("base64") })
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "INVALID_PDF");
  });
});

test("preferences reject unsupported values and save supported voice/memory choices", async () => {
  const writes = [];
  const fakeSupabaseRest = async (_req, table, method, query, body) => {
    writes.push({ table, method, query, body });
    if (method === "POST" && table === "user_preferences") return [{ ...body, language: body.language || "en", voice_enabled: body.voice_enabled ?? true, voice_input_locale: body.voice_input_locale || "en-IN", memory_enabled: body.memory_enabled ?? true, preferences: body.preferences || {} }];
    return [];
  };
  await withServer({}, async base => {
    const invalid = await fetch(base + "/api/preferences", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ language: "klingon" })
    });
    assert.equal(invalid.status, 400);
    const saved = await fetch(base + "/api/preferences", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: "hinglish", voice_enabled: false, memory_enabled: false, preferences: { personality: "concise", ignoredKey: "ignored" } })
    });
    assert.equal(saved.status, 200);
    const body = await saved.json();
    assert.equal(body.preferences.voice_enabled, false);
    assert.equal(body.preferences.memory_enabled, false);
    assert.equal(body.preferences.preferences.ignoredKey, undefined);
    assert.equal(writes.length, 1);
  }, { supabaseRest: fakeSupabaseRest });
});

test("task approval requires explicit confirmation and preserves original task input", async () => {
  const writes = [];
  const originalInput = { description: "Research a topic", risk: "medium", requiresApproval: true, approved: false };
  const fakeSupabaseRest = async (_req, table, method, query, body) => {
    writes.push({ table, method, query, body });
    if (table === "agent_tasks" && method === "GET") return [{ id: "00000000-0000-4000-8000-000000000002", title: "Research", input: originalInput, status: "WAITING_FOR_PERMISSION" }];
    if (table === "agent_tasks" && method === "PATCH") return [{ id: "00000000-0000-4000-8000-000000000002", title: "Research", input: body.input, status: body.status }];
    return [];
  };
  await withServer({}, async base => {
    const noConfirm = await fetch(base + "/api/tasks/00000000-0000-4000-8000-000000000002/approve", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({})
    });
    assert.equal(noConfirm.status, 400);
    const approved = await fetch(base + "/api/tasks/00000000-0000-4000-8000-000000000002/approve", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: true })
    });
    assert.equal(approved.status, 200);
    const body = await approved.json();
    assert.equal(body.task.input.description, "Research a topic");
    assert.equal(body.task.input.approved, true);
    assert.match(body.notice, /worker is still required/i);
  }, { supabaseRest: fakeSupabaseRest });
});


test("speech synthesis rejects oversized streamed provider responses without buffering them fully", async () => {
  let cancelled = false;
  await withServer({ TTS_API_BASE_URL: "https://speech.example", TTS_API_KEY: "test-key" }, async base => {
    const response = await fetch(base + "/api/speech/synthesize", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "hello" })
    });
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error.code, "TTS_INVALID_AUDIO");
    assert.equal(cancelled, true);
  }, {
    fetchImpl: async (_url, options) => {
      assert.equal(options.redirect, "error");
      return new Response(new ReadableStream({
        start(controller) { controller.enqueue(new Uint8Array(12_000_001)); },
        cancel() { cancelled = true; }
      }), { status: 200, headers: { "content-type": "audio/mpeg" } });
    }
  });
});

test("speech transcription rejects oversized streamed provider responses", async () => {
  let called = false;
  await withServer({ STT_API_BASE_URL: "https://speech.example", STT_API_KEY: "test-key" }, async base => {
    const response = await fetch(base + "/api/speech/transcribe", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audioBase64: Buffer.from("audio").toString("base64"), mimeType: "audio/wav" })
    });
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error.code, "STT_RESPONSE_TOO_LARGE");
    assert.equal(called, true);
  }, {
    fetchImpl: async (_url, options) => {
      assert.equal(options.redirect, "error");
      called = true;
      return new Response(new ReadableStream({
        start(controller) { controller.enqueue(new Uint8Array(1_000_001)); }
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
});

test("premium speech endpoints fail clearly when no provider is configured", async () => {
  await withServer({}, async base => {
    const response = await fetch(base + "/api/speech/synthesize", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "Hello" })
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "TTS_NOT_CONFIGURED");
  });
});

test("document extraction rejects malformed DOCX payloads", async () => {
  await withServer({}, async base => {
    const response = await fetch(base + "/api/documents/extract", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: "report.docx", format: "docx", fileBase64: Buffer.from("not a docx").toString("base64") })
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "INVALID_DOCX");
  });
});

test("coding assistance is disabled without a provider key", async () => {
  await withServer({}, async base => {
    const response = await fetch(base + "/api/coding/assist", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: "Write a safe parser", mode: "generate" })
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "CODING_PROVIDER_NOT_CONFIGURED");
  });
});

test("coding assistance uses configured provider and never claims code execution", async () => {
  let requestBody;
  await withServer({ OPENROUTER_API_KEY: "test-secret", OPENROUTER_DEFAULT_MODEL: "openrouter/free" }, async base => {
    const response = await fetch(base + "/api/coding/assist", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: "Review this code", code: "console.log('hello')", language: "javascript", mode: "review" })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.execution, "not_executed");
    assert.match(body.notice, /did not execute/i);
    assert.equal(body.answer, "Use strict validation.");
    assert.equal(requestBody.model, "openrouter/free");
    assert.equal(requestBody.messages[1].content.includes("console.log"), true);
    assert.equal(JSON.stringify(body).includes("test-secret"), false);
  }, { fetchImpl: async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ model: "openrouter/free", choices: [{ message: { content: "Use strict validation." } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  } });
});

test("task list and cancellation explicitly scope database operations to the signed-in user", async () => {
  const userId = "00000000-0000-4000-8000-000000000001";
  const calls = [];
  const fakeSupabaseRest = async (_req, table, method, query, body) => {
    calls.push({ table, method, query, body });
    if (table === "agent_tasks" && method === "GET") return [];
    if (table === "agent_tasks" && method === "PATCH") return [{ id: "00000000-0000-4000-8000-000000000002", status: body.status }];
    return [];
  };
  await withServer({}, async base => {
    const listed = await fetch(base + "/api/tasks");
    assert.equal(listed.status, 200);
    const cancelled = await fetch(base + "/api/tasks/00000000-0000-4000-8000-000000000002/cancel", { method: "POST" });
    assert.equal(cancelled.status, 200);
    const readQuery = calls.find(call => call.table === "agent_tasks" && call.method === "GET").query;
    const patchQuery = calls.find(call => call.table === "agent_tasks" && call.method === "PATCH").query;
    assert.ok(readQuery.includes("user_id=eq." + userId));
    assert.ok(patchQuery.includes("user_id=eq." + userId));
  }, { supabaseRest: fakeSupabaseRest });
});

test("task detail is owner-scoped and validates task IDs", async () => {
  const userId = "00000000-0000-4000-8000-000000000001";
  const calls = [];
  const fakeSupabaseRest = async (_req, table, method, query) => {
    calls.push({ table, method, query });
    return [{ id: "00000000-0000-4000-8000-000000000002", title: "Owned task", status: "COMPLETED" }];
  };
  await withServer({}, async base => {
    const invalid = await fetch(base + "/api/tasks/not-a-uuid");
    assert.equal(invalid.status, 400);
    const response = await fetch(base + "/api/tasks/00000000-0000-4000-8000-000000000002");
    assert.equal(response.status, 200);
    assert.equal((await response.json()).task.title, "Owned task");
    assert.ok(calls[0].query.includes("user_id=eq." + userId));
  }, { supabaseRest: fakeSupabaseRest });
});

test("World Intelligence command only opens the workspace for explicit open intents", async () => {
  await withServer({}, async base => {
    const opened = await fetch(base + "/api/world-intelligence/command", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "Open World Intelligence" })
    });
    assert.equal(opened.status, 200);
    const body = await opened.json();
    assert.equal(body.action.type, "open_workspace");
    assert.equal(body.workspaceUrl, "/world-intelligence/");
    assert.equal(body.execution, "open_workspace_only");

    const unsupported = await fetch(base + "/api/world-intelligence/command", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "Track the nearest satellite" })
    });
    assert.equal(unsupported.status, 501);
    assert.equal((await unsupported.json()).error.code, "WORLD_TOOL_BRIDGE_ACTION_REQUIRED");
  });
});

test("World Intelligence command rejects empty input", async () => {
  await withServer({}, async base => {
    const response = await fetch(base + "/api/world-intelligence/command", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ command: " " })
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "WORLD_COMMAND_REQUIRED");
  });
});

test("World Intelligence tool bridge validates layer actions and rejects unsafe targets", async () => {
  await withServer({}, async base => {
    const valid = await fetch(base + "/api/world-intelligence/command", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "show satellites", action: { name: "set_layer_visibility", args: { layerId: "satellites", enabled: true } } })
    });
    assert.equal(valid.status, 200);
    const payload = await valid.json();
    assert.equal(payload.action.type, "invoke_globe_tool");
    assert.equal(payload.action.name, "set_layer_visibility");

    const unsafe = await fetch(base + "/api/world-intelligence/command", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "run shell", action: { name: "exec", args: { command: "whoami" } } })
    });
    assert.equal(unsafe.status, 400);
    assert.equal((await unsafe.json()).error.code, "WORLD_ACTION_NOT_ALLOWED");
  });
});


test("saved AI Employee schedules can be queued immediately without performing external actions", async () => {
  const calls = [];
  const schedule = {
    id: "00000000-0000-4000-8000-000000000010",
    user_id: "00000000-0000-4000-8000-000000000001",
    role_id: "chief-of-staff",
    routine_id: "cos-decision-brief",
    goal: "Prepare the weekly operations report",
    context: "Use available internal notes only.",
    enabled: true
  };
  const fakeSupabaseRest = async (_req, table, method, query, body) => {
    calls.push({ table, method, query, body });
    if (table === "employee_schedules" && method === "GET") return [schedule];
    if (table === "agent_tasks" && method === "POST") {
      return [{ id: "00000000-0000-4000-8000-000000000011", title: body.title, status: body.status, input: body.input, created_at: new Date().toISOString() }];
    }
    return [];
  };
  await withServer({ ULTRON_EMPLOYEES_ENABLED: "true", SUPABASE_SERVICE_ROLE_KEY: "test-only", OPENROUTER_API_KEY: "test-only" }, async base => {
    const response = await fetch(base + "/api/employees/schedules/" + schedule.id + "/run", { method: "POST" });
    assert.equal(response.status, 202);
    const body = await response.json();
    assert.equal(body.task.status, "QUEUED");
    assert.equal(body.task.input.taskType, "autonomous");
    assert.equal(body.task.input.routineId, schedule.routine_id);
    assert.equal(body.task.input.scheduleId, schedule.id);
    assert.match(body.notice, /will not perform external actions/i);
    const scheduleRead = calls.find(call => call.table === "employee_schedules" && call.method === "GET");
    assert.match(scheduleRead.query, /user_id=eq\.00000000-0000-4000-8000-000000000001/);
    assert.equal(calls.some(call => call.table === "audit_events" && call.body.action === "employee.schedule_run_requested"), true);
  }, { supabaseRest: fakeSupabaseRest });
});

test("running a saved schedule fails closed when the worker is not configured", async () => {
  await withServer({}, async base => {
    const response = await fetch(base + "/api/employees/schedules/00000000-0000-4000-8000-000000000010/run", { method: "POST" });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "EMPLOYEE_WORKER_NOT_CONFIGURED");
  });
});

test("employee schedule creation stays successful when server-authored audit insert is denied", async () => {
  const calls = [];
  const saved = {
    id: "00000000-0000-4000-8000-000000000020",
    role_id: "chief-of-staff",
    routine_id: "cos-decision-brief",
    goal: "Prepare an operations report",
    enabled: true,
    next_run_at: new Date(Date.now() + 86400000).toISOString()
  };
  const fakeSupabaseRest = async (_req, table, method, _query, body) => {
    calls.push({ table, method, body });
    if (table === "employee_schedules" && method === "POST") return [saved];
    if (table === "audit_events" && method === "POST") {
      const error = new Error("new row violates row-level security policy");
      error.status = 403;
      error.code = "AUDIT_INSERT_DENIED";
      throw error;
    }
    return [];
  };
  await withServer({}, async base => {
    const response = await fetch(base + "/api/employees/schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        role: "chief-of-staff",
        routineId: "cos-decision-brief",
        goal: "Prepare an operations report",
        intervalMinutes: 1440
      })
    });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.schedule.id, saved.id);
    assert.match(body.notice, /Schedule saved/);
    assert.equal(calls.some(call => call.table === "employee_schedules" && call.method === "POST"), true);
    assert.equal(calls.some(call => call.table === "audit_events" && call.method === "POST"), true);
  }, { supabaseRest: fakeSupabaseRest });
});
