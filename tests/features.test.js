import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { deflateRawSync } from "node:zlib";
import { createFeatureRouter } from "../features.js";

async function withServer(env, run, extras = {}) {
  const app = express();
  app.use(express.json());
  const requireSession = (_req, _res, next) => next();
  const requireSupabaseUser = (req, _res, next) => { req.supabaseUser = { id: "00000000-0000-4000-8000-000000000001" }; next(); };
  const supabaseRest = extras.supabaseRest || (async () => []);
  app.use("/api", createFeatureRouter({
    env, requireSession, requireSupabaseUser, supabaseRest,
    privilegedSupabaseRest: extras.privilegedSupabaseRest || supabaseRest,
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

function makeZipBombDocxEntry({
  name = "word/document.xml",
  expandedSize = 25 * 1024 * 1024,
  method = 0,
  payload = Buffer.from([0x41])
} = {}) {
  const nameBytes = Buffer.from(name, "utf8");
  const compressedPayload = method === 8 ? deflateRawSync(payload) : payload;
  const compressedSize = compressedPayload.length;
  const local = Buffer.alloc(30 + nameBytes.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(compressedSize, 18);
  local.writeUInt32LE(expandedSize, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  nameBytes.copy(local, 30);

  const central = Buffer.alloc(46 + nameBytes.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(compressedSize, 20);
  central.writeUInt32LE(expandedSize, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt32LE(0, 42);
  nameBytes.copy(central, 46);

  const centralOffset = local.length + compressedPayload.length;
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(1, 8);
  endRecord.writeUInt16LE(1, 10);
  endRecord.writeUInt32LE(central.length, 12);
  endRecord.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([local, compressedPayload, central, endRecord]);
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

test("research results exclude unsafe URL schemes, IP literals, credentials, and local-only hostnames", async () => {
  const env = { TAVILY_API_KEY: "test-only" };
  const upstreamResults = [
    { title: "public HTTPS", url: "https://docs.example.com/reference", content: "Useful public documentation." },
    { title: "private IPv4", url: "https://10.1.2.3/admin", content: "Do not expose." },
    { title: "loopback IPv4", url: "http://127.0.0.1:8080/", content: "Do not expose." },
    { title: "public IPv6 literal", url: "https://[2606:4700:4700::1111]/", content: "IP literals are not trusted sources." },
    { title: "URL credentials", url: "https://user:pass@docs.example.com/path", content: "Do not expose." },
    { title: "local suffix", url: "https://printer.local/status", content: "Do not expose." },
    { title: "internal suffix", url: "https://service.internal/secret", content: "Do not expose." },
    { title: "metadata", url: "http://metadata.google.internal/latest/meta-data/", content: "Do not expose." },
    { title: "invalid scheme", url: "javascript:alert(1)", content: "Do not expose." },
    { title: "single-label host", url: "https://intranet/secret", content: "Do not expose." },
    { title: "public HTTP", url: "http://example.org/manual", content: "Public HTTP source." }
  ];
  await withServer(env, async base => {
    const response = await fetch(base + "/api/research", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "public documentation references" })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.results.map(item => item.title), ["public HTTPS", "public HTTP"]);
    assert.ok(body.results.every(item => !item.url.includes("@")));
    assert.equal(JSON.stringify(body).includes("10.1.2.3"), false);
  }, {
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://api.tavily.com/search");
      assert.equal(options.method, "POST");
      assert.equal(options.redirect, "error");
      return new Response(JSON.stringify({ results: upstreamResults }), {
        status: 200, headers: { "Content-Type": "application/json" }
      });
    }
  });
});

test("task progress returns owner-scoped lifecycle and a sanitized checkpoint timeline", async () => {
  const userId = "00000000-0000-4000-8000-000000000001";
  const taskId = "00000000-0000-4000-8000-000000000009";
  const calls = [];
  const fakeSupabaseRest = async (_req, table, method, query) => {
    calls.push({ table, method, query });
    if (table === "agent_tasks") {
      assert.match(query, new RegExp("user_id=eq\\." + userId));
      assert.match(query, new RegExp("id=eq\\." + taskId));
      return [{ id: taskId, status: "RUNNING", started_at: "2026-10-25T08:00:00Z", finished_at: null, created_at: "2026-10-25T07:59:00Z", updated_at: "2026-10-25T08:00:00Z", error_code: null }];
    }
    if (table === "audit_events") {
      assert.match(query, new RegExp("user_id=eq\\." + userId));
      assert.match(query, new RegExp("target_id=eq\\." + taskId));
      return [
        { action: "task.created", outcome: "allowed", metadata: { prompt: "must not leak" }, created_at: "2026-10-25T07:59:00Z" },
        { action: "autonomous.stage", outcome: "completed", metadata: { stage: "research", goal: "private user goal", sourceCount: 4 }, created_at: "2026-10-25T08:00:00Z" },
        { action: "unrelated.secret.event", outcome: "allowed", metadata: { token: "must not leak" }, created_at: "2026-10-25T08:00:01Z" }
      ];
    }
    throw new Error("Unexpected table " + table);
  };
  await withServer({}, async base => {
    const response = await fetch(base + "/api/tasks/" + taskId + "/progress");
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") || "", /no-store/i);
    const body = await response.json();
    assert.equal(body.task.id, taskId);
    assert.equal(body.task.status, "RUNNING");
    assert.equal(body.progress.state, "running");
    assert.equal(body.progress.percent, null, "do not invent percentage estimates for unknown running work");
    assert.equal(body.progress.latestStage, "research");
    assert.equal(body.progress.checkpointCount, 2);
    assert.deepEqual(body.checkpoints.map(item => item.action), ["task.created", "autonomous.stage"]);
    assert.equal(body.checkpoints[1].stage, "research");
    const serialized = JSON.stringify(body);
    assert.equal(serialized.includes("private user goal"), false);
    assert.equal(serialized.includes("must not leak"), false);
    assert.equal(serialized.includes("unrelated.secret.event"), false);
    assert.equal(calls.map(call => call.table).join(","), "agent_tasks,audit_events");
  }, { supabaseRest: fakeSupabaseRest });
});

test("task progress hides a task and skips audit reads when the owner-scoped lookup is empty", async () => {
  const calls = [];
  const fakeSupabaseRest = async (_req, table, method, query) => {
    calls.push({ table, method, query });
    if (table === "agent_tasks") return [];
    throw new Error("Audit events must not be queried when task ownership lookup fails.");
  };
  await withServer({}, async base => {
    const response = await fetch(base + "/api/tasks/00000000-0000-4000-8000-000000000099/progress");
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, "TASK_NOT_FOUND");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].table, "agent_tasks");
    assert.match(calls[0].query, /user_id=eq\.00000000-0000-4000-8000-000000000001/);
  }, { supabaseRest: fakeSupabaseRest });
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

test("low-risk employee draft queues automatically with a bounded worker mode", async () => {
  const writes = [];
  const taskId = "00000000-0000-4000-8000-000000000041";
  const fakeSupabaseRest = async (_req, table, method, _query, body) => {
    writes.push({ table, method, body });
    if (table === "agent_tasks" && method === "POST") {
      return [{ id: taskId, title: body.title, input: body.input, status: body.status, created_at: "2026-10-25T08:00:00Z" }];
    }
    return [];
  };
  await withServer({}, async base => {
    const response = await fetch(base + "/api/tasks", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Draft an SEO outline", description: "Prepare a source-backed outline for review",
        taskType: "employee", role: "seo-aeo", mode: "draft", goal: "Draft an outline for a topic cluster",
        routineId: "seo-draft-run", context: "The audience is beginners.", risk: "low"
      })
    });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.task.status, "QUEUED");
    assert.equal(body.task.input.taskType, "employee");
    assert.equal(body.task.input.executionMode, "employee_worker");
    assert.equal(body.task.input.requiresApproval, false);
    assert.equal(body.task.input.approved, false, "auto-eligible work must not pretend explicit approval occurred");
    assert.equal(body.task.input.risk, "low");
    assert.equal(body.task.input.requestedRisk, "low");
    assert.equal(body.task.input.intentRisk.level, "routine");
    assert.equal(body.task.input.role, "seo-aeo");
    assert.equal(body.task.input.routineId, "seo-draft-run");
    assert.match(body.notice, /low-risk draft\/report queued/i);
    assert.match(body.notice, /remain disabled/i);
    assert.equal(writes.filter(item => item.table === "agent_tasks").length, 1);
    assert.equal(writes.find(item => item.table === "audit_events").body.metadata.executionMode, "employee_worker");
    assert.equal(writes.find(item => item.table === "audit_events").body.outcome, "allowed");
  }, { supabaseRest: fakeSupabaseRest });
});

test("server-inferred external intent overrides a client-supplied low risk label", async () => {
  const writes = [];
  const fakeSupabaseRest = async (_req, table, method, _query, body) => {
    writes.push({ table, method, body });
    if (table === "agent_tasks" && method === "POST") {
      return [{ id: "00000000-0000-4000-8000-000000000043", title: body.title, input: body.input, status: body.status, created_at: "2026-10-25T08:00:00Z" }];
    }
    return [];
  };
  await withServer({}, async base => {
    const response = await fetch(base + "/api/tasks", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Send customer email", description: "Send this email to the customer and confirm when sent",
        taskType: "autonomous", role: "chief-of-staff", mode: "report",
        goal: "Send this email to the customer and confirm when sent", risk: "low"
      })
    });
    assert.equal(response.status, 201);
    const result = await response.json();
    assert.equal(result.task.status, "WAITING_FOR_PERMISSION");
    assert.equal(result.task.input.requestedRisk, "low");
    assert.equal(result.task.input.risk, "high");
    assert.equal(result.task.input.intentRisk.level, "external_effect");
    assert.equal(result.task.input.requiresApproval, true);
    assert.match(result.notice, /intent is not routine/i);
    assert.equal(writes.find(item => item.table === "audit_events").body.metadata.risk, "high");
  }, { supabaseRest: fakeSupabaseRest });
});

test("approved autonomous task is queued for the worker without granting external-action permissions", async () => {
  const taskId = "00000000-0000-4000-8000-000000000042";
  let saved = {
    id: taskId, title: "Prepare a weekly report", status: "WAITING_FOR_PERMISSION",
    input: { taskType: "autonomous", executionMode: "employee_worker", requiresApproval: true, approved: false, role: "chief-of-staff", mode: "report", goal: "Prepare a weekly report" }
  };
  const writes = [];
  const fakeSupabaseRest = async (_req, table, method, query, body) => {
    writes.push({ table, method, query, body });
    if (table === "agent_tasks" && method === "GET") return [{ ...saved }];
    if (table === "agent_tasks" && method === "PATCH") {
      saved = { ...saved, ...body };
      return [{ ...saved }];
    }
    return [];
  };
  await withServer({}, async base => {
    const response = await fetch(base + "/api/tasks/" + taskId + "/approve", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: true })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.task.status, "QUEUED");
    assert.equal(body.task.input.approved, true);
    assert.equal(body.task.input.executionMode, "employee_worker");
    assert.equal(body.task.input.approvalScope, "task_record_only");
    assert.match(body.notice, /external side effects remain blocked/i);
    const statePatch = writes.find(item => item.table === "agent_tasks" && item.method === "PATCH");
    assert.match(statePatch.query, /status=eq.WAITING_FOR_PERMISSION/);
    assert.equal(statePatch.body.input.approved, true);
    assert.equal(statePatch.body.input.executionMode, "employee_worker");
  }, { supabaseRest: fakeSupabaseRest });
});

test("task creation rejects unknown risk values instead of downgrading them to low risk", async () => {
  let databaseCalls = 0;
  await withServer({}, async base => {
    const response = await fetch(base + "/api/tasks", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Research", description: "Review a domain", taskType: "research", risk: "critical" })
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "INVALID_TASK_RISK");
    assert.equal(databaseCalls, 0);
  }, { supabaseRest: async () => { databaseCalls += 1; return []; } });
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

test("task approval uses privileged state transition and audit writes after owner-scoped read", async () => {
  const calls = [];
  const originalInput = { taskType: "employee", executionMode: "employee_worker", role: "seo-aeo", goal: "Draft an article", mode: "draft", requiresApproval: true, approved: false };
  const taskId = "00000000-0000-4000-8000-000000000052";
  const userId = "00000000-0000-4000-8000-000000000001";
  const regularRest = async (_req, table, method, query, body) => {
    calls.push({ path: "user", table, method, query, body });
    if (table === "agent_tasks" && method === "GET") return [{ id: taskId, user_id: userId, title: "Draft", input: originalInput, status: "WAITING_FOR_PERMISSION" }];
    throw Object.assign(new Error("Authenticated client update is denied by database security trigger."), { status: 403 });
  };
  const privilegedRest = async (_req, table, method, query, body) => {
    calls.push({ path: "service", table, method, query, body });
    if (table === "agent_tasks" && method === "PATCH") {
      assert.match(query, /id=eq\.00000000-0000-4000-8000-000000000052/);
      assert.match(query, /user_id=eq\.00000000-0000-4000-8000-000000000001/);
      assert.match(query, /status=eq\.WAITING_FOR_PERMISSION/);
      return [{ id: taskId, title: "Draft", input: body.input, status: "QUEUED" }];
    }
    if (table === "audit_events" && method === "POST") {
      assert.equal(body.user_id, userId);
      assert.equal(body.action, "task.approved");
      assert.equal(body.target_id, taskId);
      return [];
    }
    throw new Error("Unexpected privileged operation");
  };
  await withServer({}, async base => {
    const response = await fetch(base + "/api/tasks/" + taskId + "/approve", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: true })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.task.status, "QUEUED");
    assert.equal(body.task.input.approved, true);
    assert.equal(body.task.input.approvalScope, "task_record_only");
    assert.match(body.notice, /external side effects remain blocked/i);
    assert.equal(calls.filter(call => call.path === "user" && call.table === "agent_tasks" && call.method === "PATCH").length, 0);
    assert.equal(calls.filter(call => call.path === "service" && call.table === "agent_tasks" && call.method === "PATCH").length, 1);
    assert.equal(calls.filter(call => call.path === "service" && call.table === "audit_events" && call.method === "POST").length, 1);
  }, { supabaseRest: regularRest, privilegedSupabaseRest: privilegedRest });
});

test("task cancellation uses the privileged conditional update and never writes audit with user credentials", async () => {
  const calls = [];
  const taskId = "00000000-0000-4000-8000-000000000053";
  const userId = "00000000-0000-4000-8000-000000000001";
  const regularRest = async (_req, table, method, query) => {
    calls.push({ path: "user", table, method, query });
    throw Object.assign(new Error("Authenticated state changes are denied."), { status: 403 });
  };
  const privilegedRest = async (_req, table, method, query, body) => {
    calls.push({ path: "service", table, method, query, body });
    if (table === "agent_tasks" && method === "PATCH") {
      assert.match(query, /id=eq\.00000000-0000-4000-8000-000000000053/);
      assert.match(query, /user_id=eq\.00000000-0000-4000-8000-000000000001/);
      assert.match(query, /status=in\.\(QUEUED,WAITING_FOR_PERMISSION\)/);
      return [{ id: taskId, status: "CANCELLED" }];
    }
    if (table === "audit_events" && method === "POST") {
      assert.equal(body.user_id, userId);
      assert.equal(body.action, "task.cancelled");
      return [];
    }
    throw new Error("Unexpected privileged operation");
  };
  await withServer({}, async base => {
    const response = await fetch(base + "/api/tasks/" + taskId + "/cancel", { method: "POST" });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.task.status, "CANCELLED");
    assert.equal(calls.some(call => call.path === "user"), false);
    assert.equal(calls.filter(call => call.path === "service" && call.table === "audit_events").length, 1);
  }, { supabaseRest: regularRest, privilegedSupabaseRest: privilegedRest });
});

test("task approval requires confirmation but refuses to queue review-only task types", async () => {
  const writes = [];
  const originalInput = { description: "Research a topic", taskType: "manual", executionMode: "planned_only", risk: "medium", requiresApproval: true, approved: false };
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
    assert.equal(approved.status, 409);
    assert.equal((await approved.json()).error.code, "TASK_TYPE_NOT_EXECUTABLE");
    assert.equal(writes.some(write => write.method === "PATCH"), false, "review-only tasks must not be queued after confirmation");
    assert.equal(writes.some(write => write.table === "audit_events"), false);
  }, { supabaseRest: fakeSupabaseRest });
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

test("Fish Audio synthesis defaults to the bilingual male voice and keeps its key server-side", async () => {
  const calls = [];
  const env = {
    FISH_API_KEY: "synthetic-fish-secret"
  };
  await withServer(env, async base => {
    const response = await fetch(base + "/api/speech/synthesize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Hello ULTRON", voice: "alloy" })
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "audio/mpeg");
    assert.equal(response.headers.get("x-ultron-speech-provider"), "fish-audio");
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from("fake-fish-mp3"));
  }, { fetchImpl: async (url, options = {}) => {
    calls.push({ url, options });
    assert.equal(url, "https://api.fish.audio/v1/tts");
    assert.equal(options.method, "POST");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.Authorization, "Bearer synthetic-fish-secret");
    assert.equal(options.headers.model, "s2.1-pro-free");
    const body = JSON.parse(options.body);
    assert.equal(body.text, "Hello ULTRON");
    assert.equal(body.language, "en");
    assert.equal(body.reference_id, "db9ad6eb7fb84294b2046cf05ef64718");
    assert.equal(body.format, "mp3");
    assert.equal(body.latency, "balanced");
    assert.equal(body.normalize, true);
    assert.deepEqual(body.prosody, { speed: 1, volume: 0, normalize_loudness: true });
    assert.equal(JSON.stringify(body).includes("synthetic-fish-secret"), false);
    return new Response(Buffer.from("fake-fish-mp3"), { status: 200, headers: { "Content-Type": "audio/mpeg" } });
  }});
  assert.equal(calls.length, 1);
});

test("Fish Audio transcription sends recorded audio as multipart audio and returns detected language", async () => {
  const calls = [];
  await withServer({
    FISH_API_KEY: "synthetic-fish-secret",
    FISH_AUDIO_STT_MODEL: "transcribe-1"
  }, async base => {
    const response = await fetch(base + "/api/speech/transcribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        audioBase64: Buffer.from("RIFF fake wave data").toString("base64"),
        mimeType: "audio/wav",
        language: "en"
      })
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { text: "Hello from Fish Audio", language: "en", provider: "fish-audio" });
  }, { fetchImpl: async (url, options = {}) => {
    calls.push({ url, options });
    assert.equal(url, "https://api.fish.audio/v1/asr");
    assert.equal(options.method, "POST");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.Authorization, "Bearer synthetic-fish-secret");
    assert.equal(options.headers.model, "transcribe-1");
    assert.equal(options.body instanceof FormData, true);
    const entries = Object.fromEntries([...options.body.entries()].map(([key, value]) => [key, value]));
    assert.equal(entries.audio instanceof Blob, true);
    assert.equal(entries.audio.type, "audio/wav");
    assert.equal(entries.language, "en");
    assert.equal(entries.ignore_timestamps, "true");
    assert.equal(Object.hasOwn(entries, "file"), false);
    return new Response(JSON.stringify({ text: "Hello from Fish Audio", language_code: "en", language: "English", duration: 1, segments: [] }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  }});
  assert.equal(calls.length, 1);
});

test("capabilities report Fish Audio speech configuration without exposing its API key", async () => {
  await withServer({
    FISH_API_KEY: "synthetic-fish-secret",
    FISH_AUDIO_VOICE_MODEL_ID: "db9ad6eb7fb84294b2046cf05ef64718"
  }, async base => {
    const response = await fetch(base + "/api/capabilities");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.providers.speech.fishAudioConfigured, true);
    assert.equal(body.providers.speech.premiumTtsConfigured, true);
    assert.equal(body.providers.speech.premiumSttConfigured, true);
    assert.equal(body.providers.speech.provider, "fish-audio");
    assert.equal(JSON.stringify(body).includes("synthetic-fish-secret"), false);
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

test("coding assistance falls back to a configured provider after OpenRouter rate limiting", async () => {
  const calls = [];
  const env = {
    OPENROUTER_API_KEY: "primary-test-secret",
    OPENROUTER_DEFAULT_MODEL: "openrouter/free",
    SECONDARY_API_KEY: "secondary-test-secret",
    ULTRON_MODEL_PROVIDERS_JSON: JSON.stringify([
      { name: "secondary", baseUrl: "https://api.secondary.example.com/v1", apiKeyEnv: "SECONDARY_API_KEY", model: "secondary-model", priority: 1 }
    ])
  };
  await withServer(env, async base => {
    const response = await fetch(base + "/api/coding/assist", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: "Review a bounded parser", mode: "review" })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.provider, "secondary");
    assert.equal(body.model, "secondary-model");
    assert.equal(body.answer, "Recovered by fallback.");
    assert.equal(body.execution, "not_executed");
    assert.equal(JSON.stringify(body).includes("secondary-test-secret"), false);
  }, { fetchImpl: async (url, options) => {
    calls.push({ url, authorization: options.headers.Authorization });
    if (url.startsWith("https://openrouter.ai/")) {
      return new Response(JSON.stringify({ error: { message: "rate limited" } }), { status: 429 });
    }
    assert.equal(url, "https://api.secondary.example.com/v1/chat/completions");
    return new Response(JSON.stringify({
      model: "secondary-model",
      choices: [{ message: { content: "Recovered by fallback." } }]
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  } });
  assert.deepEqual(calls.map(call => call.url), [
    "https://openrouter.ai/api/v1/chat/completions",
    "https://api.secondary.example.com/v1/chat/completions"
  ]);
  assert.deepEqual(calls.map(call => call.authorization), [
    "Bearer primary-test-secret",
    "Bearer secondary-test-secret"
  ]);
});

test("coding assistance falls back when a provider returns an empty HTTP 200 completion", async () => {
  const calls = [];
  const env = {
    FIRST_API_KEY: "first-test-secret",
    SECOND_API_KEY: "second-test-secret",
    ULTRON_MODEL_PROVIDERS_JSON: JSON.stringify([
      { name: "first", baseUrl: "https://first.example.com/v1", apiKeyEnv: "FIRST_API_KEY", model: "first-model", priority: 1 },
      { name: "second", baseUrl: "https://second.example.com/v1", apiKeyEnv: "SECOND_API_KEY", model: "second-model", priority: 2 }
    ])
  };
  await withServer(env, async base => {
    const response = await fetch(base + "/api/coding/assist", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: "Review a parser", mode: "review" })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.provider, "second");
    assert.equal(body.model, "second-model");
    assert.equal(body.answer, "Recovered from an empty completion.");
  }, { fetchImpl: async url => {
    calls.push(url);
    if (url.startsWith("https://first.example.com/")) {
      return new Response(JSON.stringify({ choices: [{ message: { content: " " } }] }), { status: 200 });
    }
    return new Response(JSON.stringify({
      model: "second-model",
      choices: [{ message: { content: "Recovered from an empty completion." } }]
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  } });
  assert.deepEqual(calls, [
    "https://first.example.com/v1/chat/completions",
    "https://second.example.com/v1/chat/completions"
  ]);
});

test("AI Employee planning works with a configured secondary provider and no OpenRouter key", async () => {
  let requestedModel;
  const env = {
    EMPLOYEE_FALLBACK_KEY: "employee-fallback-secret",
    ULTRON_MODEL_PROVIDERS_JSON: JSON.stringify([
      { name: "employee-fallback", baseUrl: "https://employee.example.com/v1", apiKeyEnv: "EMPLOYEE_FALLBACK_KEY", model: "employee-model", priority: 1 }
    ])
  };
  await withServer(env, async base => {
    const response = await fetch(base + "/api/employees/plan", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "chief-of-staff", goal: "Prepare a launch checklist", mode: "plan" })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.provider, "employee-fallback");
    assert.equal(body.model, "employee-model");
    assert.equal(body.answer, "Drafted through the configured fallback.");
    assert.equal(body.execution, "not_executed");
    assert.equal(JSON.stringify(body).includes("employee-fallback-secret"), false);
  }, { fetchImpl: async (url, options) => {
    assert.equal(url, "https://employee.example.com/v1/chat/completions");
    requestedModel = JSON.parse(options.body).model;
    return new Response(JSON.stringify({
      model: "employee-model",
      choices: [{ message: { content: "Drafted through the configured fallback." } }]
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  } });
  assert.equal(requestedModel, "employee-model");
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


test("HTTP security header analyzer recognizes CSP frame-ancestors as clickjacking protection", async () => {
  await withServer({}, async base => {
    const response = await fetch(base + "/api/kaligpt/tools/headers/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        headers: {
          "Content-Security-Policy": "default-src 'self'; frame-ancestors 'none'"
        }
      })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    const finding = body.findings.find(item => item.id === "frame-protection");
    assert.equal(finding.status, "present-review-value");
    assert.match(finding.evidence, /frame-ancestors 'none'/);
    assert.equal(finding.execution, undefined);
  });
});


test("capabilities accurately report alternate model providers, memory retrieval, and document extraction", async () => {
  const fallbackSecret = "do-not-return-alternate-secret";
  const env = {
    ULTRON_MODEL_PROVIDERS_JSON: JSON.stringify([{
      name: "secondary",
      baseUrl: "https://provider.example.com/v1",
      apiKeyEnv: "SECONDARY_API_KEY",
      model: "example/free-model",
      priority: 10
    }]),
    SECONDARY_API_KEY: fallbackSecret
  };
  await withServer(env, async base => {
    const response = await fetch(base + "/api/capabilities");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.providers.cloud.configured, true);
    assert.equal(body.providers.cloud.provider, "OpenAI-compatible fallback");
    assert.equal(Object.hasOwn(body.providers.cloud, "defaultModel"), false);
    assert.match(body.modules.memory, /chat_retrieval_available/i);
    assert.match(body.modules.documents, /pdf_docx_extraction/i);
    assert.match(body.modules.documents, /transient_only/i);
    assert.equal(JSON.stringify(body).includes(fallbackSecret), false);
  });
});


test("capabilities report a configured fallback when the OpenRouter base URL is invalid", async () => {
  await withServer({
    OPENROUTER_API_KEY: "invalid-primary-key",
    OPENROUTER_BASE_URL: "http://public-provider.invalid/v1",
    ULTRON_MODEL_PROVIDERS_JSON: JSON.stringify([{
      name: "secondary",
      baseUrl: "https://provider.example.com/v1",
      apiKeyEnv: "SECONDARY_API_KEY",
      model: "example/free-model",
      priority: 10
    }]),
    SECONDARY_API_KEY: "secondary-key"
  }, async base => {
    const response = await fetch(base + "/api/capabilities");
    const body = await response.json();
    assert.equal(body.providers.cloud.configured, true);
    assert.equal(body.providers.cloud.provider, "OpenAI-compatible fallback");
    assert.equal(Object.hasOwn(body.providers.cloud, "defaultModel"), false);
  });
});


test("DOCX extraction rejects excessive declared ZIP expansion before decompression", async () => {
  const archive = makeZipBombDocxEntry();
  await withServer({}, async base => {
    const response = await fetch(base + "/api/documents/extract", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: "compressed-bomb.docx",
        format: "docx",
        fileBase64: archive.toString("base64")
      })
    });
    assert.equal(response.status, 413);
    assert.equal((await response.json()).error.code, "DOCUMENT_EXPANSION_LIMIT");
  });
});


test("DOCX extraction rejects actual DEFLATE expansion when ZIP sizes underreport", async () => {
  const payload = Buffer.alloc(20 * 1024 * 1024, 0x41);
  const archive = makeZipBombDocxEntry({ method: 8, expandedSize: 1, payload });
  assert.ok(archive.length < 5_000_000, "compressed archive should fit the upload limit");
  await withServer({}, async base => {
    const response = await fetch(base + "/api/documents/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: "underreported-bomb.docx",
        format: "docx",
        fileBase64: archive.toString("base64")
      })
    });
    assert.equal(response.status, 413);
    assert.equal((await response.json()).error.code, "DOCUMENT_EXPANSION_LIMIT");
  });
});

test("coding assistance falls back after malformed provider JSON", async () => {
  const calls = [];
  const env = {
    FIRST_API_KEY: "first-malformed-secret",
    SECOND_API_KEY: "second-valid-secret",
    ULTRON_MODEL_PROVIDERS_JSON: JSON.stringify([
      { name: "first", baseUrl: "https://malformed.example.com/v1", apiKeyEnv: "FIRST_API_KEY", model: "malformed-model", priority: 1 },
      { name: "second", baseUrl: "https://valid.example.com/v1", apiKeyEnv: "SECOND_API_KEY", model: "valid-model", priority: 2 }
    ])
  };
  await withServer(env, async base => {
    const response = await fetch(base + "/api/coding/assist", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: "Review malformed-response fallback", mode: "review" })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.provider, "second");
    assert.equal(body.model, "valid-model");
    assert.equal(body.answer, "Recovered from malformed JSON.");
  }, { fetchImpl: async url => {
    calls.push(url);
    if (url.startsWith("https://malformed.example.com/")) return new Response("{malformed-json", { status: 200 });
    return new Response(JSON.stringify({
      model: "valid-model",
      choices: [{ message: { content: "Recovered from malformed JSON." } }]
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  } });
  assert.deepEqual(calls, [
    "https://malformed.example.com/v1/chat/completions",
    "https://valid.example.com/v1/chat/completions"
  ]);
});

test("coding assistance bounds oversized provider responses and tries the next provider", async () => {
  const calls = [];
  const env = {
    FIRST_API_KEY: "first-oversized-secret",
    SECOND_API_KEY: "second-small-secret",
    ULTRON_MODEL_PROVIDERS_JSON: JSON.stringify([
      { name: "first", baseUrl: "https://oversized.example.com/v1", apiKeyEnv: "FIRST_API_KEY", model: "large-model", priority: 1 },
      { name: "second", baseUrl: "https://small.example.com/v1", apiKeyEnv: "SECOND_API_KEY", model: "small-model", priority: 2 }
    ])
  };
  await withServer(env, async base => {
    const response = await fetch(base + "/api/coding/assist", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: "Handle oversized upstream output", mode: "review" })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.provider, "second");
    assert.equal(body.answer, "Recovered from oversized output.");
  }, { fetchImpl: async url => {
    calls.push(url);
    if (url.startsWith("https://oversized.example.com/")) {
      return new Response(" ".repeat(2 * 1024 * 1024 + 128), { status: 200 });
    }
    return new Response(JSON.stringify({
      model: "small-model",
      choices: [{ message: { content: "Recovered from oversized output." } }]
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  } });
  assert.deepEqual(calls, [
    "https://oversized.example.com/v1/chat/completions",
    "https://small.example.com/v1/chat/completions"
  ]);
});

test("coding assistance retries a provider timeout with the next eligible provider", async () => {
  const calls = [];
  const env = {
    ULTRON_PROVIDER_FIRST_RESPONSE_TIMEOUT_MS: "1000",
    FIRST_API_KEY: "first-timeout-secret",
    SECOND_API_KEY: "second-timeout-secret",
    ULTRON_MODEL_PROVIDERS_JSON: JSON.stringify([
      { name: "first", baseUrl: "https://timeout.example.com/v1", apiKeyEnv: "FIRST_API_KEY", model: "slow-model", priority: 1 },
      { name: "second", baseUrl: "https://fast.example.com/v1", apiKeyEnv: "SECOND_API_KEY", model: "fast-model", priority: 2 }
    ])
  };
  await withServer(env, async base => {
    const response = await fetch(base + "/api/coding/assist", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: "Use timeout fallback", mode: "review" })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.provider, "second");
    assert.equal(body.model, "fast-model");
    assert.equal(body.answer, "Recovered after timeout.");
  }, { fetchImpl: async (url, options) => {
    calls.push(url);
    if (url.startsWith("https://timeout.example.com/")) {
      return new Promise((resolve, reject) => {
        const rejectOnAbort = () => reject(options.signal.reason || new DOMException("Timed out", "TimeoutError"));
        if (options.signal.aborted) rejectOnAbort();
        else options.signal.addEventListener("abort", rejectOnAbort, { once: true });
      });
    }
    return new Response(JSON.stringify({
      model: "fast-model",
      choices: [{ message: { content: "Recovered after timeout." } }]
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  } });
  assert.deepEqual(calls, [
    "https://timeout.example.com/v1/chat/completions",
    "https://fast.example.com/v1/chat/completions"
  ]);
});

test("feature endpoints reject unsafe fallback provider URLs without making network requests", async () => {
  let providerCalls = 0;
  const secret = "must-never-be-returned";
  const env = {
    UNSAFE_API_KEY: secret,
    ULTRON_MODEL_PROVIDERS_JSON: JSON.stringify([
      { name: "unsafe", baseUrl: "http://provider.example.com/v1", apiKeyEnv: "UNSAFE_API_KEY", model: "unsafe-model", priority: 1 }
    ])
  };
  await withServer(env, async base => {
    const response = await fetch(base + "/api/coding/assist", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: "Check provider safety", mode: "review" })
    });
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error.code, "CODING_PROVIDER_NOT_CONFIGURED");
    assert.equal(JSON.stringify(body).includes(secret), false);
    assert.equal(providerCalls, 0);
  }, { fetchImpl: async () => {
    providerCalls += 1;
    throw new Error("Unsafe provider URL must not be called");
  } });
});



test("feature model provider registry rejects private HTTPS hosts without making requests", async () => {
  let called = false;
  const env = {
    ULTRON_MODEL_PROVIDERS_JSON: JSON.stringify([
      { name: "private-https", baseUrl: "https://192.168.1.10/v1", apiKeyEnv: "PRIVATE_KEY", model: "fake-model", priority: 1 }
    ]),
    PRIVATE_KEY: "synthetic-secret"
  };
  await withServer(env, async base => {
    const response = await fetch(base + "/api/coding/assist", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: "Check safe provider handling", mode: "review" })
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "CODING_PROVIDER_NOT_CONFIGURED");
    assert.equal(called, false);
  }, { fetchImpl: async () => {
    called = true;
    throw new Error("Private configured provider must not be called.");
  } });
});


test("TTS streaming response is rejected by its declared byte limit before buffering", async () => {
  let upstreamCalled = false;
  let bodyCancelled = false;
  await withServer({
    TTS_API_BASE_URL: "https://tts.example.com/v1",
    TTS_API_KEY: "synthetic-tts-key"
  }, async base => {
    const response = await fetch(base + "/api/speech/synthesize", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Speak safely" })
    });
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error.code, "TTS_INVALID_AUDIO");
    assert.equal(bodyCancelled, true);
  }, { fetchImpl: async (_url, options) => {
    assert.equal(options.redirect, "error");
    upstreamCalled = true;
    return new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode("small chunk")); },
      cancel() { bodyCancelled = true; }
    }), { status: 200, headers: { "content-length": "12000001", "content-type": "audio/mpeg" } });
  } });
  assert.equal(upstreamCalled, true);
});

test("STT JSON response is bounded and cancelled when declared oversized", async () => {
  let bodyCancelled = false;
  await withServer({
    STT_API_BASE_URL: "https://stt.example.com/v1",
    STT_API_KEY: "synthetic-stt-key"
  }, async base => {
    const response = await fetch(base + "/api/speech/transcribe", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audioBase64: Buffer.from("RIFF").toString("base64"), mimeType: "audio/wav" })
    });
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error.code, "STT_INVALID_RESPONSE");
    assert.equal(bodyCancelled, true);
  }, { fetchImpl: async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode("{\"text\":\"tiny\"}")); },
    cancel() { bodyCancelled = true; }
  }), { status: 200, headers: { "content-length": "1000001", "content-type": "application/json" } }) });
});


const STUDY_PACK_TEST_ID = "10000000-0000-4000-8000-000000000001";
const STUDY_PACK_USER_ID = "00000000-0000-4000-8000-000000000001";
const validStudyPack = () => ({
  state: "completed",
  topic: "Photosynthesis",
  format: "mixed",
  level: "beginner",
  language: "English",
  sourceMode: "general_knowledge_draft",
  generatedAt: "2026-10-29T00:00:00.000Z",
  model: "test-model",
  learningObjectives: ["Explain photosynthesis"],
  summary: "Photosynthesis converts light energy to stored chemical energy.",
  flashcards: [{ question: "What pigment absorbs light?", answer: "Chlorophyll." }],
  quiz: [{
    question: "What gas is taken in?",
    options: ["Oxygen", "Carbon dioxide", "Nitrogen", "Hydrogen"],
    answerIndex: 1,
    explanation: "Carbon dioxide supplies carbon for sugars."
  }],
  revisionChecklist: ["Remember the inputs and products"],
  sourceNotes: "General-knowledge draft.",
  notice: "AI-generated study aid."
});

test("study pack library saves only validated user-owned content", async () => {
  const calls = [];
  await withServer({}, async base => {
    const response = await fetch(base + "/api/study-packs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Photosynthesis Revision", user_id: "99999999-9999-4999-8999-999999999999", pack: validStudyPack() })
    });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.studyPack.id, STUDY_PACK_TEST_ID);
    assert.equal(body.studyPack.user_id, STUDY_PACK_USER_ID);
    assert.equal(body.studyPack.title, "Photosynthesis Revision");
    assert.equal(body.studyPack.content.quiz[0].answerIndex, 1);
  }, {
    supabaseRest: async (_req, table, method, query, body) => {
      calls.push({ table, method, query, body });
      assert.equal(table, "study_packs");
      assert.equal(method, "POST");
      assert.equal(query, "");
      return [{ ...body, id: STUDY_PACK_TEST_ID, created_at: "2026-10-29T00:00:00.000Z", updated_at: "2026-10-29T00:00:00.000Z" }];
    }
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.user_id, STUDY_PACK_USER_ID, "owner ID must come from the authenticated session, not JSON");
  assert.equal(calls[0].body.source_mode, "general_knowledge_draft");
});

test("study pack library rejects malformed quiz content before database writes", async () => {
  let calls = 0;
  const pack = validStudyPack();
  pack.quiz[0].answerIndex = 9;
  await withServer({}, async base => {
    const response = await fetch(base + "/api/study-packs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pack })
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "INVALID_STUDY_PACK");
    assert.equal(calls, 0);
  }, { supabaseRest: async () => { calls++; return []; } });
});

test("study pack library list/detail/delete use explicit authenticated-owner filters", async () => {
  const calls = [];
  const packRow = {
    id: STUDY_PACK_TEST_ID,
    user_id: STUDY_PACK_USER_ID,
    title: "Photosynthesis",
    topic: "Photosynthesis",
    format: "mixed",
    level: "beginner",
    language: "English",
    source_mode: "general_knowledge_draft",
    content: { summary: validStudyPack().summary },
    created_at: "2026-10-29T00:00:00.000Z",
    updated_at: "2026-10-29T00:00:00.000Z"
  };
  await withServer({}, async base => {
    const listResponse = await fetch(base + "/api/study-packs?limit=1000");
    assert.equal(listResponse.status, 200);
    assert.equal((await listResponse.json()).studyPacks[0].id, STUDY_PACK_TEST_ID);

    const detailResponse = await fetch(base + "/api/study-packs/" + STUDY_PACK_TEST_ID);
    assert.equal(detailResponse.status, 200);
    assert.equal((await detailResponse.json()).studyPack.content.summary, validStudyPack().summary);

    const deleteResponse = await fetch(base + "/api/study-packs/" + STUDY_PACK_TEST_ID, { method: "DELETE" });
    assert.equal(deleteResponse.status, 200);
    assert.deepEqual(await deleteResponse.json(), { deleted: true, id: STUDY_PACK_TEST_ID });
  }, {
    supabaseRest: async (_req, table, method, query) => {
      calls.push({ table, method, query });
      assert.equal(table, "study_packs");
      assert.ok(query.includes("user_id=eq." + STUDY_PACK_USER_ID), "every operation must filter by the authenticated user");
      if (method === "DELETE") return [packRow];
      if (query.includes("id=eq.")) return [packRow];
      return [packRow];
    }
  });
  assert.equal(calls.length, 3);
  assert.ok(calls[0].query.endsWith("&limit=50"), "list limit must be clamped to 50");
  assert.ok(calls[1].query.includes("id=eq." + STUDY_PACK_TEST_ID));
  assert.equal(calls[2].method, "DELETE");
});


const USER_NOTE_TEST_ID = "20000000-0000-4000-8000-000000000001";
const USER_NOTE_OWNER_ID = "00000000-0000-4000-8000-000000000001";
const validNoteInput = () => ({
  title: "Quantum Physics Revision",
  body: "Energy bands describe allowed electron energies in solids.",
  tags: ["physics", "revision"]
});

test("notes library saves only authenticated-owner data", async () => {
  const calls = [];
  const note = { ...validNoteInput(), id: USER_NOTE_TEST_ID, user_id: USER_NOTE_OWNER_ID, created_at: "2026-10-29T00:00:00.000Z", updated_at: "2026-10-29T00:00:00.000Z" };
  await withServer({}, async base => {
    const response = await fetch(base + "/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validNoteInput(), user_id: "99999999-9999-4999-8999-999999999999" })
    });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.note.id, USER_NOTE_TEST_ID);
    assert.equal(body.note.user_id, USER_NOTE_OWNER_ID);
    assert.deepEqual(body.note.tags, ["physics", "revision"]);
  }, {
    supabaseRest: async (_req, table, method, query, body) => {
      calls.push({ table, method, query, body });
      assert.equal(table, "user_notes");
      assert.equal(method, "POST");
      assert.equal(query, "");
      return [{ ...body, id: USER_NOTE_TEST_ID, created_at: note.created_at, updated_at: note.updated_at }];
    }
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.user_id, USER_NOTE_OWNER_ID);
});

test("notes library rejects oversized, empty and malformed note input before database writes", async () => {
  let calls = 0;
  await withServer({}, async base => {
    for (const body of [
      { title: " ", body: "valid body" },
      { title: "valid title", body: " " },
      { title: "valid title", body: "valid body", tags: "not-an-array" },
      { title: "valid title", body: "valid body", tags: Array.from({ length: 21 }, (_, i) => "tag" + i) },
      { title: "valid title", body: "valid body", tags: ["x".repeat(41)] },
      { title: "valid title", body: "x".repeat(30001) }
    ]) {
      const response = await fetch(base + "/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error.code, "INVALID_NOTE");
    }
  }, { supabaseRest: async () => { calls++; return []; } });
  assert.equal(calls, 0);
});

test("notes library list/detail/update/delete are filtered to the authenticated owner", async () => {
  const calls = [];
  const note = { ...validNoteInput(), id: USER_NOTE_TEST_ID, user_id: USER_NOTE_OWNER_ID, created_at: "2026-10-29T00:00:00.000Z", updated_at: "2026-10-29T00:00:00.000Z" };
  await withServer({}, async base => {
    const list = await fetch(base + "/api/notes?limit=999");
    assert.equal(list.status, 200);
    assert.equal((await list.json()).notes[0].id, USER_NOTE_TEST_ID);

    const detail = await fetch(base + "/api/notes/" + USER_NOTE_TEST_ID);
    assert.equal(detail.status, 200);
    assert.equal((await detail.json()).note.body, note.body);

    const exported = await fetch(base + "/api/notes/" + USER_NOTE_TEST_ID + "/export");
    assert.equal(exported.status, 200);
    assert.match(exported.headers.get("content-type"), /text\/markdown/);
    assert.match(exported.headers.get("content-disposition"), /attachment; filename="Quantum-Physics-Revision\.md"/);
    const markdown = await exported.text();
    assert.match(markdown, /^# Quantum Physics Revision/);
    assert.match(markdown, /Energy bands describe allowed electron energies/);
    assert.match(markdown, /Tags: physics, revision/);

    const update = await fetch(base + "/api/notes/" + USER_NOTE_TEST_ID, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Updated title", tags: ["updated"] })
    });
    assert.equal(update.status, 200);
    assert.equal((await update.json()).note.title, "Updated title");

    const deletion = await fetch(base + "/api/notes/" + USER_NOTE_TEST_ID, { method: "DELETE" });
    assert.equal(deletion.status, 200);
    assert.deepEqual(await deletion.json(), { deleted: true, id: USER_NOTE_TEST_ID });
  }, {
    supabaseRest: async (_req, table, method, query, body) => {
      calls.push({ table, method, query, body });
      assert.equal(table, "user_notes");
      assert.ok(query.includes("user_id=eq." + USER_NOTE_OWNER_ID), "all operations must be owner-filtered");
      if (method === "DELETE") return [note];
      if (method === "PATCH") return [{ ...note, ...body }];
      return [note];
    }
  });
  assert.equal(calls.length, 5);
  assert.ok(calls[0].query.endsWith("&limit=50"));
  assert.ok(calls[1].query.includes("id=eq." + USER_NOTE_TEST_ID));
  assert.ok(calls[2].query.includes("id=eq." + USER_NOTE_TEST_ID));
  assert.equal(calls[3].method, "PATCH");
  assert.deepEqual(calls[3].body, { title: "Updated title", tags: ["updated"] });
  assert.equal(calls[4].method, "DELETE");
});


test("notes search accepts only literal safe terms", async () => {
  const calls = [];
  await withServer({}, async base => {
    const valid = await fetch(base + "/api/notes?search=quantum%20physics");
    assert.equal(valid.status, 200);
    assert.deepEqual((await valid.json()).notes, []);

    for (const search of ["", "a,b", "x*)&user_id=neq.000", "title.ilike.*"]) {
      const response = await fetch(base + "/api/notes?search=" + encodeURIComponent(search));
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error.code, "INVALID_NOTE_SEARCH");
    }
  }, {
    supabaseRest: async (_req, table, method, query) => {
      calls.push({ table, method, query });
      assert.equal(table, "user_notes");
      assert.ok(query.includes("user_id=eq." + USER_NOTE_OWNER_ID));
      return [];
    }
  });
  assert.equal(calls.length, 1, "unsafe search strings must be rejected before database access");
  assert.ok(decodeURIComponent(calls[0].query).includes("title.ilike.*quantum physics*"));
  assert.ok(decodeURIComponent(calls[0].query).includes("body.ilike.*quantum physics*"));
});

test("notes library rejects invalid IDs and returns not-found without leaking cross-user records", async () => {
  let calls = 0;
  await withServer({}, async base => {
    const invalid = await fetch(base + "/api/notes/not-a-uuid");
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error.code, "INVALID_NOTE_ID");

    const missing = await fetch(base + "/api/notes/" + USER_NOTE_TEST_ID);
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error.code, "NOTE_NOT_FOUND");
  }, {
    supabaseRest: async (_req, table, method, query) => {
      calls++;
      assert.equal(table, "user_notes");
      assert.ok(query.includes("user_id=eq." + USER_NOTE_OWNER_ID));
      return [];
    }
  });
  assert.equal(calls, 1);
});

test("configured Ollama model listing rejects upstream redirects", async () => {
  await withServer({ OLLAMA_BASE_URL: "https://ollama.example.com" }, async base => {
    const response = await fetch(base + "/api/local/models");
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).models.map(model => model.name), ["tiny-test-model"]);
  }, { fetchImpl: async (url, options) => {
    assert.equal(url, "https://ollama.example.com/api/tags");
    assert.equal(options.redirect, "error");
    return new Response(JSON.stringify({ models: [{ name: "tiny-test-model", size: 1024 }] }), { status: 200, headers: { "content-type": "application/json" } });
  } });
});

test("configured Ollama chat rejects upstream redirects before sending prompt context", async () => {
  await withServer({ OLLAMA_BASE_URL: "https://ollama.example.com" }, async base => {
    const response = await fetch(base + "/api/local/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "tiny-test-model", messages: [{ role: "user", content: "Hello" }] })
    });
    assert.equal(response.status, 200);
    assert.match((await response.json()).content, /local response/i);
  }, { fetchImpl: async (url, options) => {
    assert.equal(url, "https://ollama.example.com/api/chat");
    assert.equal(options.redirect, "error");
    return new Response(JSON.stringify({ model: "tiny-test-model", message: { content: "Local response ready." } }), { status: 200, headers: { "content-type": "application/json" } });
  } });
});
