/**
 * ULTRON AI — Windows Control & Command Security Test Suite
 * Tests: tests/windows-control-and-security.test.js
 *
 * Verifies:
 * 1. 4-tier hardware status reporting (SUPPORTED_AND_VERIFIED, COMMAND_SENT_BUT_UNVERIFIED, UNSUPPORTED_HARDWARE, FAILED).
 * 2. Structured, allowlisted command execution with execFileAsync.
 * 3. Strict rejection of shell chaining (&, &&, |, ;, $(), backticks).
 * 4. Rejection and detection of encoded PowerShell and destructive operations.
 * 5. Strict sandbox path confinement inside UltronWorkspace.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { windowsAutomation, HARDWARE_STATUS } from "../system/windows-automation.js";
import { WindowsComputerControl } from "../system/computer-control.js";

describe("ULTRON Windows Computer Control & Security Hardening Suite", () => {
  it("provides truthful 4-tier hardware status for display brightness and hardware calls", async () => {
    assert.ok(HARDWARE_STATUS.SUPPORTED_AND_VERIFIED);
    assert.ok(HARDWARE_STATUS.COMMAND_SENT_BUT_UNVERIFIED);
    assert.ok(HARDWARE_STATUS.UNSUPPORTED_HARDWARE);
    assert.ok(HARDWARE_STATUS.FAILED);

    const brightnessResult = await windowsAutomation.setDisplayBrightness(75);
    assert.ok(
      [
        HARDWARE_STATUS.SUPPORTED_AND_VERIFIED,
        HARDWARE_STATUS.COMMAND_SENT_BUT_UNVERIFIED,
        HARDWARE_STATUS.UNSUPPORTED_HARDWARE,
        HARDWARE_STATUS.FAILED
      ].includes(brightnessResult.hardwareStatus),
      `hardwareStatus '${brightnessResult.hardwareStatus}' must be one of the 4 defined tiers`
    );
  });

  it("executes allowlisted read-only commands via structured execution", async () => {
    const ctrl = new WindowsComputerControl();
    await ctrl.initialize();

    const res = await ctrl.runApprovedCommand("node --version");
    assert.equal(res.success, true);
    assert.equal(res.exitCode, 0);
    assert.match(res.stdout, /^v\d+/);
  });

  it("strictly rejects commands containing shell chaining operators or metacharacters", async () => {
    const ctrl = new WindowsComputerControl();
    await ctrl.initialize();

    const maliciousCommands = [
      "node --version & whoami",
      "node --version && echo pwned",
      "node --version | dir",
      "node --version; whoami",
      "node --version `whoami`",
      "node --version $(whoami)",
      "node --version\nwhoami"
    ];

    for (const cmd of maliciousCommands) {
      await assert.rejects(
        async () => {
          await ctrl.runApprovedCommand(cmd);
        },
        (err) => {
          assert.match(err.message, /forbidden shell metacharacters|not in the approved command allowlist/i);
          return true;
        }
      );
    }
  });

  it("detects destructive and encoded PowerShell commands requiring confirmation or blocking", () => {
    const ctrl = new WindowsComputerControl();

    assert.equal(ctrl.isDestructiveCommand("powershell -enc aW52b2tlLWV4cHJlc3Npb24="), true);
    assert.equal(ctrl.isDestructiveCommand("powershell -EncodedCommand JABhID0gMQ=="), true);
    assert.equal(ctrl.isDestructiveCommand("powershell [System.Convert]::FromBase64String('abc')"), true);
    assert.equal(ctrl.isDestructiveCommand("taskkill /F /IM explorer.exe"), true);
    assert.equal(ctrl.isDestructiveCommand("rmdir /s /q C:\\Windows"), true);
    assert.equal(ctrl.isDestructiveCommand("reg delete HKLM\\Software"), true);
    assert.equal(ctrl.isDestructiveCommand("DROP TABLE users"), true);
    assert.equal(ctrl.isDestructiveCommand("node --version"), false);
  });

  it("confines file operations strictly within sandboxBase and blocks traversal", async () => {
    const ctrl = new WindowsComputerControl();
    await ctrl.initialize();

    assert.throws(() => {
      ctrl.resolveSafePath("../../../Windows/System32/cmd.exe");
    }, /Path traversal violation/i);

    assert.throws(() => {
      ctrl.resolveSafePath("/etc/passwd");
    }, /Path traversal violation/i);
  });
});
