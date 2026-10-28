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
  assert.deepEqual(catalog.map(item => item.id), ["weather", "currency", "country", "wikipedia", "books", "github_repo", "sunrise_sunset", "ebooks", "trivia", "earthquakes", "dictionary", "news"]);
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

test("country data uses the no-key World Bank endpoint and reduces results to documented metadata", async () => {
  const result = await lookupPublicApi({ service: "country", query: "India" }, {
    fetchImpl: async url => {
      assert.equal(String(url), "https://api.worldbank.org/v2/country?format=json&per_page=400");
      return jsonResponse([{
        page: 1, pages: 1, per_page: "400", total: 1
      }, [{
        id: "IND", iso2Code: "IN", name: "India",
        region: { value: "South Asia" },
        incomeLevel: { value: "Lower middle income" },
        capitalCity: "New Delhi", latitude: "20.5937", longitude: "78.9629",
        privateMetadata: "never forwarded"
      }]]);
    }
  });
  assert.equal(result.results[0].name, "India");
  assert.equal(result.results[0].code, "IND");
  assert.equal(result.results[0].iso2Code, "IN");
  assert.equal(result.results[0].capital, "New Delhi");
  assert.equal(result.results[0].region, "South Asia");
  assert.equal(result.results[0].incomeLevel, "Lower middle income");
  assert.equal(result.results[0].latitude, 20.5937);
  assert.equal(Object.hasOwn(result.results[0], "privateMetadata"), false);
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


test("sunrise/sunset lookup uses geocoding plus the documented v2 solar endpoint", async () => {
  const calls = [];
  const result = await lookupPublicApi({ service: "sunrise_sunset", query: "Agra", date: "2026-10-29" }, {
    fetchImpl: async url => {
      calls.push(String(url));
      if (String(url).startsWith("https://geocoding-api.open-meteo.com/")) {
        return jsonResponse({ results: [{ name: "Agra", country: "India", admin1: "Uttar Pradesh", latitude: 27.1767, longitude: 78.0081 }] });
      }
      assert.match(String(url), /^https:\/\/api\.sunrise-sunset\.org\/v2\?/);
      assert.match(String(url), /date=2026-10-29/);
      return jsonResponse({ status: "OK", date: "2026-10-29", tzid: "Asia/Kolkata", sunrise: "2026-10-29T06:20:00+05:30", sunset: "2026-10-29T17:45:00+05:30", day_length: 41100, moon_phase: "Waxing Crescent" });
    }
  });
  assert.equal(calls.length, 2);
  assert.equal(result.location.name, "Agra");
  assert.match(result.sunrise, /06:20:00/);
  assert.equal(result.dayLengthSeconds, 41100);
  assert.equal(result.attribution, "Sun data by Sunrise-Sunset.org");
});

test("Gutendex search returns bounded ebook metadata and only trusted download hosts", async () => {
  const result = await lookupPublicApi({ service: "ebooks", query: "Frankenstein" }, {
    fetchImpl: async url => {
      assert.match(String(url), /^https:\/\/gutendex\.com\/books\/\?search=Frankenstein$/);
      return jsonResponse({ count: 1, results: [{
        id: 84, title: "Frankenstein; Or, The Modern Prometheus",
        authors: [{ name: "Mary Wollstonecraft Shelley", birth_year: 1797, death_year: 1851 }],
        languages: ["en"], subjects: ["Science fiction", "Gothic fiction"],
        download_count: 12345, copyright: false,
        formats: { "text/html": "https://www.gutenberg.org/ebooks/84.html.images", "application/zip": "https://bad.example/file.zip" }
      }] });
    }
  });
  assert.equal(result.results[0].title, "Frankenstein; Or, The Modern Prometheus");
  assert.equal(result.results[0].authors[0].name, "Mary Wollstonecraft Shelley");
  assert.equal(result.results[0].downloadUrl, "https://www.gutenberg.org/ebooks/84.html.images");
  assert.equal(result.results[0].copyright, false);
});

test("Open Trivia DB validates request bounds, decodes base64 text, and respects rate limits", async () => {
  const encode = value => Buffer.from(value, "utf8").toString("base64");
  let requestUrl = "";
  const result = await lookupPublicApi({ service: "trivia", amount: 2, categoryId: 18, difficulty: "easy" }, {
    fetchImpl: async url => {
      requestUrl = String(url);
      return jsonResponse({ response_code: 0, results: [{
        category: encode("Science: Computers"), type: "multiple", difficulty: "easy",
        question: encode("What does CPU stand for?"), correct_answer: encode("Central Processing Unit"),
        incorrect_answers: [encode("Computer Personal Unit"), encode("Central Program Utility")]
      }] });
    }
  });
  assert.match(requestUrl, /^https:\/\/opentdb\.com\/api\.php\?/);
  assert.match(requestUrl, /category=18/);
  assert.match(requestUrl, /difficulty=easy/);
  assert.equal(result.results[0].question, "What does CPU stand for?");
  assert.equal(result.results[0].correctAnswer, "Central Processing Unit");
  await assert.rejects(() => lookupPublicApi({ service: "trivia", amount: 50 }, {
    fetchImpl: async () => { throw new Error("must validate before networking"); }
  }), error => error.code === "PUBLIC_API_AMOUNT_INVALID");
  await assert.rejects(() => lookupPublicApi({ service: "trivia" }, {
    fetchImpl: async () => jsonResponse({ response_code: 5 })
  }), error => error.code === "PUBLIC_API_RATE_LIMITED");
});

test("USGS earthquake feed returns normalized recent events filtered by magnitude", async () => {
  const result = await lookupPublicApi({ service: "earthquakes", period: "day", minMagnitude: 4 }, {
    fetchImpl: async url => {
      assert.equal(String(url), "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson");
      return jsonResponse({ features: [
        { id: "event-1", properties: { mag: 4.8, place: "10 km NE of Sample Town", time: 1793250000000, updated: 1793250100000, url: "https://earthquake.usgs.gov/earthquakes/eventpage/event-1" }, geometry: { coordinates: [78.1, 27.2, 12.4] } },
        { id: "event-2", properties: { mag: 2.1, place: "Small tremor", time: 1793250000000 }, geometry: { coordinates: [1, 2, 3] } }
      ] });
    }
  });
  assert.equal(result.totalInFeed, 2);
  assert.equal(result.matchingEvents, 1);
  assert.equal(result.events[0].magnitude, 4.8);
  assert.equal(result.events[0].depthKm, 12.4);
  assert.match(result.events[0].url, /^https:\/\/earthquake\.usgs\.gov\//);
});

test("deterministic routing recognizes solar times, ebook search, trivia and earthquake requests", () => {
  assert.deepEqual(inferPublicApiRequest("When is sunrise in Agra tomorrow?"), { service: "sunrise_sunset", query: "Agra", date: "tomorrow" });
  const ebook = inferPublicApiRequest("Find ebooks about Frankenstein on Project Gutenberg");
  assert.equal(ebook.service, "ebooks");
  assert.match(ebook.query, /Frankenstein/i);
  assert.deepEqual(inferPublicApiRequest("Give me 5 easy science trivia questions"), { service: "trivia", amount: 5, categoryId: 17, difficulty: "easy" });
  assert.deepEqual(inferPublicApiRequest("Show earthquakes in the last hour above 4"), { service: "earthquakes", period: "hour", minMagnitude: 4 });
});


test("FreeDictionaryAPI lookup normalizes dictionary entries and attribution", async () => {
  const result = await lookupPublicApi({ service: "dictionary", query: "serendipity" }, {
    fetchImpl: async url => {
      assert.equal(String(url), "https://freedictionaryapi.com/api/v1/entries/en/serendipity");
      return jsonResponse({
        word: "serendipity",
        entries: [{
          language: { code: "en", name: "English" },
          partOfSpeech: "noun",
          pronunciations: [{ type: "ipa", text: "/ˌsɛr.ənˈdɪp.ə.ti/" }],
          senses: [{
            definition: "An unplanned fortunate discovery.",
            examples: ["They found it by serendipity."],
            synonyms: ["chance", "fortune"],
            antonyms: ["design"]
          }]
        }],
        source: { url: "https://en.wiktionary.org/wiki/serendipity", license: { name: "CC BY-SA 4.0" } }
      });
    }
  });
  assert.equal(result.word, "serendipity");
  assert.equal(result.entries[0].definitions[0].definition, "An unplanned fortunate discovery.");
  assert.equal(result.entries[0].synonyms[0], "chance");
  assert.equal(result.wiktionarySourceUrl, "https://en.wiktionary.org/wiki/serendipity");
  assert.equal(result.contentLicense, "CC BY-SA 4.0");
  await assert.rejects(() => lookupPublicApi({ service: "dictionary", query: "two words" }, {
    fetchImpl: async () => { throw new Error("must validate before networking"); }
  }), error => error.code === "PUBLIC_API_WORD_INVALID");
});

test("GDELT public news search normalizes articles and limits the requested timespan", async () => {
  let requested;
  const result = await lookupPublicApi({ service: "news", query: "AI safety", period: "week" }, {
    fetchImpl: async url => {
      requested = new URL(String(url));
      return jsonResponse({ articles: [
        { title: "AI safety research update", url: "https://news.example.org/article", domain: "news.example.org", language: "English", sourcecountry: "United States", seendate: "20261029T010000Z" },
        { title: "Unsafe scheme", url: "javascript:alert(1)", domain: "bad.example" }
      ] });
    }
  });
  assert.equal(requested.origin + requested.pathname, "https://api.gdeltproject.org/api/v2/doc/doc");
  assert.equal(requested.searchParams.get("query"), "AI safety");
  assert.equal(requested.searchParams.get("timespan"), "7d");
  assert.equal(requested.searchParams.get("mode"), "ArtList");
  assert.equal(result.articles.length, 1);
  assert.equal(result.articles[0].title, "AI safety research update");
  assert.equal(result.articles[0].url, "https://news.example.org/article");
});

test("deterministic routing recognizes dictionary and news lookup requests", () => {
  assert.deepEqual(inferPublicApiRequest("Define serendipity"), { service: "dictionary", query: "serendipity" });
  assert.deepEqual(inferPublicApiRequest("latest news about AI safety"), { service: "news", query: "AI safety", period: "day" });
});


test("FreeDictionaryAPI lookup normalizes definitions and Wiktionary attribution", async () => {
  const result = await lookupPublicApi({ service: "dictionary", query: "serendipity" }, {
    fetchImpl: async url => {
      assert.equal(String(url), "https://freedictionaryapi.com/api/v1/entries/en/serendipity");
      return jsonResponse({
        word: "serendipity",
        entries: [{
          language: { code: "en", name: "English" },
          partOfSpeech: "noun",
          pronunciations: [{ type: "ipa", text: "/ˌsɛr.ənˈdɪp.ə.ti/" }],
          senses: [{
            definition: "An unplanned fortunate discovery.",
            examples: ["They found it by serendipity."],
            synonyms: ["chance", "fortune"],
            antonyms: ["design"]
          }]
        }],
        source: { url: "https://en.wiktionary.org/wiki/serendipity", license: { name: "CC BY-SA 4.0" } }
      });
    }
  });
  assert.equal(result.word, "serendipity");
  assert.equal(result.entries[0].definitions[0].definition, "An unplanned fortunate discovery.");
  assert.equal(result.entries[0].synonyms[0], "chance");
  assert.equal(result.wiktionarySourceUrl, "https://en.wiktionary.org/wiki/serendipity");
  assert.equal(result.contentLicense, "CC BY-SA 4.0");
  await assert.rejects(() => lookupPublicApi({ service: "dictionary", query: "two words" }, {
    fetchImpl: async () => { throw new Error("must validate before networking"); }
  }), error => error.code === "PUBLIC_API_WORD_INVALID");
});

test("GDELT public news search normalizes articles and fixes the search endpoint", async () => {
  let requested;
  const result = await lookupPublicApi({ service: "news", query: "AI safety", period: "week" }, {
    fetchImpl: async url => {
      requested = new URL(String(url));
      return jsonResponse({ articles: [
        { title: "AI safety research update", url: "https://news.example.org/article", domain: "news.example.org", language: "English", sourcecountry: "United States", seendate: "20261029T010000Z" },
        { title: "Unsafe scheme", url: "javascript:alert(1)", domain: "bad.example" }
      ] });
    }
  });
  assert.equal(requested.origin + requested.pathname, "https://api.gdeltproject.org/api/v2/doc/doc");
  assert.equal(requested.searchParams.get("query"), "AI safety");
  assert.equal(requested.searchParams.get("timespan"), "7d");
  assert.equal(requested.searchParams.get("mode"), "ArtList");
  assert.equal(result.articles.length, 1);
  assert.equal(result.articles[0].title, "AI safety research update");
  assert.equal(result.articles[0].url, "https://news.example.org/article");
});

test("deterministic routing recognizes dictionary and news lookup prompts", () => {
  assert.deepEqual(inferPublicApiRequest("Define serendipity"), { service: "dictionary", query: "serendipity" });
  assert.deepEqual(inferPublicApiRequest("latest news about AI safety"), { service: "news", query: "AI safety", period: "day" });
});
