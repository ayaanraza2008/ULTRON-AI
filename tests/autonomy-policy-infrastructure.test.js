import test from "node:test";
import assert from "node:assert/strict";
import { classifyAutonomyRisk } from "../autonomy-policy.js";

test("identity, access-control, and infrastructure mutations require confirmation", () => {
  for (const task of [
    "Add a new admin to the workspace.",
    "Promote this user to administrator.",
    "Disable MFA on the account.",
    "Rotate the API key.",
    "Change DNS nameservers.",
    "Make the storage bucket public.",
    "Export all customer data.",
    "Revoke all sessions."
  ]) {
    const risk = classifyAutonomyRisk(task);
    assert.equal(risk.level, "external_effect", task);
    assert.equal(risk.requiresConfirmation, true, task);
  }
});

test("deleting a repository branch is classified as destructive", () => {
  const risk = classifyAutonomyRisk("Delete branch release-candidate.");
  assert.equal(risk.level, "destructive");
  assert.equal(risk.requiresConfirmation, true);
});

test("read-only identity and infrastructure checks remain routine", () => {
  for (const task of [
    "Check whether MFA is enabled.",
    "Inspect the current DNS records.",
    "Review the storage bucket access policy.",
    "Check the current number of active sessions."
  ]) {
    const risk = classifyAutonomyRisk(task);
    assert.equal(risk.level, "routine", task);
    assert.equal(risk.requiresConfirmation, false, task);
  }
});
