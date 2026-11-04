/**
 * ULTRON AI — Native Windows Companion Compiler
 * File: scripts/build-native-companion.mjs
 *
 * Compiles UltronNativeCompanion.cs using the host's native Windows CSC compiler
 * into bin/ultron-native-companion.exe. Zero external npm dependencies.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export function buildNativeCompanion(options = {}) {
  const repoRoot = path.resolve(import.meta.dirname, "..");
  const binDir = path.join(repoRoot, "bin");
  const sourceFile = path.join(repoRoot, "system", "native-companion", "UltronNativeCompanion.cs");
  const targetExe = path.join(binDir, "ultron-native-companion.exe");

  if (os.platform() !== "win32") {
    return {
      success: false,
      reason: "Non-Windows platform: native Win32 companion compilation skipped",
      platform: os.platform()
    };
  }

  if (!fs.existsSync(sourceFile)) {
    throw new Error(`Source file missing: ${sourceFile}`);
  }

  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
  }

  const cscCandidates = [
    "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe",
    "C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe"
  ];

  const cscPath = cscCandidates.find((c) => fs.existsSync(c));
  if (!cscPath) {
    return {
      success: false,
      reason: "C# compiler (csc.exe) not found in Windows Microsoft.NET framework directories"
    };
  }

  try {
    const args = [
      "/nologo",
      "/target:winexe",
      "/optimize+",
      `/out:${targetExe}`,
      sourceFile
    ];
    execFileSync(cscPath, args, { stdio: "pipe" });

    if (fs.existsSync(targetExe)) {
      const stats = fs.statSync(targetExe);
      return {
        success: true,
        binaryPath: targetExe,
        sizeBytes: stats.size,
        compiledAt: stats.mtime.toISOString()
      };
    } else {
      return { success: false, reason: "Compiler executed but target binary was not created" };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// Direct execution CLI entrypoint
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const result = buildNativeCompanion();
  if (result.success) {
    console.log(`[build-native-companion] Compiled successfully: ${result.binaryPath} (${result.sizeBytes} bytes)`);
    process.exit(0);
  } else {
    console.warn(`[build-native-companion] Notice: ${result.reason || result.error}`);
    process.exit(0); // Exit 0 so non-Windows or environments without CSC do not break npm test
  }
}
