import { readdir } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const extensions = new Set([".js", ".mjs", ".cjs"]);
const excludedDirectories = new Set([
  ".git", "node_modules", ".build-gods-eye-view", "dist", "coverage",
  "frontend", "android", "windows-companion", "vendor", "build", ".next"
]);

async function collect(directory, files = []) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (excludedDirectories.has(entry.name) || entry.name.startsWith(".build-")) continue;
      await collect(path.join(directory, entry.name), files);
    } else if (entry.isFile() && extensions.has(path.extname(entry.name))) {
      files.push(path.join(directory, entry.name));
    }
  }
  return files;
}

const files = await collect(root);
if (!files.length) {
  console.error("Syntax check found no JavaScript source files; refusing a false-green result.");
  process.exit(1);
}

const failures = [];
for (const file of files) {
  const relative = path.relative(root, file).split(path.sep).join("/");
  const result = spawnSync(process.execPath, ["--check", file], {
    cwd: root,
    encoding: "utf8",
    timeout: 15_000,
    maxBuffer: 1024 * 1024
  });
  if (result.error || result.status !== 0) {
    failures.push({ file: relative, output: (result.stderr || result.stdout || result.error?.message || "node --check failed").trim() });
  }
}

if (failures.length) {
  for (const failure of failures) {
    console.error("\n[syntax error] " + failure.file + "\n" + failure.output);
  }
  console.error(`Syntax check failed for ${failures.length} of ${files.length} files.`);
  process.exit(1);
}
console.log(`Syntax check passed for ${files.length} tracked-runtime candidate files (dependencies, generated builds, and deferred frontend excluded).`);
