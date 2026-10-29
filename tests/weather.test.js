import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createAgentRouter, describeWmoWeatherCode } from "../agent-runtime.js";
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

const geocodingResponse = {
  results: [{
    name: "London",
    admin1: "England",
    country: "United Kingdom",
    country_code: "GB",
    latitude: 51.5072,
    longitude: -0.1276,
    timezone: "Europe/London"
  }]
};

const forecastResponse = {
  timezone: "Europe/London",
  current: {
    time: "2026-10-29T15:00",
    temperature_2m: 12.5,
    relative_humidity_2m: 72,
    apparent_temperature: 11.1,
    is_day: 1,
    precipitation: 0.1,
    rain: 0.1,
    showers: 0,
    snowfall: 0,
    weather_code: 3,
    cloud_cover: 88,
    wind_speed_10m: 14.2,
    wind_direction_10m: 240
  },
  current_units: {
    temperature_2m: "°C",
    relative_humidity_2m: "%",
    apparent_temperature: "°C",
    precipitation: "mm",
    rain: "mm",
    showers: "mm",
    snowfall: "cm",
    cloud_cover: "%",
    wind_speed_10m: "km/h",
    wind_direction_10m: "°"
  },
  daily: {
    time: ["2026-10-29", "2026-10-30", "2026-10-31"],
    weather_code: [3, 61, 0],
    temperature_2m_max: [14.2, 13.0, 15.1],
    temperature_2m_min: [8.1, 7.0, 9.2],
    sunrise: ["2026-10-29T07:45", "2026-10-30T07:47", "2026-10-31T07:49"],
    sunset: ["2026-10-29T17:42", "2026-10-30T17:40", "2026-10-31T17:38"]
  },
  daily_units: {
    temperature_2m_max: "°C",
    temperature_2m_min: "°C"
  }
};

test("WMO weather-code descriptions are stable and unknown values are not fabricated", () => {
  assert.equal(describeWmoWeatherCode(0), "Clear sky");
  assert.equal(describeWmoWeatherCode(3), "Overcast");
  assert.equal(describeWmoWeatherCode(95), "Thunderstorm");
  assert.equal(describeWmoWeatherCode(12345), "Unknown conditions");
  assert.equal(describeWmoWeatherCode(null), "Unknown conditions");
});

test("task router narrows explicit city-weather requests to the weather tool", () => {
  const route = classifyTaskRoute("What is the weather in London today?");
  assert.equal(route.tier, "medium");
  assert.deepEqual(route.categories, ["weather"]);
  assert.equal(route.filtered, true);
  assert.deepEqual(route.toolNames, ["weather_lookup"]);
});

test("weather tool returns sourced current conditions and a short forecast", async () => {
  let providerCalls = 0;
  let geocodingCalls = 0;
  let forecastCalls = 0;
  let firstToolSchema;
  const env = { OPENROUTER_API_KEY: "weather-test-provider-key" };

  await withAgentServer(env, async (url, options) => {
    if (url.startsWith("https://geocoding-api.open-meteo.com/v1/search?")) {
      geocodingCalls += 1;
      const parsed = new URL(url);
      assert.equal(parsed.searchParams.get("name"), "London");
      assert.equal(parsed.searchParams.get("count"), "5");
      assert.equal(parsed.searchParams.get("language"), "en");
      assert.equal(options.redirect, "error");
      assert.ok(options.signal);
      return new Response(JSON.stringify(geocodingResponse), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.startsWith("https://api.open-meteo.com/v1/forecast?")) {
      forecastCalls += 1;
      const parsed = new URL(url);
      assert.equal(parsed.searchParams.get("latitude"), "51.5072");
      assert.equal(parsed.searchParams.get("longitude"), "-0.1276");
      assert.equal(parsed.searchParams.get("timezone"), "auto");
      assert.equal(parsed.searchParams.get("forecast_days"), "3");
      assert.equal(options.redirect, "error");
      return new Response(JSON.stringify(forecastResponse), { status: 200, headers: { "content-type": "application/json" } });
    }

    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    providerCalls += 1;
    const payload = JSON.parse(options.body);
    if (!firstToolSchema) firstToolSchema = payload.tools.map(tool => tool.function.name);
    const hasWeatherResult = payload.messages.some(message => message.role === "tool" && message.content.includes("open-meteo"));
    if (hasWeatherResult) {
      return new Response(JSON.stringify({
        choices: [{ message: { role: "assistant", content: "The latest mocked Open-Meteo result for London is overcast at 12.5 degrees Celsius." } }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: null,
          tool_calls: [{
            id: "weather-call-1",
            type: "function",
            function: { name: "weather_lookup", arguments: JSON.stringify({ location: "London" }) }
          }]
        }
      }]
    }), { status: 200, headers: { "content-type": "application/json" } });
  }, async base => {
    const response = await fetch(base + "/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "What is the weather in London today?" })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.match(body.content, /overcast at 12.5 degrees Celsius/i);
    assert.deepEqual(firstToolSchema, ["weather_lookup"]);
    assert.deepEqual(body.routing.categories, ["weather"]);
    assert.deepEqual(body.toolsUsed.map(item => item.name), ["weather_lookup"]);
    assert.equal(body.toolsUsed[0].ok, true);
    const result = body.toolResults[0].result;
    assert.equal(result.state, "completed");
    assert.equal(result.provider, "open-meteo");
    assert.equal(result.location.country, "United Kingdom");
    assert.equal(result.current.temperature, 12.5);
    assert.equal(result.current.condition, "Overcast");
    assert.equal(result.current.units.temperature_2m, "°C");
    assert.equal(result.dailyForecast.length, 3);
    assert.equal(result.dailyForecast[1].condition, "Slight rain");
    assert.match(result.attribution, /Open-Meteo/);
    assert.equal(result.sourceContentTrust, "untrusted_external_weather_data");
  });

  assert.equal(providerCalls, 2);
  assert.equal(geocodingCalls, 1);
  assert.equal(forecastCalls, 1);
});

test("weather tool returns candidates instead of guessing an ambiguous location", async () => {
  let providerCalls = 0;
  let geocodingCalls = 0;
  let forecastCalls = 0;
  const env = { OPENROUTER_API_KEY: "weather-ambiguity-test-key" };

  await withAgentServer(env, async (url, options) => {
    if (url.startsWith("https://geocoding-api.open-meteo.com/v1/search?")) {
      geocodingCalls += 1;
      return new Response(JSON.stringify({
        results: [
          { name: "Springfield", admin1: "Illinois", country: "United States", country_code: "US", latitude: 39.78, longitude: -89.64, timezone: "America/Chicago" },
          { name: "Springfield", admin1: "Massachusetts", country: "United States", country_code: "US", latitude: 42.10, longitude: -72.59, timezone: "America/New_York" }
        ]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.startsWith("https://api.open-meteo.com/v1/forecast?")) {
      forecastCalls += 1;
      throw new Error("Forecast should not run for an ambiguous location");
    }

    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    providerCalls += 1;
    const payload = JSON.parse(options.body);
    const hasAmbiguousResult = payload.messages.some(message => message.role === "tool" && message.content.includes('"ambiguous"'));
    if (hasAmbiguousResult) {
      return new Response(JSON.stringify({
        choices: [{ message: { role: "assistant", content: "I found multiple Springfields. Which state should I use?" } }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: null,
          tool_calls: [{
            id: "weather-call-ambiguous",
            type: "function",
            function: { name: "weather_lookup", arguments: JSON.stringify({ location: "Springfield" }) }
          }]
        }
      }]
    }), { status: 200, headers: { "content-type": "application/json" } });
  }, async base => {
    const response = await fetch(base + "/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "What is the weather in Springfield?" })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.match(body.content, /multiple Springfields/i);
    assert.equal(body.toolResults[0].result.state, "ambiguous");
    assert.equal(body.toolResults[0].result.candidates.length, 2);
  });

  assert.equal(providerCalls, 2);
  assert.equal(geocodingCalls, 1);
  assert.equal(forecastCalls, 0);
});
