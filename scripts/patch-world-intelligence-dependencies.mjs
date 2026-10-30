import { readFileSync, writeFileSync, renameSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const overridesPath = path.join(scriptDirectory, "world-intelligence-dependency-lock-overrides.json");
const overrides = JSON.parse(readFileSync(overridesPath, "utf8"));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/**
 * Apply the reviewed dependency-only security resolution to the exact pinned
 * God’s Eye source tree. Fail closed when the upstream manifest/lockfile drifts.
 */
export function patchWorldIntelligenceDependencies(targetDirectory) {
  assert(typeof targetDirectory === "string" && targetDirectory.trim(), "Provide the cloned World Intelligence directory.");
  const root = path.resolve(targetDirectory);
  const manifestPath = path.join(root, "package.json");
  const lockPath = path.join(root, "package-lock.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  const lockRoot = lock.packages?.[""];

  assert(manifest.name === overrides.expectedProject.name, "Unexpected World Intelligence package name; refusing dependency patch.");
  assert(manifest.version === overrides.expectedProject.version, "Unexpected World Intelligence source version; refresh and review the dependency patch.");
  assert(lock.lockfileVersion === overrides.expectedProject.lockfileVersion, "Unexpected npm lockfile version; refusing dependency patch.");
  assert(lockRoot?.version === overrides.expectedProject.version, "package-lock root version does not match the pinned source.");
  assert(
    manifest.devDependencies?.puppeteer === overrides.expectedBaseDevDependencies.puppeteer &&
    manifest.devDependencies?.vite === overrides.expectedBaseDevDependencies.vite,
    "World Intelligence devDependency declarations changed; refresh and review the security patch."
  );
  assert(
    lockRoot.devDependencies?.puppeteer === overrides.expectedBaseDevDependencies.puppeteer &&
    lockRoot.devDependencies?.vite === overrides.expectedBaseDevDependencies.vite,
    "World Intelligence lockfile root dependencies changed; refusing an unreviewed patch."
  );

  for (const [packagePath, expectedVersion] of Object.entries(overrides.expectedBaseVersions)) {
    const actualVersion = lock.packages?.[packagePath]?.version ?? null;
    assert(
      actualVersion === expectedVersion,
      "Unexpected locked package at " + packagePath + ": expected " + expectedVersion + ", received " + actualVersion
    );
  }
  for (const item of overrides.packageLockRemovals) {
    assert(
      lock.packages?.[item.path]?.version === item.expectedVersion,
      "Expected vulnerable package entry not found at " + item.path
    );
  }

  // Apply everything in memory before writing either file.
  manifest.devDependencies = { ...manifest.devDependencies, ...overrides.targetDevDependencies };
  lockRoot.devDependencies = { ...lockRoot.devDependencies, ...overrides.targetDevDependencies };
  for (const [packagePath, entry] of Object.entries(overrides.packageLockUpdates)) {
    lock.packages[packagePath] = entry;
  }
  for (const item of overrides.packageLockRemovals) {
    delete lock.packages[item.path];
  }

  for (const [packagePath, entry] of Object.entries(overrides.packageLockUpdates)) {
    assert(lock.packages[packagePath]?.version === entry.version, "Patched lockfile version validation failed at " + packagePath);
  }
  assert(manifest.devDependencies.puppeteer === overrides.targetDevDependencies.puppeteer, "Puppeteer manifest patch failed.");
  assert(manifest.devDependencies.vite === overrides.targetDevDependencies.vite, "Vite manifest patch failed.");

  const manifestTemp = manifestPath + ".ultron-patch.tmp";
  const lockTemp = lockPath + ".ultron-patch.tmp";
  writeFileSync(manifestTemp, JSON.stringify(manifest, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
  try {
    writeFileSync(lockTemp, JSON.stringify(lock, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
    renameSync(manifestTemp, manifestPath);
    renameSync(lockTemp, lockPath);
  } catch (error) {
    // If the second staged file could not be created, remove the first staging
    // file; the original package files remain unchanged until rename begins.
    try { renameSync(manifestTemp, manifestPath + ".ultron-patch.failed"); } catch {}
    try { renameSync(lockTemp, lockPath + ".ultron-patch.failed"); } catch {}
    throw error;
  }

  return {
    project: manifest.name,
    pinnedSourceVersion: manifest.version,
    devDependencies: overrides.targetDevDependencies,
    updatedLockEntries: Object.keys(overrides.packageLockUpdates).length,
    removedLockEntries: overrides.packageLockRemovals.map(item => item.path)
  };
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  try {
    const result = patchWorldIntelligenceDependencies(process.argv[2]);
    process.stdout.write("Applied reviewed dependency lock patch: " + JSON.stringify(result) + "\n");
  } catch (error) {
    process.stderr.write("World Intelligence dependency patch failed closed: " + error.message + "\n");
    process.exitCode = 1;
  }
}
