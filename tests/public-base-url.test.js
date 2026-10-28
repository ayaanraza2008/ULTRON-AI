import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PUBLIC_BASE_URL, getPublicBaseUrl } from "../public-base-url.js";

test("defaults provider attribution to the ULTRON Core public origin", () => {
  assert.equal(getPublicBaseUrl({}), DEFAULT_PUBLIC_BASE_URL);
});

test("uses a configured public HTTPS origin without paths", () => {
  assert.equal(
    getPublicBaseUrl({ ULTRON_PUBLIC_BASE_URL: "https://ultron.example.com/service/path" }),
    "https://ultron.example.com"
  );
});

test("falls back to Core for invalid or unsafe public origins", () => {
  const invalid = [
    "http://example.com",
    "http://localhost:3000",
    "https://localhost",
    "https://127.0.0.1",
    "https://169.254.169.254",
    "https://user:password@ultron.example.com",
    "https://ultron.example.com/?token=secret",
    "not-a-url"
  ];
  for (const value of invalid) {
    assert.equal(getPublicBaseUrl({ ULTRON_PUBLIC_BASE_URL: value }), DEFAULT_PUBLIC_BASE_URL, value);
  }
});
