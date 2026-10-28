import test from "node:test";
import assert from "node:assert/strict";
import { getFreePublicData } from "../integrations/free-public-data.js";
import { buildIntegrationCatalog } from "../integrations/catalog.js";

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

test("weather lookup uses keyless Open-Meteo endpoints and returns attribution", async () => {
  const calls = [];
  const result = await getFreePublicData({ kind: "weather", location: "Agra" }, {
    fetchImpl: async (url, options) => {
      calls.push({ url: new URL(url), options });
      assert.equal(options.method, "GET");
      assert.equal(options.redirect, "error");
      assert.ok(options.signal);
      assert.equal(options.headers.Authorization, undefined);
      if (new URL(url).hostname === "geocoding-api.open-meteo.com") {
        return jsonResponse({ results: [{ name: "Agra", admin1: "Uttar Pradesh", country: "India", latitude: 27.1767, longitude: 78.0081, timezone: "Asia/Kolkata" }] });
      }
      return jsonResponse({
        timezone: "Asia/Kolkata",
        current: { time: "2026-10-29T10:00", temperature_2m: 30.4, apparent_temperature: 32.1, relative_humidity_2m: 41, precipitation: 0, wind_speed_10m: 9.8, weather_code: 1, is_day: 1 }
      });
    }
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url.searchParams.get("name"), "Agra");
  assert.equal(calls[0].url.searchParams.get("count"), "1");
  assert.equal(calls[1].url.hostname, "api.open-meteo.com");
  assert.equal(result.location.name, "Agra");
  assert.equal(result.current.temperatureC, 30.4);
  assert.equal(result.current.conditions, "Mainly clear");
  assert.equal(result.current.isDay, true);
  assert.match(result.attribution, /Open-Meteo.com/);
  assert.match(result.usageNotice, /non-commercial/);
});

test("weather lookup stops when geocoding cannot find the place", async () => {
  let calls = 0;
  await assert.rejects(
    () => getFreePublicData({ kind: "weather", location: "UnknownPlaceTest" }, {
      fetchImpl: async () => { calls += 1; return jsonResponse({ results: [] }); }
    }),
    error => error.code === "FREE_PUBLIC_WEATHER_LOCATION_NOT_FOUND" && error.status === 404
  );
  assert.equal(calls, 1);
});

test("currency conversion uses Frankfurter daily rate and clearly labels its date/type", async () => {
  let request;
  const result = await getFreePublicData({ kind: "currency", amount: 10, from: "usd", to: "inr" }, {
    fetchImpl: async (url, options) => {
      request = { url: new URL(url), options };
      return jsonResponse([{ date: "2026-10-28", base: "USD", quote: "INR", rate: 88.1 }]);
    }
  });
  assert.equal(request.url.origin, "https://api.frankfurter.dev");
  assert.equal(request.url.pathname, "/v2/rates");
  assert.equal(request.url.searchParams.get("base"), "USD");
  assert.equal(request.url.searchParams.get("quotes"), "INR");
  assert.equal(request.options.headers.Authorization, undefined);
  assert.equal(result.from, "USD");
  assert.equal(result.to, "INR");
  assert.equal(result.rate, 88.1);
  assert.equal(result.convertedAmount, 881);
  assert.equal(result.rateDate, "2026-10-28");
  assert.match(result.rateType, /not a real-time trading quote/);
});

test("same-currency conversion is local and makes no request", async () => {
  let calls = 0;
  const result = await getFreePublicData({ kind: "currency", amount: 12.5, from: "INR", to: "INR" }, {
    fetchImpl: async () => { calls += 1; throw new Error("must not call network"); }
  });
  assert.equal(result.rate, 1);
  assert.equal(result.convertedAmount, 12.5);
  assert.equal(result.source, "ULTRON local calculation");
  assert.equal(calls, 0);
});

test("invalid requests fail before making network calls", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return jsonResponse({}); };
  await assert.rejects(() => getFreePublicData({ kind: "weather", location: "x" }, { fetchImpl }), { code: "FREE_PUBLIC_WEATHER_LOCATION_REQUIRED" });
  await assert.rejects(() => getFreePublicData({ kind: "currency", amount: -1, from: "USD", to: "INR" }, { fetchImpl }), { code: "FREE_PUBLIC_CURRENCY_AMOUNT_INVALID" });
  await assert.rejects(() => getFreePublicData({ kind: "currency", amount: 1, from: "USDT", to: "INR" }, { fetchImpl }), { code: "FREE_PUBLIC_CURRENCY_CODES_INVALID" });
  await assert.rejects(() => getFreePublicData({ kind: "other" }, { fetchImpl }), { code: "FREE_PUBLIC_DATA_KIND_INVALID" });
  assert.equal(calls, 0);
});

test("integration catalog marks keyless providers available without required secrets", () => {
  const item = buildIntegrationCatalog({}).find(entry => entry.id === "free-public-data");
  assert.ok(item);
  assert.equal(item.configured, true);
  assert.deepEqual(item.requiredEnv, []);
  assert.match(item.note, /No API keys are required/);
});


test("dictionary lookup uses a fixed no-key endpoint and returns bounded definitions", async () => {
  let request;
  const result = await getFreePublicData({ kind: "dictionary", word: "serendipity" }, {
    fetchImpl: async (url, options) => {
      request = { url: new URL(url), options };
      return jsonResponse([{
        word: "serendipity",
        phonetic: "ˌser.ənˈdɪp.ə.ti",
        meanings: [{
          partOfSpeech: "noun",
          definitions: [{
            definition: "The occurrence and development of events by chance in a happy or beneficial way.",
            example: "A fortunate discovery by serendipity.",
            synonyms: ["chance"],
            antonyms: []
          }]
        }]
      }]);
    }
  });
  assert.equal(request.url.origin, "https://api.dictionaryapi.dev");
  assert.equal(request.url.pathname, "/api/v2/entries/en/serendipity");
  assert.equal(request.options.headers.Authorization, undefined);
  assert.equal(result.kind, "dictionary");
  assert.equal(result.entries[0].word, "serendipity");
  assert.equal(result.entries[0].meanings[0].definitions[0].synonyms[0], "chance");
  assert.equal(result.trust, "untrusted_external_data");
});

test("public holiday lookup uses fixed Nager.Date endpoint and normalizes common country names", async () => {
  let request;
  const result = await getFreePublicData({ kind: "public_holidays", countryCode: "India", year: 2026 }, {
    fetchImpl: async (url, options) => {
      request = { url: new URL(url), options };
      return jsonResponse([{
        date: "2026-01-26",
        localName: "गणतंत्र दिवस",
        name: "Republic Day",
        countryCode: "IN",
        global: true,
        fixed: true,
        counties: null,
        types: ["Public"]
      }]);
    }
  });
  assert.equal(request.url.origin, "https://date.nager.at");
  assert.equal(request.url.pathname, "/api/v3/PublicHolidays/2026/IN");
  assert.equal(request.options.headers.Authorization, undefined);
  assert.equal(result.kind, "public_holidays");
  assert.equal(result.countryCode, "IN");
  assert.equal(result.holidays[0].name, "Republic Day");
  assert.equal(result.holidays[0].global, true);
  assert.equal(result.trust, "untrusted_external_data");
});

test("dictionary and holiday input validation rejects invalid values before network access", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return jsonResponse([]); };
  await assert.rejects(() => getFreePublicData({ kind: "dictionary", word: "../../bad" }, { fetchImpl }), { code: "FREE_PUBLIC_DICTIONARY_INPUT_INVALID" });
  await assert.rejects(() => getFreePublicData({ kind: "public_holidays", countryCode: "India", year: 2200 }, { fetchImpl }), { code: "FREE_PUBLIC_HOLIDAY_YEAR_INVALID" });
  await assert.rejects(() => getFreePublicData({ kind: "public_holidays", countryCode: "Atlantis", year: 2026 }, { fetchImpl }), { code: "FREE_PUBLIC_HOLIDAY_COUNTRY_INVALID" });
  assert.equal(calls, 0);
});
