import test from "node:test";
import assert from "node:assert/strict";
import { getPublicApiDirectoryStats, inferPublicApiCatalogQuery, searchPublicApiDirectory } from "../integrations/public-api-directory.js";

test("bundled API directory retains thousands of upstream listings and provenance", () => {
  const stats = getPublicApiDirectoryStats();
  assert.ok(stats.entries >= 2000);
  assert.ok(stats.categories >= 50);
  assert.equal(stats.source.repository, "public-apis/public-apis");
  assert.equal(stats.source.license, "MIT");
  assert.ok(stats.authCounts.no_auth > 0);
  assert.ok(stats.authCounts.requires_auth_or_provider_setup > 0);
});

test("catalog search returns relevant metadata without claiming a listing is a live integration", () => {
  const result = searchPublicApiDirectory({ query: "geocoding", limit: 8 });
  assert.equal(result.results.length > 0, true);
  assert.equal(result.totalMatches > 0, true);
  assert.ok(result.results.some(item => /geocod/i.test(item.name + " " + item.description + " " + item.category)));
  assert.ok(result.results.every(item => /^https?:\/\//i.test(item.url)));
  assert.match(result.notice, /not verified live integrations/i);
  assert.equal(JSON.stringify(result).includes("OPENROUTER_API_KEY="), false);
});

test("catalog search supports category and explicit no-auth filters", () => {
  const result = searchPublicApiDirectory({ query: "weather", category: "Weather", authFilter: "no_auth", limit: 12 });
  assert.ok(result.results.length > 0);
  assert.ok(result.results.every(item => item.authStatus === "no_auth"));
  assert.ok(result.results.every(item => /weather/i.test(item.category)));
});

test("directory intent recognizes catalog discovery without confusing normal weather lookups", () => {
  assert.deepEqual(inferPublicApiCatalogQuery("Find public APIs for geocoding"), { query: "geocoding" });
  assert.deepEqual(inferPublicApiCatalogQuery("Search the API catalog for currency exchange"), { query: "currency exchange" });
  assert.deepEqual(inferPublicApiCatalogQuery("Show the public API catalog"), { query: "" });
  assert.equal(inferPublicApiCatalogQuery("Integrate a weather API into ULTRON"), null);
  assert.equal(inferPublicApiCatalogQuery("What's the weather in Agra today?"), null);
});
