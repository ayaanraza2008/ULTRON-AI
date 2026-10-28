import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createAgentRouter } from "../agent-runtime.js";

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

async function withServer(env, fetchImpl, run) {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api", createAgentRouter({
    env,
    fetchImpl,
    requireSupabaseUser: (req, _res, next) => { req.supabaseUser = { id: "00000000-0000-4000-8000-000000000001" }; next(); },
    logger: { warn() {}, info() {} }
  }));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try { await run("http://127.0.0.1:" + server.address().port); }
  finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

test("agent exposes and executes the fixed public API lookup tool for an ordinary weather request", async () => {
  let modelCalls = 0;
  const externalUrls = [];
  await withServer({ OPENROUTER_API_KEY: "test-only", OPENROUTER_DEFAULT_MODEL: "openrouter/free" }, async (url, options) => {
    if (String(url).startsWith("https://openrouter.ai/api/v1/chat/completions")) {
      modelCalls++;
      const body = JSON.parse(options.body);
      assert.ok(body.tools.some(tool => tool.function?.name === "public_api_lookup"));
      if (modelCalls === 1) {
        return jsonResponse({ choices: [{ message: { role: "assistant", content: "I will check that." } }] });
      }
      return jsonResponse({ choices: [{ message: { role: "assistant", content: "Open-Meteo reports 31.2°C in Agra. Weather data is attributed to Open-Meteo." } }] });
    }
    externalUrls.push(String(url));
    if (String(url).startsWith("https://geocoding-api.open-meteo.com/")) {
      return jsonResponse({ results: [{ name: "Agra", country: "India", admin1: "Uttar Pradesh", latitude: 27.1767, longitude: 78.0081 }] });
    }
    if (String(url).startsWith("https://api.open-meteo.com/v1/forecast?")) {
      return jsonResponse({ timezone: "Asia/Kolkata", current: { temperature_2m: 31.2, time: "2026-10-29T12:00" }, current_units: { temperature_2m: "°C" } });
    }
    throw new Error("Unexpected external URL: " + url);
  }, async base => {
    const toolsResponse = await fetch(base + "/api/agent/tools");
    assert.equal(toolsResponse.status, 200);
    const toolsBody = await toolsResponse.json();
    const publicApiTool = toolsBody.tools.find(tool => tool.name === "public_api_lookup");
    assert.equal(publicApiTool.available, true);
    assert.equal(publicApiTool.requiresApiKey, false);
    assert.deepEqual(publicApiTool.services, ["weather", "currency", "country", "wikipedia", "books", "github_repo"]);

    const response = await fetch(base + "/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "What's the weather in Agra today?" })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.match(body.content, /31\.2°C/);
    assert.ok(body.toolsUsed.some(item => item.name === "public_api_lookup" && item.ok));
    const result = body.toolResults.find(item => item.name === "public_api_lookup")?.result;
    assert.equal(result.location.name, "Agra");
    assert.equal(result.current.temperature_2m, 31.2);
    assert.equal(externalUrls.length, 2);
  });
});

test("agent public API routing does not turn API integration requests into weather calls", async () => {
  let externalCalls = 0;
  await withServer({ OPENROUTER_API_KEY: "test-only" }, async url => {
    if (String(url).startsWith("https://openrouter.ai/api/v1/chat/completions")) {
      externalCalls++;
      return jsonResponse({ choices: [{ message: { role: "assistant", content: "Weather APIs can be integrated, but no API lookup was needed." } }] });
    }
    throw new Error("unexpected public API call");
  }, async base => {
    const response = await fetch(base + "/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Integrate a weather API into ULTRON" })
    });
    assert.equal(response.status, 200);
    assert.equal(externalCalls, 1);
  });
});
