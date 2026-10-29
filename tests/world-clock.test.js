import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { buildWorldClockSnapshot, createAgentRouter } from "../agent-runtime.js";
import { classifyTaskRoute } from "../task-router.js";

const USER_ID = "00000000-0000-4000-8000-000000000001";

async function withAgentServer(env, fetchImpl, run) {
  const app = express();
  app.use(express.json({ limit: "12mb" }));
  app.use("/api", createAgentRouter({
    env: { ...env, ULTRON_INTEGRATION_OWNER_USER_ID: USER_ID },
    fetchImpl,
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

test("world clock returns multiple zones at one captured timestamp without network access", () => {
  const now = new Date("2026-01-15T12:00:00.000Z");
  const result = buildWorldClockSnapshot(["Asia/Kolkata", "Europe/London", "Asia/Kolkata"], { now });

  assert.equal(result.state, "ok");
  assert.equal(result.capturedAt, "2026-01-15T12:00:00.000Z");
  assert.equal(result.locations.length, 2);
  assert.equal(result.locations[0].timeZone, "Asia/Kolkata");
  assert.match(result.locations[0].localDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(result.locations[0].localTime, /^\d{2}:\d{2}:\d{2}$/);
  assert.match(result.locations[0].utcOffset, /GMT\+05:30/);
  assert.ok(result.locations.every(item => item.timestamp === result.capturedAt));
  assert.deepEqual(result.invalidTimeZones, []);
});

test("world clock isolates invalid time-zone identifiers and reports partial results", () => {
  const result = buildWorldClockSnapshot(["Asia/Kolkata", "Mars/Phobos"], { now: new Date("2026-01-15T12:00:00.000Z") });

  assert.equal(result.state, "partial");
  assert.equal(result.locations.length, 1);
  assert.deepEqual(result.invalidTimeZones, ["Mars/Phobos"]);
});

test("world clock rejects an all-invalid zone list without claiming a successful result", () => {
  const result = buildWorldClockSnapshot(["Mars/Phobos"], { now: new Date("2026-01-15T12:00:00.000Z") });

  assert.equal(result.state, "invalid_time_zones");
  assert.deepEqual(result.locations, []);
  assert.deepEqual(result.invalidTimeZones, ["Mars/Phobos"]);
});

test("task router gives time-zone questions only the world-clock tool", () => {
  const route = classifyTaskRoute("What time is it in Tokyo and London?");

  assert.equal(route.tier, "medium");
  assert.deepEqual(route.categories, ["time"]);
  assert.equal(route.filtered, true);
  assert.deepEqual(route.toolNames, ["world_clock"]);
});

test("agent invokes the offline world-clock tool and returns its real tool result", async () => {
  let providerCalls = 0;
  let firstToolSchema;
  const env = { OPENROUTER_API_KEY: "world-clock-test-key" };

  await withAgentServer(env, async (url, options) => {
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    providerCalls += 1;
    const payload = JSON.parse(options.body);
    firstToolSchema ||= payload.tools.map(tool => tool.function.name);

    const hasClockResult = payload.messages.some(message =>
      message.role === "tool" && message.content.includes('"Asia/Tokyo"')
    );
    if (hasClockResult) {
      return new Response(JSON.stringify({
        choices: [{ message: { role: "assistant", content: "I checked both time zones using the system clock." } }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }

    return new Response(JSON.stringify({
      choices: [{
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{
            id: "world-clock-call-1",
            type: "function",
            function: {
              name: "world_clock",
              arguments: JSON.stringify({ timeZones: ["Asia/Tokyo", "Europe/London"] })
            }
          }]
        }
      }]
    }), { status: 200, headers: { "content-type": "application/json" } });
  }, async base => {
    const response = await fetch(base + "/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "What time is it in Tokyo and London?" })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.match(body.content, /checked both time zones/i);
    assert.deepEqual(firstToolSchema, ["world_clock"]);
    assert.equal(body.routing.tier, "medium");
    assert.ok(body.routing.categories.includes("time"));
    assert.equal(body.toolsUsed.length, 1);
    assert.equal(body.toolsUsed[0].name, "world_clock");
    assert.equal(body.toolsUsed[0].ok, true);
    assert.deepEqual(body.toolsUsed[0].result.locations.map(item => item.timeZone), ["Asia/Tokyo", "Europe/London"]);
    assert.ok(body.toolsUsed[0].result.locations.every(item => item.timestamp === body.toolsUsed[0].result.capturedAt));
  });

  assert.equal(providerCalls, 2);
});
