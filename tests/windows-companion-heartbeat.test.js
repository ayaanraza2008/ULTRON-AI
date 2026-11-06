import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Windows companion refreshes durable online presence with a bounded authenticated heartbeat", async () => {
  const source = await readFile(new URL("../windows-companion/Program.cs", import.meta.url), "utf8");

  assert.match(source, /private DateTime _lastHeartbeatUtc = DateTime\.MinValue;/);
  assert.match(source, /DateTime\.UtcNow - _lastHeartbeatUtc >= TimeSpan\.FromSeconds\(25\)/);
  assert.match(source, /new Uri\(backendUri, "\/api\/devices\/me\/heartbeat"\)/);
  assert.match(source, /heartbeat\.Headers\.Add\("x-device-token", identity\.Token\)/);

  const heartbeatUriPos = source.indexOf('new Uri(backendUri, "/api/devices/me/heartbeat")');
  const heartbeatStart = source.lastIndexOf('new HttpRequestMessage', heartbeatUriPos);
  const heartbeatEnd = source.indexOf('var route = $"/api/jarvis/devices/', heartbeatStart);
  assert.ok(heartbeatStart >= 0 && heartbeatEnd > heartbeatStart, "heartbeat must run before remote command polling");

  const heartbeatFlow = source.slice(heartbeatStart, heartbeatEnd);
  assert.match(heartbeatFlow, /HttpMethod\.Post/);
  assert.match(heartbeatFlow, /heartbeatResponse\.StatusCode == System\.Net\.HttpStatusCode\.Unauthorized[\s\S]*?return;/);
  assert.match(heartbeatFlow, /if \(!heartbeatResponse\.IsSuccessStatusCode\) return;/);
  assert.match(heartbeatFlow, /_lastHeartbeatUtc = DateTime\.UtcNow;/);

  assert.ok(
    heartbeatFlow.indexOf("if (!heartbeatResponse.IsSuccessStatusCode) return;") <
      heartbeatFlow.indexOf("_lastHeartbeatUtc = DateTime.UtcNow;"),
    "failed heartbeats must not advance the successful-heartbeat timestamp"
  );
});
