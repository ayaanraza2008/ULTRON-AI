import test from "node:test";
import assert from "node:assert/strict";
import { classifyTaskRoute } from "../task-router.js";

test("routes HexStrike security-scan requests to the guarded cybersecurity tools", () => {
  const route = classifyTaskRoute("Use HexStrike to scan my repository for vulnerabilities");
  assert.equal(route.tier, "medium");
  assert.deepEqual(route.categories, ["cybersecurity"]);
  assert.deepEqual(route.toolNames, ["hexstrike_scan", "check_integrations"]);
});

test("does not route an explanatory HexStrike question into a scan tool", () => {
  const route = classifyTaskRoute("Explain what HexStrike AI does");
  assert.equal(route.categories.includes("cybersecurity"), false);
});
