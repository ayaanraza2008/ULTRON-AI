import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { WindowsComputerControl } from "../system/computer-control.js";

describe("Windows Command Security & Telemetry Suite", () => {
  const control = new WindowsComputerControl();

  test("detects destructive command patterns", () => {
    assert.equal(control.isDestructiveCommand("rm -rf /"), true);
    assert.equal(control.isDestructiveCommand("del /f /q C:\\test.txt"), true);
    assert.equal(control.isDestructiveCommand("format C: /fs:ntfs"), true);
    assert.equal(control.isDestructiveCommand("shutdown /s /t 0"), true);
    assert.equal(control.isDestructiveCommand("Remove-Item -Recurse -Force path"), true);
    assert.equal(control.isDestructiveCommand("drop table users;"), true);

    // Non-destructive queries return false
    assert.equal(control.isDestructiveCommand("dir"), false);
    assert.equal(control.isDestructiveCommand("git status"), false);
    assert.equal(control.isDestructiveCommand("node --version"), false);
    assert.equal(control.isDestructiveCommand("echo hello"), false);
  });

  test("detects adversarial destructive command bypass attempts", () => {
    // Slashes immediately following command name
    assert.equal(control.isDestructiveCommand("del/f/q C:\\test.txt"), true);
    assert.equal(control.isDestructiveCommand("rd/s/q folder"), true);
    assert.equal(control.isDestructiveCommand("rmdir/s/q folder"), true);
    assert.equal(control.isDestructiveCommand("format/fs:ntfs C:"), true);

    // Quoted executable invocations
    assert.equal(control.isDestructiveCommand('"del" /f /q C:\\test.txt'), true);
    assert.equal(control.isDestructiveCommand("'rm' -rf /"), true);

    // Encoded powershell payloads
    assert.equal(control.isDestructiveCommand("powershell -enc aQBlAHgA"), true);
    assert.equal(control.isDestructiveCommand("powershell -EncodedCommand aQBlAHgA"), true);

    // Process killing
    assert.equal(control.isDestructiveCommand("taskkill /f /im node.exe"), true);
    assert.equal(control.isDestructiveCommand("Stop-Process -Name node"), true);

    // SQL database destruction
    assert.equal(control.isDestructiveCommand("DROP DATABASE ultron;"), true);
    assert.equal(control.isDestructiveCommand("TRUNCATE TABLE audit_logs;"), true);
    assert.equal(control.isDestructiveCommand("DELETE FROM credentials;"), true);
  });

  test("requires confirmation for destructive command execution", async () => {
    const res = await control.runApprovedCommand("rm -rf temp", { confirmed: false });
    assert.equal(res.success, false);
    assert.equal(res.requiresConfirmation, true);
    assert.equal(res.code, "DESTRUCTIVE_CONFIRMATION_REQUIRED");
  });

  test("executes allowlisted non-destructive command", async () => {
    const res = await control.runApprovedCommand("node --version");
    assert.equal(res.success, true);
    assert.equal(res.exitCode, 0);
    assert.ok(res.stdout.startsWith("v"));
  });

  test("rejects unapproved commands not on allowlist", async () => {
    await assert.rejects(
      async () => control.runApprovedCommand("curl http://malicious.site"),
      /not in the approved command allowlist/
    );
  });

  test("provides comprehensive telemetry with GPU, RAM, CPU and Battery", async () => {
    const telem = await control.getComprehensiveTelemetry();
    assert.ok(telem.platform);
    assert.ok(telem.memory);
    assert.ok(typeof telem.memory.usedPercent === "number");
    assert.ok(telem.cpuModel);
    assert.ok(telem.cpuCores > 0);
  });

  test("enforces Emergency Stop against command execution", async () => {
    control.setEmergencyStop(true);
    await assert.rejects(
      async () => control.runApprovedCommand("echo test"),
      /Emergency Stop/
    );
    control.setEmergencyStop(false);
  });
});
