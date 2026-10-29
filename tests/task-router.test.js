import test from "node:test";
import assert from "node:assert/strict";
import { classifyTaskRoute, getToolCategories } from "../task-router.js";

test("routes an ordinary greeting or explanation without sending tool schemas", () => {
  assert.equal(classifyTaskRoute("Hello").tier, "simple");
  assert.equal(classifyTaskRoute("Explain energy bands in simple English").tier, "simple");
  assert.equal(classifyTaskRoute("Explain this briefly").tier, "simple");
  assert.deepEqual(classifyTaskRoute("Hello").toolNames, null);
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
