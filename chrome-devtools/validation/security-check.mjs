import test from "node:test";
import assert from "node:assert/strict";
import { validateBrowserUrl, validateCdpEndpoint, validateChromeActionInput, isPublicIpAddress, safeDisplayUrl } from "../dist/security.js";

test("navigation accepts HTTPS public domains and local development URLs", () => {
  assert.equal(validateBrowserUrl("https://example.com/app").hostname, "example.com");
  assert.equal(validateBrowserUrl("http://127.0.0.1:3000").hostname, "127.0.0.1");
  assert.equal(validateBrowserUrl("http://localhost:5173").hostname, "localhost");
});

test("navigation rejects unsafe schemes, embedded credentials, direct IPs and internal hostnames", () => {
  for (const url of [
    "file:///C:/Windows/win.ini",
    "javascript:alert(1)",
    "https://user:pass@example.com/",
    "https://169.254.169.254/latest/meta-data/",
    "https://192.168.1.1/",
    "https://router.local/",
    "https://metadata.google.internal/",
    "http://example.com/"
  ]) {
    assert.throws(() => validateBrowserUrl(url), undefined, url);
  }
});

test("resolved-address policy allows public addresses and rejects special/private ranges", () => {
  assert.equal(isPublicIpAddress("8.8.8.8"), true);
  assert.equal(isPublicIpAddress("1.1.1.1"), true);
  for (const address of ["127.0.0.1", "10.0.0.1", "172.16.1.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "224.0.0.1", "2001:db8::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1"]) {
    assert.equal(isPublicIpAddress(address), false, address);
  }
 });

test("CDP endpoint is restricted to loopback HTTP", () => {
  assert.equal(validateCdpEndpoint("http://127.0.0.1:9222"), "http://127.0.0.1:9222");
  assert.throws(() => validateCdpEndpoint("https://example.com:9222"));
  assert.throws(() => validateCdpEndpoint("http://192.168.1.2:9222"));
});

test("debug output redacts inline data/blob URLs", () => {
  assert.equal(safeDisplayUrl("data:text/plain,private-content"), "[data resource omitted]");
  assert.equal(safeDisplayUrl("blob:https://example.com/1234"), "[blob resource omitted]");
  assert.equal(safeDisplayUrl("https://example.com/path?token=secret#fragment"), "https://example.com/path");
 });

test("action validation bounds selectors, inputs, limits and trace durations", () => {
  assert.deepEqual(validateChromeActionInput({ action: "navigate", url: "https://example.com" }).action, "navigate");
  assert.equal(validateChromeActionInput({ action: "performance_trace" }).durationMs, 3000);
  assert.throws(() => validateChromeActionInput({ action: "click", selector: " " }));
  assert.throws(() => validateChromeActionInput({ action: "fill", selector: "input", text: "x".repeat(5001) }));
  assert.throws(() => validateChromeActionInput({ action: "console_logs", limit: 101 }));
  assert.throws(() => validateChromeActionInput({ action: "performance_trace", durationMs: 10001 }));
});
