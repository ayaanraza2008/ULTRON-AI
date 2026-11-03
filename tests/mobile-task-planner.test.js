import test from "node:test";
import assert from "node:assert/strict";
import { MobileTaskPlanner, COMMON_APP_PACKAGES } from "../mobile/mobile-task-planner.js";

test("MobileTaskPlanner: decomposes YouTube search goal into multi-step execution plan", async () => {
  const planner = new MobileTaskPlanner();
  const plan = await planner.planFromIntent("Open YouTube on my phone and search for quantum computing", {
    deviceId: "emulator-5554"
  });

  assert.ok(plan.id, "Plan must have a unique ID");
  assert.equal(plan.intent, "APP_SEARCH_WORKFLOW");
  assert.equal(plan.deviceId, "emulator-5554");
  assert.ok(plan.steps.length >= 3, "Search workflow must have at least 3 steps (launch, tap/type, enter)");

  // Step 1: launch YouTube
  assert.equal(plan.steps[0].action, "mobile_launch_app");
  assert.equal(plan.steps[0].params.package, COMMON_APP_PACKAGES.youtube);

  // Subsequent steps: search query interaction
  assert.ok(plan.steps.some(s => s.action === "mobile_type_keys"));
});

test("MobileTaskPlanner: decomposes screenshot and screen perception goals", async () => {
  const planner = new MobileTaskPlanner();
  const plan = await planner.planFromIntent("Take a screenshot of my phone", { deviceId: "phone-1" });

  assert.equal(plan.intent, "SCREEN_INSPECTION");
  assert.equal(plan.steps.length, 1);
  assert.equal(plan.steps[0].action, "mobile_take_screenshot");
  assert.equal(plan.steps[0].params.device, "phone-1");
});

test("MobileTaskPlanner: decomposes device discovery commands", async () => {
  const planner = new MobileTaskPlanner();
  const plan = await planner.planFromIntent("Show my connected devices");

  assert.equal(plan.intent, "DEVICE_DISCOVERY");
  assert.equal(plan.steps.length, 1);
  assert.equal(plan.steps[0].action, "mobile_list_available_devices");
});

test("MobileTaskPlanner: decomposes navigation button presses", async () => {
  const planner = new MobileTaskPlanner();

  const homePlan = await planner.planFromIntent("Go home on my phone");
  assert.equal(homePlan.intent, "BUTTON_NAVIGATION");
  assert.equal(homePlan.steps[0].params.button, "HOME");

  const backPlan = await planner.planFromIntent("Press back");
  assert.equal(backPlan.intent, "BUTTON_NAVIGATION");
  assert.equal(backPlan.steps[0].params.button, "BACK");
});

test("MobileTaskPlanner: decomposes URL opening requests", async () => {
  const planner = new MobileTaskPlanner();
  const plan = await planner.planFromIntent("Open https://github.com/mobile-next/mobile-mcp");

  assert.equal(plan.intent, "OPEN_URL");
  assert.equal(plan.steps[0].action, "mobile_open_url");
  assert.equal(plan.steps[0].params.url, "https://github.com/mobile-next/mobile-mcp");
});

test("MobileTaskPlanner: resolves application names to package names cleanly", () => {
  const planner = new MobileTaskPlanner();

  assert.equal(planner.resolvePackageName("youtube"), "com.google.android.youtube");
  assert.equal(planner.resolvePackageName("chrome"), "com.android.chrome");
  assert.equal(planner.resolvePackageName("settings"), "com.android.settings");
  assert.equal(planner.resolvePackageName("calculator"), "com.google.android.calculator");

  // Fully-qualified package names pass untouched
  assert.equal(planner.resolvePackageName("com.example.custom"), "com.example.custom");
});

test("MobileTaskPlanner: detects dependency cycles in DAG workflows", () => {
  const planner = new MobileTaskPlanner();

  // Valid linear DAG
  const validSteps = [
    { id: "step-1", dependsOn: [] },
    { id: "step-2", dependsOn: ["step-1"] },
    { id: "step-3", dependsOn: ["step-2"] }
  ];
  assert.equal(planner.validateDag(validSteps).valid, true);

  // Cyclic DAG (step-1 -> step-2 -> step-3 -> step-1)
  const cyclicSteps = [
    { id: "step-1", dependsOn: ["step-3"] },
    { id: "step-2", dependsOn: ["step-1"] },
    { id: "step-3", dependsOn: ["step-2"] }
  ];
  const check = planner.validateDag(cyclicSteps);
  assert.equal(check.valid, false);
  assert.equal(check.error, "CYCLE_DETECTED");
});
