import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { patchWorldIntelligenceDependencies } from "../scripts/patch-world-intelligence-dependencies.mjs";

const overrides = JSON.parse(readFileSync(new URL("../scripts/world-intelligence-dependency-lock-overrides.json", import.meta.url), "utf8"));

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "ultron-world-deps-"));
  mkdirSync(root, { recursive: true });
  const devDependencies = {
    prettier: "3.9.6",
    puppeteer: overrides.expectedBaseDevDependencies.puppeteer,
    sharp: "^0.35.4",
    vite: overrides.expectedBaseDevDependencies.vite,
    "vite-plugin-cesium": "^1.2.23",
    ws: "^8.21.0"
  };
  const manifest = {
    name: overrides.expectedProject.name,
    version: overrides.expectedProject.version,
    devDependencies
  };
  const packages = {
    "": {
      name: manifest.name,
      version: manifest.version,
      devDependencies: { ...devDependencies }
    }
  };
  for (const [packagePath, version] of Object.entries(overrides.expectedBaseVersions)) {
    packages[packagePath] = version === null ? undefined : { version };
  }
  for (const item of overrides.packageLockRemovals) {
    packages[item.path] = { version: item.expectedVersion };
  }
  for (const [packagePath, entry] of Object.entries(packages)) {
    if (entry === undefined) delete packages[packagePath];
  }
  writeFileSync(path.join(root, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(path.join(root, "package-lock.json"), JSON.stringify({
    name: manifest.name,
    version: manifest.version,
    lockfileVersion: overrides.expectedProject.lockfileVersion,
    requires: true,
    packages
  }, null, 2) + "\n");
  return root;
}

test("applies only the pinned dependency security lock updates", () => {
  const root = fixture();
  try {
    const result = patchWorldIntelligenceDependencies(root);
    const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    const lock = JSON.parse(readFileSync(path.join(root, "package-lock.json"), "utf8"));
    assert.equal(manifest.version, "0.2.1");
    assert.deepEqual(
      { puppeteer: manifest.devDependencies.puppeteer, vite: manifest.devDependencies.vite },
      overrides.targetDevDependencies
    );
    assert.equal(lock.packages[""].version, "0.2.1");
    assert.deepEqual(
      { puppeteer: lock.packages[""].devDependencies.puppeteer, vite: lock.packages[""].devDependencies.vite },
      overrides.targetDevDependencies
    );
    for (const [packagePath, expected] of Object.entries(overrides.packageLockUpdates)) {
      assert.deepEqual(lock.packages[packagePath], expected, packagePath);
    }
    for (const item of overrides.packageLockRemovals) {
      assert.equal(lock.packages[item.path], undefined, item.path);
    }
    assert.equal(result.updatedLockEntries, Object.keys(overrides.packageLockUpdates).length);
    assert.equal(lock.packages["node_modules/zod"].version, "4.6.7");
    assert.equal(lock.packages["node_modules/vite"].version, "6.4.5");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fails closed when the pinned source version has drifted", () => {
  const root = fixture();
  try {
    const manifestPath = path.join(root, "package.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.version = "0.3.0";
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    assert.throws(() => patchWorldIntelligenceDependencies(root), /Unexpected World Intelligence source version/);
    const lock = JSON.parse(readFileSync(path.join(root, "package-lock.json"), "utf8"));
    assert.equal(lock.packages["node_modules/puppeteer"].version, overrides.expectedBaseVersions["node_modules/puppeteer"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
