import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const appPath = fileURLToPath(new URL("../public/app.js", import.meta.url));
const source = readFileSync(appPath, "utf8");
const devicesViewStart = source.indexOf('if (name === "devices")');
assert.ok(devicesViewStart >= 0, "the Devices view must exist");
const devicesViewEnd = source.indexOf('\n    if (name === ', devicesViewStart + 1);
const devicesView = source.slice(devicesViewStart, devicesViewEnd >= 0 ? devicesViewEnd : undefined);

test("Devices view exposes only the six fixed Windows app and folder requests", () => {
  for (const [actionType, target] of [
    ["launch_application", "notepad"],
    ["launch_application", "explorer"],
    ["launch_application", "calculator"],
    ["open_known_folder", "desktop"],
    ["open_known_folder", "documents"],
    ["open_known_folder", "downloads"]
  ]) {
    assert.ok(
      devicesView.includes(`{ actionType: "${actionType}", target: "${target}"`),
      `the UI must expose the fixed target ${actionType}/${target}`
    );
  }
  assert.match(devicesView, /if \(device\.online\)\s*\{/);
  assert.match(devicesView, /encodeURIComponent\(device\.id\)\s*\+\s*"\/commands"/);
  assert.match(devicesView, /method: "POST"/);
  assert.match(devicesView, /approvalRequiredOnDevice|Approve it on the Windows PC/);
  assert.match(devicesView, /60 seconds/);
});

test("Devices view shows action history and keeps revoke available", () => {
  assert.match(devicesView, /\/commands"\);/);
  assert.match(devicesView, /command\.resultCode/);
  assert.match(devicesView, /REVOKE /);
  assert.match(devicesView, /Windows companion revoked/);
});

test("Devices view states that every action needs local approval", () => {
  assert.match(devicesView, /visible Windows dialog/);
  assert.match(devicesView, /LOCAL APPROVAL REQUIRED/);
  assert.match(devicesView, /six fixed app\/folder requests/);
});
