import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createAgentRouter } from "../agent-runtime.js";

test("agent may fetch public weather while consequential follow-up remains approval-gated", async t => {
  const providerCalls = [];
  const publicApiCalls = [];
  const app = express();
  app.use(express.json({ limit: "12mb" }));
  app.use("/api", createAgentRouter({
    env: { OPENROUTER_API_KEY: "synthetic-test-key", OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1", OPENROUTER_DEFAULT_MODEL: "openrouter/free" },
    requireSupabaseUser: (req, _res, next) => {
      req.supabaseUser = { id: "00000000-0000-4000-8000-000000000001" };
      next();
    },
    fetchImpl: async (url, options = {}) => {
      if (String(url).includes("/chat/completions")) {
        providerCalls.push(JSON.parse(options.body));
        if (providerCalls.length === 1) {
          return new Response(JSON.stringify({
            model: "test-model",
            choices: [{ message: { role: "assistant", content: null, tool_calls: [{
              id: "weather-tool-call", type: "function",
              function: { name: "get_free_public_data", arguments: JSON.stringify({ kind: "weather", location: "Agra" }) }
            }, {
              id: "email-tool-call", type: "function",
              function: { name: "browser_use", arguments: JSON.stringify({ task: "Send an email to a colleague with the weather report", maxSteps: 3 }) }
            }] } }]
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        return new Response(JSON.stringify({
          model: "test-model",
          choices: [{ message: { role: "assistant", content: "Current weather for Agra: mainly clear, 30.4 °C. Weather data by Open-Meteo.com. I did not send the email because approval is required." } }]
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      const parsed = new URL(url);
      publicApiCalls.push({ url: parsed, options });
      assert.equal(options.headers.Authorization, undefined);
      if (parsed.hostname === "geocoding-api.open-meteo.com") {
        return new Response(JSON.stringify({ results: [{ name: "Agra", admin1: "Uttar Pradesh", country: "India", latitude: 27.1767, longitude: 78.0081 }] }), { status: 200 });
      }
      if (parsed.hostname === "api.open-meteo.com") {
        return new Response(JSON.stringify({
          timezone: "Asia/Kolkata",
          current: { time: "2026-10-29T10:00", temperature_2m: 30.4, apparent_temperature: 32.1, relative_humidity_2m: 41, precipitation: 0, wind_speed_10m: 9.8, weather_code: 1, is_day: 1 }
        }), { status: 200 });
      }
      throw new Error("Unexpected upstream URL: " + parsed.hostname);
    },
    logger: { warn() {}, error() {}, info() {} }
  }));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  t.after(() => new Promise(resolve => server.close(() => resolve())));

  const response = await fetch("http://127.0.0.1:" + server.address().port + "/api/agent/run", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: "What is the weather in Agra, then email this result to a colleague?" })
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.match(body.content, /weather for Agra/i);
  assert.ok(body.toolsUsed.some(item => item.name === "get_free_public_data" && item.ok));
  const result = body.toolResults.find(item => item.name === "get_free_public_data")?.result;
  assert.equal(result.kind, "weather");
  assert.equal(result.current.temperatureC, 30.4);
  assert.match(result.attribution, /Open-Meteo/);
  const browserResult = body.toolResults.find(item => item.name === "browser_use");
  assert.ok(browserResult);
  assert.equal(browserResult.ok, false);
  assert.equal(browserResult.result.approvalRequired, true);
  assert.equal(browserResult.result.risk.level, "external_effect");
  assert.equal(providerCalls.length, 2);
  assert.equal(publicApiCalls.length, 2);
  assert.ok(publicApiCalls.every(call => call.options.redirect === "error"));
});
