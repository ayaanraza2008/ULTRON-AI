import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Windows native companion implements the server-approved remote task contract", async () => {
  const source = await readFile(new URL("../windows-companion/RemoteCommandExecutor.cs", import.meta.url), "utf8");
  const switchStart = source.indexOf("return action.ToLowerInvariant() switch");
  const switchEnd = source.indexOf("\n            };", switchStart);
  assert.ok(switchStart >= 0 && switchEnd > switchStart, "native remote action switch must exist");
  const actionSwitch = source.slice(switchStart, switchEnd);

  assert.match(actionSwitch, /"open_folder"\s*=>\s*ListSharedFiles\(payload\)/);
  assert.match(actionSwitch, /"find_file"\s*=>\s*FindSharedFile\(payload\)/);
  assert.match(actionSwitch, /"get_task_output"\s*=>\s*GetTaskOutput\(payload\)/);
  assert.match(actionSwitch, /"inspect_task"\s*=>\s*InspectTrackedTasks\(\)/);
  assert.match(actionSwitch, /"stop_task"\s*=>\s*StopTrackedTask\(payload\)/);
  assert.match(actionSwitch, /"emergency_stop"\s*=>\s*EmergencyStop\(\)/);
});

test("Windows native folder search stays inside ULTRON Shared and rejects reparse points", async () => {
  const source = await readFile(new URL("../windows-companion/RemoteCommandExecutor.cs", import.meta.url), "utf8");
  const start = source.indexOf("private static object FindSharedFile");
  const end = source.indexOf("private static object ReadSharedFile", start);
  assert.ok(start >= 0 && end > start, "bounded file search implementation must exist");
  const implementation = source.slice(start, end);

  assert.match(implementation, /ResolveSharedPath\(/);
  assert.match(implementation, /IsReparsePoint\(/);
  assert.match(implementation, /query\.Length > 128/);
  assert.match(implementation, /\.Take\(100\)/);
  assert.match(source, /FirstString\(payload, "path", "directory", "folder", "subDir"\)/);
});

test("Windows native task output is limited to processes launched and tracked by ULTRON", async () => {
  const source = await readFile(new URL("../windows-companion/RemoteCommandExecutor.cs", import.meta.url), "utf8");
  const start = source.indexOf("private static object GetTaskOutput");
  const end = source.indexOf("private static object InspectTrackedTasks", start);
  assert.ok(start >= 0 && end > start, "task output lookup must exist");
  const implementation = source.slice(start, end);

  assert.match(implementation, /TrackedProcesses\.TryGetValue/);
  assert.match(implementation, /CompletedTaskResults\.TryGetValue/);
  assert.match(implementation, /TASK_NOT_FOUND/);
  assert.match(source, /while \(CompletedTaskOrder\.Count > 100/);
});

test("Windows native app launch checks the command ID before starting a process", async () => {
  const source = await readFile(new URL("../windows-companion/RemoteCommandExecutor.cs", import.meta.url), "utf8");
  const start = source.indexOf("private static object LaunchApp");
  const end = source.indexOf("private static void RememberTaskResult", start);
  assert.ok(start >= 0 && end > start, "app launcher implementation must exist");
  const implementation = source.slice(start, end);
  const processStart = implementation.indexOf("Process.Start(");

  assert.ok(processStart > 0, "app launch must use Process.Start");
  assert.ok(implementation.indexOf("lock (LaunchAppLock)") < processStart);
  assert.ok(implementation.indexOf("TrackedProcesses.TryGetValue(taskId") < processStart);
  assert.ok(implementation.indexOf("CompletedTaskResults.TryGetValue(taskId") < processStart);
  assert.match(implementation, /duplicateSuppressed = true/);
});
