import test from "node:test";
import assert from "node:assert/strict";
import { ScreenObserver } from "../vision/screen-observer.js";

test("ScreenObserver: inspectCurrentScreen classifies activity and records history", async () => {
  const observer = new ScreenObserver();
  const observation = await observer.inspectCurrentScreen();

  assert.ok(observation.id.startsWith("obs-"));
  assert.equal(typeof observation.activeWindow, "string");
  assert.equal(typeof observation.detectedActivity, "string");
  assert.ok(observation.contextSummary.includes("User is active in"));

  const last = observer.getLastInspection();
  assert.equal(last.id, observation.id);

  const history = observer.getHistory();
  assert.ok(history.length >= 1);
});
