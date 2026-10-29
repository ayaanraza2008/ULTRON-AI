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
  createRoutineWorkspace,
  findInstalledEmployees,
  isCloudSyncedPath,
  makeRoutineTemplate,
  normalizeKey,
  planHireAll,
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

test("role IDs, upstream slugs, names and aliases resolve without ambiguity", () => {
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

test("workspace path resolves symlinked ancestors before checking cloud-sync locations", () => {
  if (process.platform === "win32") return;
  const root = tempDir();
  const cloud = path.join(root, "OneDrive", "agent-data");
  const alias = path.join(root, "local-workspace");
  fs.mkdirSync(cloud, { recursive: true });
  fs.symlinkSync(cloud, alias, "dir");
  try {
    assert.equal(isCloudSyncedPath(alias), true);
    assert.throws(() => resolveWorkspaceRoot(path.join(alias, "future")), /cloud/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("employee discovery ignores symlinked manifests", () => {
  if (process.platform === "win32") return;
  const root = tempDir();
  const roleFolder = path.join(root, "sales");
  const outside = path.join(root, "outside-manifest.json");
  fs.mkdirSync(roleFolder, { recursive: true });
  fs.writeFileSync(outside, JSON.stringify({ roleId: "sales" }));
  fs.symlinkSync(outside, path.join(roleFolder, ".ultron-employee.json"));
  try {
    assert.equal(findInstalledEmployees(root).length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("morning brief ignores linked files outside an employee workspace", () => {
  if (process.platform === "win32") return;
  const root = tempDir();
  const folder = path.join(root, "gtm-engineer");
  const outside = path.join(root, "private-outside-file.md");
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, ".ultron-employee.json"), JSON.stringify({ roleId: "gtm-engineer" }));
  fs.writeFileSync(outside, "PRIVATE_OUTSIDE_SENTINEL");
  fs.symlinkSync(outside, path.join(folder, "brief-latest.md"));
  try {
    const brief = buildMorningBrief({ root });
    assert.equal(brief.includes("PRIVATE_OUTSIDE_SENTINEL"), false);
    assert.match(brief, /No standard latest brief was found/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("hire-all plan installs missing kits but never overwrites unrecognized folders", () => {
  const root = tempDir();
  const installed = path.join(root, "gtm-engineer");
  const unknown = path.join(root, "sales");
  fs.mkdirSync(installed, { recursive: true });
  fs.writeFileSync(path.join(installed, ".ultron-employee.json"), JSON.stringify({ roleId: "gtm-engineer" }));
  fs.mkdirSync(unknown, { recursive: true });
  try {
    const plan = planHireAll(root);
    assert.equal(plan.length, 8);
    assert.equal(plan.filter((item) => item.state === "already-installed").length, 1);
    assert.equal(plan.find((item) => item.role.id === "gtm-engineer")?.state, "already-installed");
    assert.equal(plan.find((item) => item.role.id === "sales")?.state, "blocked-existing-folder");
    assert.equal(plan.filter((item) => item.state === "install").length, 6);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("employee discovery rejects a manifest whose role does not match its folder", () => {
  const root = tempDir();
  const wrongFolder = path.join(root, "sales");
  fs.mkdirSync(wrongFolder, { recursive: true });
  fs.writeFileSync(path.join(wrongFolder, ".ultron-employee.json"), JSON.stringify({ roleId: "web-dev" }));
  try {
    assert.equal(findInstalledEmployees(root).length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("morning brief refuses content reached through a linked parent directory", () => {
  if (process.platform === "win32") return;
  const root = tempDir();
  const folder = path.join(root, "gtm-engineer");
  const outside = path.join(root, "outside-briefs");
  fs.mkdirSync(folder, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(folder, ".ultron-employee.json"), JSON.stringify({ roleId: "gtm-engineer" }));
  fs.writeFileSync(path.join(outside, "brief-latest.md"), "PRIVATE_PARENT_LINK_SENTINEL");
  fs.symlinkSync(outside, path.join(folder, "briefs"), "dir");
  try {
    const brief = buildMorningBrief({ root });
    assert.equal(brief.includes("PRIVATE_PARENT_LINK_SENTINEL"), false);
    assert.match(brief, /No standard latest brief was found/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("new routine creation refuses a linked routines directory", () => {
  if (process.platform === "win32") return;
  const root = tempDir();
  const employeeRoot = path.join(root, "sales");
  const outside = path.join(root, "external-routines");
  fs.mkdirSync(employeeRoot, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.symlinkSync(outside, path.join(employeeRoot, "routines"), "dir");
  try {
    assert.throws(() => createRoutineWorkspace(employeeRoot, "sales-safe-review"), /symbolic link/i);
    assert.equal(fs.existsSync(path.join(outside, "sales-safe-review")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
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
