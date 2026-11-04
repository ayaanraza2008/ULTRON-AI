import test from "node:test";
import assert from "node:assert/strict";
import { classifyTaskRoute } from "../task-router.js";

test("routes HexStrike security-scan requests to the guarded cybersecurity tools", () => {
  const route = classifyTaskRoute("Use HexStrike to scan my repository for vulnerabilities");
  assert.equal(route.tier, "medium");
  assert.deepEqual(route.categories, ["cybersecurity"]);
  assert.deepEqual(route.toolNames, ["hexstrike_scan", "check_integrations"]);
});
