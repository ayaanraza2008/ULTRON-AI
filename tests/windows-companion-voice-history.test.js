import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Windows companion sends bounded recent conversation history to the paired-device AI route", async () => {
  const source = await readFile(new URL("../windows-companion/Program.cs", import.meta.url), "utf8");
  const start = source.indexOf("private List<object> BuildVoiceHistoryPayload");
  const end = source.indexOf("private void PauseRemotePollingForRePair", start);
  assert.ok(start >= 0 && end > start, "bounded voice history builder must exist");
  const builder = source.slice(start, end);
  assert.match(builder, /TakeLast\(12\)/);
  assert.match(builder, /totalChars \+ item\.Content\.Length > 12_000/);
  assert.match(builder, /selected\.Add\(\("user", currentCommand\)\)/);

  const dispatchStart = source.indexOf("private async Task DispatchVoiceCommandAsync");
  const dispatchEnd = source.indexOf("private async Task PollPendingCommandsAsync", dispatchStart);
  const dispatch = source.slice(dispatchStart, dispatchEnd);
  assert.match(dispatch, /messages = BuildVoiceHistoryPayload\(commandText\)/);
  assert.match(dispatch, /_voiceHistory\.Add\(\("assistant", textResponse\)\)/);
  assert.match(dispatch, /_voiceHistory\.Count > 24/);
});

test("Windows companion reads HTTP bodies with a streaming byte limit", async () => {
  const source = await readFile(new URL("../windows-companion/Program.cs", import.meta.url), "utf8");
  const start = source.indexOf("private static async Task<string?> ReadBoundedContentAsync");
  const end = source.indexOf("private List<object> BuildVoiceHistoryPayload", start);
  assert.ok(start >= 0 && end > start, "bounded HTTP response reader must exist");
  const reader = source.slice(start, end);
  assert.match(reader, /ContentLength is long declaredLength && declaredLength > maxBytes/);
  assert.match(reader, /ReadAsStreamAsync/);
  assert.match(reader, /output\.Length \+ read > maxBytes/);
  assert.doesNotMatch(source, /ReadAsStringAsync\(/);
});

test("Windows companion stops remote polling after device authentication expires", async () => {
  const source = await readFile(new URL("../windows-companion/Program.cs", import.meta.url), "utf8");
  const start = source.indexOf("private void PauseRemotePollingForRePair");
  const end = source.indexOf("private void ShowStatus", start);
  assert.ok(start >= 0 && end > start, "authentication failure handler must exist");
  assert.match(source.slice(start, end), /_commandPollTimer\.Stop\(\)/);
  assert.match(source, /PauseRemotePollingForRePair\("Windows companion authentication expired/);
  assert.match(source, /PauseRemotePollingForRePair\("Windows companion state sync authentication expired/);
});

test("Windows companion speaks asynchronously without blocking the UI thread", async () => {
  const source = await readFile(new URL("../windows-companion/Program.cs", import.meta.url), "utf8");
  const start = source.indexOf("private async Task DispatchVoiceCommandAsync");
  const end = source.indexOf("private async Task PollPendingCommandsAsync", start);
  const dispatch = source.slice(start, end);
  assert.match(dispatch, /synth\.SpeakAsync\(textResponse\)/);
  assert.match(dispatch, /await spoken\.Task\.WaitAsync\(TimeSpan\.FromSeconds\(30\)\)/);
  assert.doesNotMatch(dispatch, /synth\.Speak\(textResponse\)/);
});
