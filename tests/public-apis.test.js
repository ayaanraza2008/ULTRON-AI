import test from "node:test";
import assert from "node:assert/strict";
import { getPublicApiCatalog, inferPublicApiRequest, lookupPublicApi } from "../integrations/public-apis.js";

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

test("catalog contains useful keyless public-data services and never requires secret values", () => {
  const catalog = getPublicApiCatalog();
  assert.deepEqual(catalog.map(item => item.id), ["weather", "currency", "country", "wikipedia", "books", "github_repo"]);
  assert.ok(catalog.every(item => item.requiresApiKey === false));
  assert.ok(catalog.every(item => Array.isArray(item.capabilities) && item.capabilities.length > 0));
  assert.equal(JSON.stringify(catalog).includes("API_KEY="), false);
});

test("weather lookup geocodes a place and calls only fixed Open-Meteo endpoints", async () => {
  const calls = [];
  const result = await lookupPublicApi({ service: "weather", query: "Agra" }, {
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      if (String(url).startsWith("https://geocoding-api.open-meteo.com/")) {
        return jsonResponse({ results: [{ name: "Agra", country: "India", admin1: "Uttar Pradesh", latitude: 27.1767, longitude: 78.0081 }] });
      }
      assert.equal(String(url).startsWith("https://api.open-meteo.com/v1/forecast?"), true);
      return jsonResponse({ timezone: "Asia/Kolkata", current: { temperature_2m: 31.2, time: "2026-10-29T12:00" }, current_units: { temperature_2m: "°C" } });
    }
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[0].options.headers["User-Agent"].startsWith("ULTRON-AI/"), true);
  assert.equal(result.location.name, "Agra");
  assert.equal(result.location.country, "India");
  assert.equal(result.current.temperature_2m, 31.2);
  assert.equal(result.provider, "Open-Meteo");
});

test("currency lookup validates ISO-style codes and calculates a bounded conversion", async () => {
  let requestedUrl = "";
  const result = await lookupPublicApi({ service: "currency", baseCurrency: "usd", quoteCurrency: "INR", amount: 50 }, {
    fetchImpl: async url => {
      requestedUrl = String(url);
      return jsonResponse({ date: "2026-10-28", base: "USD", quote: "INR", rate: 88.5 });
    }
  });
  assert.equal(requestedUrl, "https://api.frankfurter.dev/v2/rate/USD/INR");
  assert.equal(result.convertedAmount, 4425);
  assert.equal(result.date, "2026-10-28");
  await assert.rejects(() => lookupPublicApi({ service: "currency", baseCurrency: "US", quoteCurrency: "INR" }, {
    fetchImpl: async () => { throw new Error("must not call upstream for invalid codes"); }
  }), error => error.code === "PUBLIC_API_CURRENCY_REQUIRED");
});

test("country data returns a reduced result rather than passing the entire upstream payload through", async () => {
  const result = await lookupPublicApi({ service: "country", query: "India" }, {
    fetchImpl: async url => {
      assert.match(String(url), /^https:\/\/restcountries\.com\/v3\.1\/name\/India\?/);
      return jsonResponse([{
        name: { common: "India", official: "Republic of India" },
        cca2: "IN", capital: ["New Delhi"], region: "Asia", population: 1000,
        currencies: { INR: { name: "Indian rupee", symbol: "₹" } },
        languages: { hin: "Hindi", eng: "English" }, timezones: ["UTC+05:30"],
        flags: { svg: "https://example.com/flag.svg" }, privateMetadata: "never forwarded"
      }]);
    }
  });
  assert.equal(result.results[0].name, "India");
  assert.deepEqual(result.results[0].languages, ["Hindi", "English"]);
  assert.equal(Object.hasOwn(result.results[0], "privateMetadata"), false);
  assert.equal(result.results[0].flag, "https://example.com/flag.svg");
});

test("Wikipedia, Open Library, and GitHub repository lookups normalize responses", async () => {
  const wiki = await lookupPublicApi({ service: "wikipedia", query: "Open source software" }, {
    fetchImpl: async url => {
      assert.match(String(url), /^https:\/\/en\.wikipedia\.org\/api\/rest_v1\/page\/summary\//);
      return jsonResponse({ title: "Open-source software", extract: "An example summary", content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Open-source_software" } } });
    }
  });
  assert.match(wiki.url, /^https:\/\/en\.wikipedia\.org\//);
  assert.equal(wiki.summary, "An example summary");

  const books = await lookupPublicApi({ service: "books", query: "Quantum Physics" }, {
    fetchImpl: async url => {
      assert.match(String(url), /^https:\/\/openlibrary\.org\/search\.json\?/);
      return jsonResponse({ docs: [{ title: "Quantum Physics", author_name: ["A. Author"], first_publish_year: 2020, edition_count: 2, key: "/works/OL123W", cover_i: 123 }] });
    }
  });
  assert.equal(books.results[0].url, "https://openlibrary.org/works/OL123W");
  assert.equal(books.results[0].coverUrl, "https://covers.openlibrary.org/b/id/123-M.jpg");

  const repo = await lookupPublicApi({ service: "github_repo", query: "openai/openai" }, {
    fetchImpl: async url => {
      assert.equal(String(url), "https://api.github.com/repos/openai/openai");
      return jsonResponse({ full_name: "openai/openai", html_url: "https://github.com/openai/openai", stargazers_count: 12, forks_count: 3, license: { spdx_id: "MIT" } });
    }
  });
  assert.equal(repo.repository, "openai/openai");
  assert.equal(repo.stars, 12);
  assert.equal(repo.license, "MIT");
});

test("unsupported services, arbitrary URLs, malformed inputs, and oversized provider responses fail closed", async () => {
  let calls = 0;
  const noNetwork = async () => { calls++; throw new Error("should not be called"); };
  await assert.rejects(() => lookupPublicApi({ service: "custom", url: "http://127.0.0.1/admin" }, { fetchImpl: noNetwork }), error => error.code === "PUBLIC_API_SERVICE_UNSUPPORTED");
  await assert.rejects(() => lookupPublicApi({ service: "github_repo", query: "https://example.com" }, { fetchImpl: noNetwork }), error => error.code === "PUBLIC_API_QUERY_INVALID");
  await assert.rejects(() => lookupPublicApi({ service: "weather", query: "" }, { fetchImpl: noNetwork }), error => error.code === "PUBLIC_API_QUERY_REQUIRED");
  assert.equal(calls, 0);

  const oversized = new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(512 * 1024 + 2)); controller.close(); }
  }), { status: 200 });
  await assert.rejects(() => lookupPublicApi({ service: "currency", baseCurrency: "USD", quoteCurrency: "INR" }, {
    fetchImpl: async () => oversized
  }), error => error.code === "PUBLIC_API_RESPONSE_TOO_LARGE");
});

test("deterministic routing recognizes common weather, exchange-rate, country, book, wiki and GitHub prompts", () => {
  assert.deepEqual(inferPublicApiRequest("What's the weather in Agra today?"), { service: "weather", query: "Agra" });
  assert.deepEqual(inferPublicApiRequest("Convert 50 USD to INR"), { service: "currency", baseCurrency: "USD", quoteCurrency: "INR", amount: 50 });
  assert.deepEqual(inferPublicApiRequest("capital of Japan"), { service: "country", query: "Japan" });
  assert.deepEqual(inferPublicApiRequest("Wikipedia summary: Ada Lovelace"), { service: "wikipedia", query: "Ada Lovelace" });
  assert.deepEqual(inferPublicApiRequest("find books about quantum physics"), { service: "books", query: "quantum physics" });
  assert.deepEqual(inferPublicApiRequest("check github repo openai/openai"), { service: "github_repo", query: "openai/openai" });
  assert.equal(inferPublicApiRequest("Integrate a weather API into ULTRON"), null);
});
