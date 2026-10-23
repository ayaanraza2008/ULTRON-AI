import test from "node:test";
import assert from "node:assert/strict";
import { normalizeHinglishForRouting } from "../agent-runtime.js";

test("Geo-Sleuth photo location requests normalize to the agent tool intent", () => {
  for (const input of [
    "geolocate this photo",
    "find where this photo was taken",
    "find the location of this image",
    "is photo ki location pata karo",
    "ye photo kahan ki hai"
  ]) {
    assert.match(normalizeHinglishForRouting(input).toLowerCase(), /geolocate photo|where was this photo taken/);
  }
});
