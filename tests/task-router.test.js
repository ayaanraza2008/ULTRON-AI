import test from "node:test";
import assert from "node:assert/strict";
import { classifyTaskRoute, getToolCategories } from "../task-router.js";

test("routes an ordinary greeting or explanation without sending tool schemas", () => {
  for (const prompt of ["Hello", "Explain energy bands in simple English", "Explain this briefly"]) {
    const route = classifyTaskRoute(prompt);
    assert.equal(route.tier, "simple");
    assert.equal(route.filtered, true);
    assert.deepEqual(route.toolNames, []);
  }
});

test("narrows high-confidence single-domain tasks to allowlisted relevant tools", () => {
  const voice = classifyTaskRoute("Transcribe this audio in Hindi");
  assert.equal(voice.tier, "medium");
  assert.equal(voice.filtered, true);
  assert.ok(voice.toolNames.includes("transcribe_audio"));
  assert.ok(!voice.toolNames.includes("run_comfyui_workflow"));

  const desktop = classifyTaskRoute("Check whether my Windows companion is connected");
  assert.deepEqual(desktop.toolNames, ["check_desktop_companion"]);

  const geo = classifyTaskRoute("Geolocate this attached photo");
  assert.ok(geo.toolNames.includes("geo_sleuth_investigate"));

  const youtube = classifyTaskRoute("Create a YouTube production plan with 12 scenes");
  assert.ok(youtube.toolNames.includes("create_youtube_production_plan"));
});

test("routes Google Workspace requests to its bounded read-only tool set", () => {
  const route = classifyTaskRoute("Search Gmail for unread emails from school");
  assert.equal(route.tier, "medium");
  assert.deepEqual(route.categories, ["google_workspace"]);
  assert.equal(route.filtered, true);
  assert.ok(route.toolNames.includes("google_gmail_search"));
  assert.ok(route.toolNames.includes("google_gmail_list_unread"));
  assert.ok(route.toolNames.includes("google_sheets_read"));
  assert.ok(!route.toolNames.includes("browser_use"));
});

test("retains the full tool list for compound or uncertain actions", () => {
  const route = classifyTaskRoute("Research the topic and then create a YouTube production plan");
  assert.equal(route.tier, "complex");
  assert.equal(route.toolNames, null);
  assert.equal(route.filtered, false);

  const unknown = classifyTaskRoute("Coordinate a cross-service migration with a report");
  assert.equal(unknown.toolNames, null);
});

test("marks underspecified requests as clarify without inventing an action", () => {
  assert.equal(classifyTaskRoute("do it").tier, "clarify");
  assert.equal(classifyTaskRoute("continue", { hasHistory: true }).tier, "medium");
});

test("all categories use known, unique tool names", () => {
  const categories = getToolCategories();
  assert.ok(categories.includes("voice"));
  assert.ok(categories.includes("desktop"));
  for (const name of categories) assert.ok(typeof name === "string" && name.length > 0);
});

test("recognizes Unicode God’s Eye spelling and combined voice requests", () => {
  const globe = classifyTaskRoute("Show satellites in God’s Eye");
  assert.equal(globe.categories.includes("world_intelligence"), true);
  assert.ok(globe.toolNames.includes("world_intelligence_command"));

  const combined = classifyTaskRoute("Show satellites in God’s Eye and read aloud: hello world");
  assert.equal(combined.tier, "complex");
  assert.equal(combined.filtered, false);
  assert.equal(combined.toolNames, null);
});

test("retains tools for background report queueing and read-aloud requests", () => {
  const employee = classifyTaskRoute("Queue a web-dev review in the background");
  assert.equal(employee.categories.includes("planning"), true);
  assert.ok(employee.toolNames === null || employee.toolNames.includes("enqueue_employee_task"), "keep the full allowlist for ambiguous queue requests, or include the task enqueue tool in a narrowed route");

  const report = classifyTaskRoute("Queue a background research report");
  assert.equal(report.tier, "complex");
  assert.equal(report.filtered, false);

  const voice = classifyTaskRoute("Read this aloud: Hello world");
  assert.equal(voice.categories.includes("voice"), true);
  assert.ok(voice.toolNames.includes("synthesize_speech"));
});

test("routes explicit durable decisions to a non-empty safe tool set", () => {
  const route = classifyTaskRoute("We decided: keep the worker isolated from the API process.");
  assert.equal(route.categories.includes("memory"), true);
  assert.ok(route.toolNames.length > 0);
});


test("routes reverse-engineering investigations to REA's bounded tool family", () => {
  const feature = classifyTaskRoute("Trace how search results work in this Electron app");
  assert.ok(feature.categories.includes("reverse_engineering"));
  assert.ok(feature.toolNames.includes("rea_investigate_application_feature"));
  assert.ok(feature.toolNames.includes("rea_analyze_application"));
  assert.ok(!feature.toolNames.includes("run_comfyui_workflow"));

  const native = classifyTaskRoute("Inspect the native binary and disassemble main");
  assert.ok(native.categories.includes("reverse_engineering"));
  assert.ok(native.toolNames.includes("rea_inspect_native_code"));
});
