import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../google-workspace-bridge/Code.gs", import.meta.url), "utf8");

test("Apps Script bridge requires a script property token and rejects unknown actions", () => {
  assert.match(source, /PropertiesService\.getScriptProperties\(\)\.getProperty\(["']ULTRON_BRIDGE_TOKEN["']\)/);
  assert.match(source, /constantTimeEqual_\(body\.bridgeToken, expected\)/);
  assert.match(source, /if \(!ALLOWED_ACTIONS\.has\(action\)\)/);
  for (const action of [
    "gmail_list_unread", "gmail_search", "calendar_get_events",
    "drive_list_files", "drive_read_doc", "sheets_read"
  ]) assert.ok(source.includes('"' + action + '"'));
});

test("Apps Script bridge contains no write/delete Gmail, Calendar, Drive, or Sheets operations", () => {
  for (const forbidden of [
    "GmailApp.sendEmail",
    "CalendarApp.createEvent",
    ".setTrashed(",
    ".setName(",
    ".moveTo(",
    ".setValues(",
    ".appendRow("
  ]) assert.equal(source.includes(forbidden), false, "forbidden mutation: " + forbidden);
  assert.match(source, /Enabled actions are deliberately read-only/);
});

test("Apps Script bridge caps request size, message count, date range, and spreadsheet cells", () => {
  assert.match(source, /MAX_BODY_CHARS = 16000/);
  assert.match(source, /MAX_ITEMS = 20/);
  assert.match(source, /90 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(source, /c2 - c1 \+ 1 > 20/);
  assert.match(source, /r2 - r1 \+ 1 > 40/);
});
