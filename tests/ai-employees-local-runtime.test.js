import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { employeeRoutineCatalog } from "../employee-catalog.js";
import {
  ROLE_CATALOG,
  UPSTREAM_PACKAGE,
  buildMorningBrief,
  findInstalledEmployees,
  isCloudSyncedPath,
  makeRoutineTemplate,
  normalizeKey,
  resolveRole,
  resolveWorkspaceRoot,
  validateRoutineId
} from "../tools/ai-employees/ultron-employees.mjs";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ultron-employees-test-"));
}

test("catalog maps exactly eight roles and sixty routine slots", () => {
  assert.equal(ROLE_CATALOG.length, 8);
  assert.equal(ROLE_CATALOG.reduce((sum, role) => sum + role.routines, 0), 60);
  assert.equal(UPSTREAM_PACKAGE, "ai-employees@1.9.0");
});


test("local role mapping matches every routine in ULTRON's existing 60-routine catalog", () => {
  const ids = employeeRoutineCatalog.map((routine) => routine.id);
  assert.equal(ids.length, 60);
  assert.equal(new Set(ids).size, 60, "routine IDs must be unique");
  for (const role of ROLE_CATALOG) {
    const matches = employeeRoutineCatalog.filter((routine) => routine.roles.includes(role.id));
    assert.equal(matches.length, role.routines, `${role.id} routine count must match employee-catalog.js`);
    assert.ok(matches.every((routine) => routine.id.length > 0 && routine.name.length > 0));
  }
});
\ntest("role IDs, upstream slugs, names and aliases resolve without ambiguity", () => {
  assert.equal(resolveRole("seo-aeo")?.upstream, "seo-employee");
  assert.equal(resolveRole("seo-employee")?.id, "seo-aeo");
  assert.equal(resolveRole("Customer Support")?.id, "customer-satisfaction");
  assert.equal(resolveRole("chief_of_staff")?.id, "chief-of-staff");
  assert.equal(resolveRole("unknown-role"), null);
  assert.equal(normalizeKey("  Web Dev "), "web-dev");
});

test("workspace path rejects cloud-synced directories and home/root", () => {
  const temp = tempDir();
  assert.equal(isCloudSyncedPath(path.join(temp, "OneDrive", "employees")), true);
  assert.equal(isCloudSyncedPath(path.join(temp, "OneDrive - Personal", "employees")), true);
  assert.equal(isCloudSyncedPath(path.join(temp, "iCloud Drive", "employees")), true);
  assert.equal(isCloudSyncedPath(path.join(temp, "Google Drive (personal)", "employees")), true);
  assert.equal(isCloudSyncedPath(path.join(temp, "local-employees")), false);
  assert.throws(() => resolveWorkspaceRoot(os.homedir()), /dedicated employee workspace/i);
  assert.throws(() => resolveWorkspaceRoot(path.join(temp, "Dropbox", "employees")), /cloud/i);
  assert.equal(resolveWorkspaceRoot(path.join(temp, "local-employees")), path.join(temp, "local-employees"));
  fs.rmSync(temp, { recursive: true, force: true });
});

test("new routine ID must be namespaced to its role", () => {
  const role = resolveRole("sales");
  assert.equal(validateRoutineId("sales-next-step-review", role), "sales-next-step-review");
  assert.throws(() => validateRoutineId("new-routine", role), /prefix/i);
  assert.throws(() => validateRoutineId("../unsafe", role), /lowercase letters/i);
});

test("routine template keeps its schedule, review and credential safety gates explicit", () => {
  const role = resolveRole("web-dev");
  const text = makeRoutineTemplate({ id: "web-site-review", role, goal: "Find one verified site-health issue." });
  assert.match(text, /name: web-site-review/);
  assert.match(text, /Run the kit's existing guard/);
  assert.match(text, /Never create accounts, enter or write credentials/);
  assert.match(text, /Do not send messages, post, publish, submit forms/);
  assert.match(text, /## Corrections/);
});

test("morning brief combines local latest briefs and emits an honest missing-brief status", () => {
  const root = tempDir();
  const gtm = path.join(root, "gtm-engineer");
  const support = path.join(root, "customer-satisfaction");
  fs.mkdirSync(gtm, { recursive: true });
  fs.mkdirSync(support, { recursive: true });
  fs.writeFileSync(path.join(gtm, ".ultron-employee.json"), JSON.stringify({ roleId: "gtm-engineer" }));
  fs.writeFileSync(path.join(support, ".ultron-employee.json"), JSON.stringify({ roleId: "customer-satisfaction" }));
  fs.writeFileSync(path.join(gtm, "brief-latest.md"), "# GTM today\n- One sourced item");
  const employees = findInstalledEmployees(root);
  assert.equal(employees.length, 2);
  const brief = buildMorningBrief({ root, date: new Date(2026, 9, 29, 9, 0), employees });
  assert.match(brief, /Morning Brief — 2026-10-29/);
  assert.match(brief, /# GTM today/);
  assert.match(brief, /Customer Satisfaction Employee/);
  assert.match(brief, /No standard latest brief was found/);
  assert.match(brief, /held unless the relevant channel was explicitly released/);
  fs.rmSync(root, { recursive: true, force: true });
});
