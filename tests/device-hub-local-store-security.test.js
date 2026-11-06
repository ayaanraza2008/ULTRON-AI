import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DeviceHub } from "../integrations/device-hub.js";

test("paired-device local recovery store is owner-readable and contains no plaintext device token", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ultron-device-store-"));
  const storagePath = path.join(directory, "paired-devices.json");
  const secret = "device-store-test-secret-with-at-least-32-characters";
  const token = "ultron_dev_" + "a".repeat(64);
  try {
    const hub = new DeviceHub({
      env: { ULTRON_DEVICE_SIGNING_SECRET: secret },
      durableStoragePath: storagePath
    });
    assert.ok(hub.importPairedDevice({
      id: "00000000-0000-4000-8000-000000000020",
      ownerUserId: "00000000-0000-4000-8000-000000000001",
      authToken: token
    }));
    assert.equal(hub.saveToDisk(), true);

    const stored = fs.readFileSync(storagePath, "utf8");
    assert.equal(stored.includes(token), false);
    assert.equal(stored.includes("encryptedAuthToken"), true);
    if (process.platform !== "win32") {
      assert.equal(fs.statSync(storagePath).mode & 0o777, 0o600);
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
