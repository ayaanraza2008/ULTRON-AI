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

test("agent exposes and executes the fixed public API lookup tool for an earthquake request", async () => {
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
      return jsonResponse({ choices: [{ message: { role: "assistant", content: "USGS lists a magnitude 4.8 earthquake. Preliminary earthquake feed data can be revised." } }] });
    }
    externalUrls.push(String(url));
    if (String(url) === "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson") {
      return jsonResponse({ features: [
        { id: "event-1", properties: { mag: 4.8, place: "10 km NE of Sample Town", time: 1793250000000, url: "https://earthquake.usgs.gov/earthquakes/eventpage/event-1" }, geometry: { coordinates: [78.1, 27.2, 12.4] } }
      ] });
    }
    throw new Error("Unexpected external URL: " + url);
  }, async base => {
    const toolsResponse = await fetch(base + "/api/agent/tools");
    assert.equal(toolsResponse.status, 200);
    const toolsBody = await toolsResponse.json();
    const publicApiTool = toolsBody.tools.find(tool => tool.name === "public_api_lookup");
    assert.equal(publicApiTool.available, true);
    assert.equal(publicApiTool.requiresApiKey, false);
    assert.deepEqual(publicApiTool.services, ["weather", "currency", "country", "wikipedia", "books", "github_repo", "sunrise_sunset", "ebooks", "trivia", "earthquakes", "dictionary", "news"]);

    const response = await fetch(base + "/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Latest earthquakes for the last hour above magnitude 4" })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.match(body.content, /magnitude 4\.8 earthquake/i);
    assert.ok(body.toolsUsed.some(item => item.name === "public_api_lookup" && item.ok));
    const result = body.toolResults.find(item => item.name === "public_api_lookup")?.result;
    assert.equal(result.events[0].magnitude, 4.8);
    assert.equal(result.matchingEvents, 1);
    assert.equal(externalUrls.length, 1);
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


test("agent can search the bundled public API directory without network calls to catalog providers", async () => {
  let modelCalls = 0;
  await withServer({ OPENROUTER_API_KEY: "test-only" }, async (url, options) => {
    if (!String(url).startsWith("https://openrouter.ai/api/v1/chat/completions")) {
      throw new Error("Catalog search must not call a catalog endpoint: " + url);
    }
    modelCalls++;
    const body = JSON.parse(options.body);
    assert.ok(body.tools.some(tool => tool.function?.name === "search_public_api_catalog"));
    if (modelCalls === 1) return jsonResponse({ choices: [{ message: { role: "assistant", content: "I'll search the catalog." } }] });
    return jsonResponse({ choices: [{ message: { role: "assistant", content: "I found public API listings for geocoding. These are discovery results, not live integrations." } }] });
  }, async base => {
    const toolResponse = await fetch(base + "/api/agent/tools");
    assert.equal(toolResponse.status, 200);
    const toolBody = await toolResponse.json();
    const directoryTool = toolBody.tools.find(tool => tool.name === "search_public_api_catalog");
    assert.equal(directoryTool.available, true);
    assert.ok(directoryTool.entries >= 2000);
    assert.ok(directoryTool.categories >= 50);

    const response = await fetch(base + "/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Find public APIs for geocoding" })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(body.toolsUsed.some(item => item.name === "search_public_api_catalog" && item.ok));
    const result = body.toolResults.find(item => item.name === "search_public_api_catalog")?.result;
    assert.ok(result.totalMatches > 0);
    assert.ok(result.results.some(item => /geocod/i.test(item.name + " " + item.description + " " + item.category)));
    assert.match(result.notice, /not verified live integrations/i);
  });
});
