import test from "node:test";
import assert from "node:assert/strict";
import { isPublicNetworkHost, safeServiceBase } from "../network-safety.js";

test("public network host validator rejects private, local, metadata, and transition hosts", () => {
  for (const host of [
    "localhost", "printer.local", "service.internal", "metadata.google.internal",
    "10.0.0.1", "127.0.0.1", "169.254.169.254", "192.168.1.1", "172.20.0.2",
    "::1", "[::1]", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1",
    "2001:db8::1", "2002:7f00:1::1"
  ]) assert.equal(isPublicNetworkHost(host), false, host);
  for (const host of ["openrouter.ai", "api.example.com", "8.8.8.8", "2606:4700:4700::1111"]) {
    assert.equal(isPublicNetworkHost(host), true, host);
  }
});

test("service URL validator accepts HTTPS public services and local HTTP development only", () => {
  assert.equal(safeServiceBase("https://api.example.com/v1/"), "https://api.example.com/v1");
  assert.equal(safeServiceBase("http://localhost:11434/"), "http://localhost:11434");
  assert.equal(safeServiceBase("http://127.0.0.1:8787"), "http://127.0.0.1:8787");
  assert.equal(safeServiceBase("http://[::1]:8787"), "http://[::1]:8787");
  for (const url of [
    "http://api.example.com", "https://169.254.169.254/metadata",
    "https://192.168.1.10", "https://10.0.0.3", "https://metadata.google.internal",
    "https://printer.local", "https://[::1]", "https://[fd00::1]", "ftp://api.example.com",
    "https://user:password@api.example.com", "https://api.example.com?token=secret",
    "https://api.example.com#fragment", "https://single-label"
  ]) assert.equal(safeServiceBase(url), null, url);
});
