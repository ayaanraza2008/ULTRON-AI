import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const currentUltronInterface = "https://ultron-core-interface.onrender.com/";
const retiredInterface = "https://ultron-ai-zvd7.onrender.com/";

test("Windows companion opens the current ULTRON Core interface", async () => {
  const source = await readFile(new URL("../windows-companion/Program.cs", import.meta.url), "utf8");
  assert.ok(source.includes(currentUltronInterface));
  assert.ok(!source.includes(retiredInterface));
});

test("Android activity and wake notification open the current ULTRON Core interface", async () => {
  const main = await readFile(new URL("../android-companion/app/src/main/java/com/ultron/companion/MainActivity.kt", import.meta.url), "utf8");
  const service = await readFile(new URL("../android-companion/app/src/main/java/com/ultron/companion/WakeWordService.kt", import.meta.url), "utf8");
  assert.ok(main.includes(currentUltronInterface));
  assert.ok(service.includes(currentUltronInterface));
  assert.ok(!main.includes(retiredInterface));
  assert.ok(!service.includes(retiredInterface));
});
