import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBuildYourOwnXGuidance,
  listBuildYourOwnXTopics
} from "../build-your-own-x.js";
import { buildTaskSkillsGuidance } from "../task-aware-skills.js";

test("catalog covers every named Build Your Own X category and its uncategorized index", () => {
  const topics = listBuildYourOwnXTopics();
  assert.equal(topics.length, 31);
  assert.equal(new Set(topics.map(topic => topic.id)).size, 31);
  assert.equal(topics.reduce((total, topic) => total + topic.tutorialCount, 0), 359);
  assert.ok(topics.some(topic => topic.id === "ai-model"));
  assert.ok(topics.some(topic => topic.id === "search-engine"));
  assert.ok(topics.some(topic => topic.id === "web-server"));
  assert.ok(topics.some(topic => topic.id === "uncategorized"));
  assert.ok(topics.every(topic => topic.sourceUrl.includes("aa17439b62f384511a5561ce308e9598b94d8989")));
  assert.ok(topics.every(topic => !("matches" in topic)), "Do not expose internal regexes in the public catalogue");
});

test("RAG and web API tasks select relevant first-principles references", () => {
  const result = buildBuildYourOwnXGuidance(
    "Build an RAG document search engine and expose results through an Express API endpoint with server-sent events"
  );
  const ids = result.matched.map(topic => topic.id);
  assert.ok(ids.includes("ai-model"));
  assert.ok(ids.includes("search-engine"));
  assert.ok(ids.includes("web-server"));
  assert.ok(result.rules.some(rule => rule.toLowerCase().includes("do not fetch and execute tutorial code")));
  assert.ok(result.matched.some(topic => topic.references.some(reference => reference.url.includes("rag-from-scratch"))));
});

test("desktop automation and command execution receive security-first guidance", () => {
  const result = buildBuildYourOwnXGuidance(
    "Implement Windows desktop automation with shell command execution and browser automation"
  );
  const ids = result.matched.map(topic => topic.id);
  assert.ok(ids.includes("operating-system"));
  assert.ok(ids.includes("shell"));
  assert.ok(ids.includes("web-browser"));
  assert.ok(result.rules.some(rule => rule.includes("permission-checked desktop bridge")));
  assert.ok(result.rules.some(rule => rule.includes("untrusted model output")));
});

test("ordinary conversation does not receive unrelated build-from-scratch references", () => {
  const result = buildBuildYourOwnXGuidance("Write a birthday message");
  assert.deepEqual(result.matched, []);
  assert.deepEqual(result.rules, []);
});

test("reference result limits are bounded and invalid input is handled", () => {
  assert.deepEqual(buildBuildYourOwnXGuidance(null).matched, []);
  const one = buildBuildYourOwnXGuidance(
    "Build a RAG document search engine with an Express API endpoint",
    { limit: 1 }
  );
  assert.equal(one.matched.length, 1);
  const capped = buildBuildYourOwnXGuidance(
    "Build an ULTRON AI agent with a RAG search engine, database, shell, browser automation, and a web server",
    { limit: 999 }
  );
  assert.ok(capped.matched.length <= 5);
});

test("task-aware skills inject relevant references into the existing runtime guidance", () => {
  const result = buildTaskSkillsGuidance(
    "Implement a RAG document search engine for ULTRON and expose it through an Express API endpoint with tests"
  );
  assert.ok(result.buildYourOwnX);
  assert.ok(result.buildYourOwnX.matched.some(topic => topic.id === "ai-model"));
  assert.ok(result.rules.some(rule => rule.includes("Build-your-own-X reference selected")));
  assert.ok(result.rules.some(rule => rule.includes("regression tests")));
});

test("task-aware skills keep build-your-own references task-matched", () => {
  const result = buildTaskSkillsGuidance("Write a birthday message");
  assert.deepEqual(result.buildYourOwnX.matched, []);
  assert.deepEqual(result.buildYourOwnX.rules, []);
});
