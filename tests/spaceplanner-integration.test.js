import test from "node:test";
import assert from "node:assert/strict";
import { createSpacePlannerPlan, isSpacePlannerRequest } from "../spaceplanner-integration.js";

test("generates bounded SpacePlanner-compatible room JSON for a house request", () => {
  const result = createSpacePlannerPlan({ request: "Design a 3 bedroom house floor plan with 2 bathrooms", widthCm: 1400, heightCm: 1100 });
  assert.equal(result.provider, "spaceplanner");
  assert.equal(result.state, "plan_generated");
  assert.equal(result.editorUrl, "https://spaceplanner.co/editor");
  assert.equal(result.dimensions.widthCm, 1400);
  assert.equal(result.planJson.plan_width_cm, 1400);
  assert.equal(result.roomCount, 7);
  assert.ok(result.planJson.rooms.every(room => room.x >= 0 && room.y >= 0 && room.w > 0 && room.h > 0 && room.x + room.w <= 1.000001 && room.y + room.h <= 1.000001));
});

test("uses safe defaults for invalid dimensions and rejects an empty request", () => {
  const result = createSpacePlannerPlan({ request: "Make a room layout", widthCm: -1, heightCm: "invalid" });
  assert.equal(result.dimensions.widthCm, 1200);
  assert.equal(result.dimensions.heightCm, 1000);
  assert.throws(() => createSpacePlannerPlan({ request: " " }), { code: "SPACEPLANNER_REQUEST_REQUIRED" });
});

test("detects floor plan design intent but not unrelated messages", () => {
  assert.equal(isSpacePlannerRequest("Create a 2 bedroom house floor plan"), true);
  assert.equal(isSpacePlannerRequest("What is the weather today?"), false);
});
