import test from "node:test";
import assert from "node:assert/strict";
import { getStrataReadiness, resolveStrataProvider } from "../integrations/strata.js";

test("Strata is optional and never downloads model weights", () => {
  const readiness = getStrataReadiness({});
  assert.equal(readiness.configured, false);
  assert.equal(readiness.state, "optional");
  assert.match(readiness.note, /does not install Strata or download model weights/i);
  assert.equal(resolveStrataProvider({}), null);
});

test("Strata accepts an explicitly configured local loopback API without a key", () => {
  const env = { STRATA_BASE_URL: "http://127.0.0.1:8080/v1", STRATA_MODEL: "local-model" };
  const readiness = getStrataReadiness(env);
  assert.equal(readiness.configured, true);
  assert.equal(readiness.state, "configured_unverified");
  assert.equal(JSON.stringify(readiness).includes("secret"), false);
  assert.deepEqual(resolveStrataProvider(env), {
    name: "strata",
    baseUrl: "http://127.0.0.1:8080/v1",
    apiKey: "",
    model: "local-model",
    priority: -10,
    supportsTools: false,
    supportsVision: false,
    local: true
  });
});

test("Strata requires HTTPS and a server-only key for remote endpoints", () => {
  assert.equal(getStrataReadiness({ STRATA_BASE_URL: "https://strata.example.com/v1", STRATA_MODEL: "model" }).state, "blocked");
  assert.equal(getStrataReadiness({
    STRATA_BASE_URL: "https://strata.example.com/v1",
    STRATA_MODEL: "model",
    STRATA_API_KEY: "server-only-test-secret"
  }).state, "configured_unverified");
  assert.equal(getStrataReadiness({
    STRATA_BASE_URL: "http://strata.example.com/v1",
    STRATA_MODEL: "model",
    STRATA_API_KEY: "server-only-test-secret"
  }).state, "blocked");
});

test("Strata rejects unsafe endpoint URLs and does not enable tool use by default", () => {
  for (const STRATA_BASE_URL of [
    "http://192.168.1.2:8080/v1",
    "https://user:pass@strata.example.com/v1",
    "https://strata.example.com/v1?token=secret"
  ]) {
    assert.equal(getStrataReadiness({ STRATA_BASE_URL, STRATA_MODEL: "model", STRATA_API_KEY: "secret" }).state, "blocked");
  }
  assert.equal(getStrataReadiness({
    STRATA_BASE_URL: "https://strata.example.com/v1",
    STRATA_MODEL: "model",
    STRATA_API_KEY: "secret"
  }).supportsTools, false);
});
