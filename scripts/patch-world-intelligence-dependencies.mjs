import { copyFileSync, readFileSync, renameSync, rmSync, writeFileSync, constants as fsConstants } from "node:fs";
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
const defaultFileOperations = { copyFileSync, readFileSync, renameSync, rmSync, writeFileSync };

export function patchWorldIntelligenceDependencies(targetDirectory, fileOperations = defaultFileOperations) {
  assert(typeof targetDirectory === "string" && targetDirectory.trim(), "Provide the cloned World Intelligence directory.");
  const root = path.resolve(targetDirectory);
  const manifestPath = path.join(root, "package.json");
  const lockPath = path.join(root, "package-lock.json");
  const manifest = JSON.parse(fileOperations.readFileSync(manifestPath, "utf8"));
  const lock = JSON.parse(fileOperations.readFileSync(lockPath, "utf8"));
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
  const manifestBackup = manifestPath + ".ultron-patch.bak";
  const lockBackup = lockPath + ".ultron-patch.bak";
  let manifestBackupCreated = false;
  let lockBackupCreated = false;
  let manifestReplaced = false;
  let lockReplaced = false;

  try {
    // Stage both complete files and preserve both originals before replacing
    // either one. Exclusive backups prevent overwriting recovery files.
    fileOperations.writeFileSync(manifestTemp, JSON.stringify(manifest, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
    fileOperations.writeFileSync(lockTemp, JSON.stringify(lock, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
    fileOperations.copyFileSync(manifestPath, manifestBackup, fsConstants.COPYFILE_EXCL);
    manifestBackupCreated = true;
    fileOperations.copyFileSync(lockPath, lockBackup, fsConstants.COPYFILE_EXCL);
    lockBackupCreated = true;

    fileOperations.renameSync(manifestTemp, manifestPath);
    manifestReplaced = true;
    fileOperations.renameSync(lockTemp, lockPath);
    lockReplaced = true;
  } catch (error) {
    const recoveryErrors = [];
    if (manifestBackupCreated) {
      try {
        if (manifestReplaced) {
          fileOperations.rmSync(manifestPath, { force: true });
          fileOperations.renameSync(manifestBackup, manifestPath);
        } else {
          fileOperations.rmSync(manifestBackup, { force: true });
        }
      } catch (restoreError) {
        recoveryErrors.push(restoreError);
      }
    }
    if (lockBackupCreated) {
      try {
        if (lockReplaced) {
          fileOperations.rmSync(lockPath, { force: true });
          fileOperations.renameSync(lockBackup, lockPath);
        } else {
          fileOperations.rmSync(lockBackup, { force: true });
        }
      } catch (restoreError) {
        recoveryErrors.push(restoreError);
      }
    }
    if (recoveryErrors.length) {
      throw new AggregateError(
        [error, ...recoveryErrors],
        "Dependency patch failed and rollback requires manual recovery; preserve any .ultron-patch.bak files."
      );
    }
    throw error;
  } finally {
    fileOperations.rmSync(manifestTemp, { force: true });
    fileOperations.rmSync(lockTemp, { force: true });
  }

  fileOperations.rmSync(manifestBackup, { force: true });
  fileOperations.rmSync(lockBackup, { force: true });

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
