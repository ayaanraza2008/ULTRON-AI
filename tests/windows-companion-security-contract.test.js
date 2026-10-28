import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../windows-companion/DesktopActionBridge.cs", import.meta.url), "utf8");
const program = await readFile(new URL("../windows-companion/Program.cs", import.meta.url), "utf8");

test("Windows actions use absolute system paths instead of shell/PATH resolution", () => {
  assert.match(source, /Environment\.GetFolderPath\(Environment\.SpecialFolder\.System\)/);
  assert.match(source, /Environment\.GetFolderPath\(Environment\.SpecialFolder\.Windows\)/);
  assert.match(source, /"notepad"\s*=>\s*Path\.Combine\(systemDirectory,\s*"notepad\.exe"\)/);
  assert.match(source, /"calculator"\s*=>\s*Path\.Combine\(systemDirectory,\s*"calc\.exe"\)/);
  assert.match(source, /"explorer"\s*=>\s*Path\.Combine\(windowsDirectory,\s*"explorer\.exe"\)/);
  assert.match(source, /Path\.IsPathFullyQualified\(executable\)/);
  assert.match(source, /File\.Exists\(executable\)/);
  assert.match(source, /UseShellExecute\s*=\s*false/);
  assert.doesNotMatch(source, /UseShellExecute\s*=\s*true/);
});


test("Windows companion status button opens the Core health endpoint while the frontend is absent", () => {
  assert.ok(program.includes('private const string AssistantUrl = "https://ultron-ai-core.onrender.com/api/health";'));
  assert.ok(program.includes('Text = "Open ULTRON Core status"'));
  assert.ok(!program.includes("ultron-ai-zvd7.onrender.com"));
});
