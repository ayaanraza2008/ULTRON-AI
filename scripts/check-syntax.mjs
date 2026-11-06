/**
 * ULTRON AI — Tracked JavaScript Syntax Integrity Runner
 *
 * Discovers tracked source and test files from Git so removed/renamed files
 * cannot leave stale entries that break CI.
 */

import { execFileSync } from "node:child_process";

let gitBin = "git";
if (process.platform === "win32") {
  try {
    const whereOut = execFileSync("where.exe", ["git"], { encoding: "utf8" });
    const firstLine = whereOut.trim().split(/\r?\n/)[0];
    if (firstLine) gitBin = firstLine;
  } catch {}
}

const trackedFiles = execFileSync(gitBin, ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

const filesToCheck = trackedFiles
  .filter((file) => /\.(?:js|mjs|cjs)$/i.test(file) && !file.startsWith("integrations/browser/ego-lite/learnings/"))
  .sort();

if (filesToCheck.length === 0) {
  console.error("[check-syntax] No tracked JavaScript files were found.");
  process.exit(1);
}

let checked = 0;
const failures = [];

for (const file of filesToCheck) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
    checked += 1;
    if (checked % 50 === 0) {
      console.log(`[check-syntax] Progress: ${checked}/${filesToCheck.length} files verified...`);
    }
  } catch (error) {
    failures.push({ file, message: error.stderr?.toString("utf8") || error.message });
    console.error(`Syntax check failed for ${file}: ${failures.at(-1).message}`);
  }
}

if (failures.length > 0) {
  console.error(`\nFailed syntax check on ${failures.length} of ${filesToCheck.length} tracked file(s).`);
  process.exit(1);
}

console.log(`\nSyntax verification passed: ${checked}/${filesToCheck.length} tracked files verified clean.`);
process.exit(0);
