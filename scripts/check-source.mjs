import { readdir } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const sourceExtensions = new Set([".js", ".mjs", ".cjs"]);
const ignoredDirectories = new Set([
  ".git", ".next", ".venv", "__pycache__", "build", "coverage",
  "dist", "node_modules", "target", "vendor", "venv"
]);

async function collectSources(directory, files = []) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) await collectSources(absolute, files);
      continue;
    }
    if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) {
      files.push(absolute);
    }
  }
  return files;
}

const files = await collectSources(root);
const failures = [];
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    cwd: root,
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 1024 * 1024
  });
  if (result.error || result.status !== 0) {
    failures.push({
      file: path.relative(root, file),
      detail: result.error?.message || result.stderr || result.stdout || "node --check failed"
    });
  }
}

if (failures.length) {
  for (const failure of failures) {
    process.stderr.write("\n[syntax error] " + failure.file + "\n" + failure.detail + "\n");
  }
  process.exitCode = 1;
} else {
  process.stdout.write("Syntax-checked " + files.length + " JavaScript source files.\n");
}
