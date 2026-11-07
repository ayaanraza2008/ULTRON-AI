import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = resolve(root, "rea-gateway/targets/demo-app/index.js");

test("REA readiness target contains inert JavaScript source for static analysis", async () => {
  const source = await readFile(fixture, "utf8");
  assert.match(source, /export const SEARCH_RESULTS_FEATURE\s*=\s*["']search results["']/);
  assert.match(source, /export function searchCatalog\s*\(/);
  assert.match(source, /export function renderSearchResults\s*\(/);
  assert.doesNotMatch(source, /\b(?:fetch|https?:\/\/|child_process|spawn|exec)\b/);
});
