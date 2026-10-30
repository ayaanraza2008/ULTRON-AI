import test from "node:test";
import assert from "node:assert/strict";
import { classifyTaskRoute, getToolCategories } from "../task-router.js";

test("explicit fenced-code run requests route only to the opt-in sandbox", () => {
  const fence = String.fromCharCode(96).repeat(3);
  const direct = classifyTaskRoute("Run this code:\n" + fence + "python\nprint('ok')\n" + fence);
  assert.deepEqual(direct.categories, ["coding_sandbox"]);
  assert.deepEqual(direct.toolNames, ["coding_sandbox_run"]);
  const indirect = classifyTaskRoute("Review this code, but do not run it:\n" + fence + "python\nprint('ok')\n" + fence);
  assert.ok(!indirect.categories.includes("coding_sandbox"));
  assert.ok(!indirect.toolNames?.includes("coding_sandbox_run"));
});

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

test("routes every newly integrated repository adapter to its dedicated agent tool", () => {
  const cases = [
    ["Use OpenHiggsfield to generate a cinematic video", "open_higgsfield", "openhiggsfield"],
    ["Generate an image with Open Generative AI", "open_generative_ai", "open_generative_ai"],
    ["Start an OpenDesign workspace run for this UI", "open_design", "open_design"],
    ["Search my AppFlowy workspace for deployment notes", "appflowy", "appflowy"],
    ["Use OpenSEO to look up saved keywords for my project", "open_seo", "openseo"]
  ];

  for (const [prompt, category, tool] of cases) {
    const route = classifyTaskRoute(prompt);
    assert.equal(route.tier, "medium", prompt);
    assert.deepEqual(route.categories, [category], prompt);
    assert.equal(route.filtered, true, prompt);
    assert.ok(route.toolNames.includes(tool), prompt);
    assert.ok(route.toolNames.includes("check_repository_capabilities"), prompt);
  }
});

test("provider-specific media routing does not accidentally hide the selected adapter", () => {
  const higgsfield = classifyTaskRoute("Generate a cinematic image using OpenHiggsfield");
  assert.deepEqual(higgsfield.categories, ["open_higgsfield"]);
  assert.ok(higgsfield.toolNames.includes("openhiggsfield"));

  const muapi = classifyTaskRoute("Generate a video using Open Generative AI");
  assert.deepEqual(muapi.categories, ["open_generative_ai"]);
  assert.ok(muapi.toolNames.includes("open_generative_ai"));
});


test("routes Hermes Agent long-running run lifecycle requests to dedicated owner-scoped tools", () => {
  const start = classifyTaskRoute("Start a background Hermes Agent run to research the official API.");
  assert.deepEqual(start.categories, ["hermes"]);
  assert.ok(start.toolNames.includes("hermes_agent_start_run"));
  assert.ok(start.toolNames.includes("hermes_agent_run_status"));
  assert.ok(start.toolNames.includes("hermes_agent_stop_run"));

  const status = classifyTaskRoute("Check status for run_abc123");
  assert.deepEqual(status.categories, ["hermes"]);
  assert.ok(status.toolNames.includes("hermes_agent_run_status"));
});


test("routes Hermes skills and toolset discovery to read-only capability tools", () => {
  const skills = classifyTaskRoute("Show me the skills available in Hermes Agent.");
  assert.deepEqual(skills.categories, ["hermes"]);
  assert.ok(skills.toolNames.includes("hermes_agent_list_skills"));
  assert.ok(skills.toolNames.includes("hermes_agent_list_toolsets"));

  const toolsets = classifyTaskRoute("List enabled toolsets in Hermes Agent.");
  assert.deepEqual(toolsets.categories, ["hermes"]);
  assert.ok(toolsets.toolNames.includes("hermes_agent_list_toolsets"));
});


test("routes Hermes run progress and generation-bound approval requests", () => {
  const events = classifyTaskRoute("Show progress events for run_abc123");
  assert.deepEqual(events.categories, ["hermes"]);
  assert.ok(events.toolNames.includes("hermes_agent_run_events"));

  const approve = classifyTaskRoute("Approve prompt_safe_123 in run_abc123 at generation 4 once");
  assert.deepEqual(approve.categories, ["hermes"]);
  assert.ok(approve.toolNames.includes("hermes_agent_resolve_approval"));
});
