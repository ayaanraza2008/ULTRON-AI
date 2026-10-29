import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createAgentRouter } from "../agent-runtime.js";
import { classifyTaskRoute } from "../task-router.js";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const NOTE_ID = "20000000-0000-4000-8000-000000000001";

async function withAgentServer(env, fetchImpl, supabaseRest, run) {
  const app = express();
  app.use(express.json({ limit: "12mb" }));
  app.use("/api", createAgentRouter({
    env: { ...env, ULTRON_INTEGRATION_OWNER_USER_ID: USER_ID },
    fetchImpl,
    supabaseRest,
    privilegedSupabaseRest: supabaseRest,
    requireSupabaseUser: (req, _res, next) => {
      req.supabaseUser = { id: USER_ID };
      next();
    },
    logger: { warn() {}, info() {} }
  }));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try {
    await run("http://127.0.0.1:" + server.address().port);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

async function sendAgentPrompt(base, prompt) {
  return fetch(base + "/api/agent/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt })
  });
}

function providerReply(message) {
  return new Response(JSON.stringify({ choices: [{ message }] }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

test("task router narrows note requests to private Notes tools", () => {
  for (const prompt of [
    "Create a note titled Quantum Revision with my notes about energy bands",
    "Search my notes for quantum physics",
    "Update my note with the title Energy Bands"
  ]) {
    const route = classifyTaskRoute(prompt);
    assert.equal(route.tier, "medium");
    assert.ok(route.categories.includes("notes"));
    assert.equal(route.filtered, true);
    assert.deepEqual(route.toolNames, ["notes_search", "notes_read", "notes_create", "notes_update"]);
  }
});

test("agent creates a private note with owner ID from the authenticated session", async () => {
  let providerCalls = 0;
  let writeCalls = 0;
  let schemaNames;
  const noteRow = {
    id: NOTE_ID,
    user_id: USER_ID,
    title: "Quantum Revision",
    body: "Energy bands are allowed electron-energy ranges.",
    tags: ["physics", "revision"],
    updated_at: "2026-10-29T00:00:00.000Z"
  };

  await withAgentServer({ OPENROUTER_API_KEY: "notes-create-test-provider-key" }, async (url, options) => {
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    providerCalls += 1;
    const payload = JSON.parse(options.body);
    schemaNames ||= payload.tools.map(tool => tool.function.name);
    const hasCreateResult = payload.messages.some(message =>
      message.role === "tool" && typeof message.content === "string" && message.content.includes('"state":"created"')
    );
    if (hasCreateResult) {
      return providerReply({ role: "assistant", content: "I saved the Quantum Revision note to your private ULTRON notes." });
    }
    return providerReply({
      content: null,
      tool_calls: [{
        id: "notes-create-call",
        type: "function",
        function: {
          name: "notes_create",
          arguments: JSON.stringify({
            title: "Quantum Revision",
            body: "Energy bands are allowed electron-energy ranges.",
            tags: ["physics", "revision"],
            user_id: "99999999-9999-4999-8999-999999999999"
          })
        }
      }]
    });
  }, async (_req, table, method, query, body) => {
    if (table === "user_preferences") return [{ memory_enabled: false }];
    writeCalls += 1;
    assert.equal(table, "user_notes");
    assert.equal(method, "POST");
    assert.equal(query, "");
    assert.equal(body.user_id, USER_ID, "the model-supplied user_id must be ignored");
    assert.equal(body.title, noteRow.title);
    assert.deepEqual(body.tags, noteRow.tags);
    return [{ ...body, id: NOTE_ID, updated_at: noteRow.updated_at }];
  }, async base => {
    const response = await sendAgentPrompt(base, "Create a note titled Quantum Revision with my notes about energy bands");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.match(body.content, /saved the Quantum Revision note/i);
    assert.deepEqual(schemaNames, ["notes_read", "notes_search", "notes_create", "notes_update"]);
    assert.equal(body.toolsUsed.length, 1);
    assert.equal(body.toolsUsed[0].name, "notes_create");
    assert.equal(body.toolsUsed[0].ok, true);
    assert.equal(body.toolResults[0].result.state, "created");
    assert.equal(body.toolResults[0].result.note.id, NOTE_ID);
    assert.equal(body.toolResults[0].result.note.bodyPreview, noteRow.body);
  });

  assert.equal(providerCalls, 2);
  assert.equal(writeCalls, 1);
});

test("agent note search stays user-scoped and only accepts literal safe search terms", async () => {
  let providerCalls = 0;
  let readCalls = 0;
  const noteRow = {
    id: NOTE_ID,
    title: "Quantum Revision",
    body: "Energy bands are allowed electron-energy ranges.",
    tags: ["physics"],
    updated_at: "2026-10-29T00:00:00.000Z"
  };

  await withAgentServer({ OPENROUTER_API_KEY: "notes-search-test-provider-key" }, async (url, options) => {
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    providerCalls += 1;
    const payload = JSON.parse(options.body);
    const hasSearchResult = payload.messages.some(message =>
      message.role === "tool" && typeof message.content === "string" && message.content.includes('"query":"quantum physics"')
    );
    if (hasSearchResult) return providerReply({ role: "assistant", content: "I found your Quantum Revision note." });
    return providerReply({
      content: null,
      tool_calls: [{
        id: "notes-search-call",
        type: "function",
        function: { name: "notes_search", arguments: JSON.stringify({ query: "quantum physics", limit: 5 }) }
      }]
    });
  }, async (req, table, method, query) => {
    if (table === "user_preferences") return [{ memory_enabled: false }];
    readCalls += 1;
    assert.equal(table, "user_notes");
    assert.equal(method, "GET");
    assert.ok(query.includes("user_id=eq." + USER_ID));
    const parsed = new URL("https://ultron.test/rest/v1/" + table + query);
    const filter = decodeURIComponent(parsed.searchParams.get("or") || "");
    assert.match(filter, /title\.ilike\.\*quantum physics\*/);
    assert.match(filter, /body\.ilike\.\*quantum physics\*/);
    assert.equal(req.supabaseUser.id, USER_ID);
    return [noteRow];
  }, async base => {
    const response = await sendAgentPrompt(base, "Search my notes for quantum physics");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.match(body.content, /found your Quantum Revision note/i);
    assert.equal(body.toolResults[0].result.count, 1);
    assert.equal(body.toolResults[0].result.notes[0].id, NOTE_ID);
  });

  assert.equal(providerCalls, 2);
  assert.equal(readCalls, 1);
});

test("agent refuses an unsafe note search term before accessing Supabase", async () => {
  let providerCalls = 0;
  let supabaseCalls = 0;
  await withAgentServer({ OPENROUTER_API_KEY: "notes-invalid-search-test-key" }, async (url, options) => {
    providerCalls += 1;
    const payload = JSON.parse(options.body);
    if (payload.messages.some(message => message.role === "tool" && message.content.includes("INVALID_NOTE_SEARCH"))) {
      return providerReply({ role: "assistant", content: "That search term contains unsupported filter characters." });
    }
    return providerReply({
      content: null,
      tool_calls: [{
        id: "notes-invalid-search-call",
        type: "function",
        function: { name: "notes_search", arguments: JSON.stringify({ query: "x*)&user_id=neq.000" }) }
      }]
    });
  }, async (_req, table) => {
    if (table === "user_preferences") return [{ memory_enabled: false }];
    supabaseCalls += 1;
    throw new Error("Unsafe note search must not reach the notes table.");
  }, async base => {
    const response = await sendAgentPrompt(base, "Search my notes for quantum physics");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.toolResults[0].ok, false);
    assert.match(body.content, /unsupported filter characters/i);
  });

  assert.equal(providerCalls, 2);
  assert.equal(supabaseCalls, 0);
});

test("agent updates a user's own note using an owner-filtered conditional update", async () => {
  let providerCalls = 0;
  let updateCalls = 0;
  const row = {
    id: NOTE_ID,
    user_id: USER_ID,
    title: "Energy Bands",
    body: "Revised explanation.",
    tags: ["physics"],
    updated_at: "2026-10-29T00:10:00.000Z"
  };

  await withAgentServer({ OPENROUTER_API_KEY: "notes-update-test-provider-key" }, async (url, options) => {
    providerCalls += 1;
    const payload = JSON.parse(options.body);
    const updated = payload.messages.some(message => message.role === "tool" && message.content.includes('"state":"updated"'));
    if (updated) return providerReply({ role: "assistant", content: "Your Energy Bands note has been updated." });
    return providerReply({
      content: null,
      tool_calls: [{
        id: "notes-update-call",
        type: "function",
        function: { name: "notes_update", arguments: JSON.stringify({ id: NOTE_ID, title: "Energy Bands" }) }
      }]
    });
  }, async (_req, table, method, query, patch) => {
    if (table === "user_preferences") return [{ memory_enabled: false }];
    updateCalls += 1;
    assert.equal(table, "user_notes");
    assert.equal(method, "PATCH");
    assert.ok(query.includes("id=eq." + NOTE_ID));
    assert.ok(query.includes("user_id=eq." + USER_ID));
    assert.deepEqual(patch, { title: "Energy Bands" });
    return [{ ...row, ...patch }];
  }, async base => {
    const response = await sendAgentPrompt(base, "Update my note with the title Energy Bands");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.match(body.content, /note has been updated/i);
    assert.equal(body.toolResults[0].result.state, "updated");
    assert.equal(body.toolResults[0].result.note.title, "Energy Bands");
  });

  assert.equal(providerCalls, 2);
  assert.equal(updateCalls, 1);
});

test("agent reads a full private note only through an owner-filtered query", async () => {
  let providerCalls = 0;
  let reads = 0;
  const bodyText = "Full saved note content with all the details the short search preview omits.";
  await withAgentServer({ OPENROUTER_API_KEY: "notes-read-test-provider-key" }, async (url, options) => {
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    providerCalls += 1;
    const payload = JSON.parse(options.body);
    const hasReadResult = payload.messages.some(message => message.role === "tool"
      && typeof message.content === "string" && message.content.includes('"body":"' + bodyText + '"'));
    if (hasReadResult) {
      return providerReply({ role: "assistant", content: "I read your full saved Quantum Revision note." });
    }
    return providerReply({
      content: null,
      tool_calls: [{
        id: "notes-read-call",
        type: "function",
        function: { name: "notes_read", arguments: JSON.stringify({ id: NOTE_ID }) }
      }]
    });
  }, async (req, table, method, query) => {
    if (table === "user_preferences") return [{ memory_enabled: false }];
    reads += 1;
    assert.equal(table, "user_notes");
    assert.equal(method, "GET");
    assert.ok(query.includes("id=eq." + NOTE_ID));
    assert.ok(query.includes("user_id=eq." + USER_ID));
    assert.equal(req.supabaseUser.id, USER_ID);
    return [{
      id: NOTE_ID,
      title: "Quantum Revision",
      body: bodyText,
      tags: ["physics"],
      created_at: "2026-10-28T00:00:00.000Z",
      updated_at: "2026-10-29T00:00:00.000Z"
    }];
  }, async base => {
    const response = await sendAgentPrompt(base, "Read my note " + NOTE_ID);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.match(body.content, /read your full saved Quantum Revision note/i);
    assert.ok(body.routing.categories.includes("notes"));
    assert.deepEqual(body.toolResults[0].result.note.body, bodyText);
    assert.equal(body.toolResults[0].result.sourceContentTrust, "untrusted_user_saved_content");
  });

  assert.equal(providerCalls, 2);
  assert.equal(reads, 1);
});
