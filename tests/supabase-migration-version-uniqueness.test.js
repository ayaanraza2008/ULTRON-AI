import test from "node:test";
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const migrationsDirectory = fileURLToPath(new URL("../supabase/migrations/", import.meta.url));

test("Supabase migration filenames have valid, unique version prefixes", async () => {
  const entries = await readdir(migrationsDirectory, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort();

  assert.ok(files.length > 0, "At least one SQL migration must exist");

  const seenVersions = new Map();
  for (const filename of files) {
    const match = /^(\d+)_([a-z0-9][a-z0-9_-]*)\.sql$/i.exec(filename);
    assert.ok(match, `Invalid Supabase migration filename: ${filename}`);

    const version = match[1];
    const previous = seenVersions.get(version);
    assert.equal(
      previous,
      undefined,
      `Duplicate Supabase migration version "${version}" in ${previous} and ${filename}`
    );
    seenVersions.set(version, filename);
  }
});
