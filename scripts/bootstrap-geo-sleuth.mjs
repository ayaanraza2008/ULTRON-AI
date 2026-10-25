import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const execFile = promisify(execFileCallback);
const GEO_SLEUTH_REPOSITORY = "https://github.com/Oldcircle/geo-sleuth.git";
const GEO_SLEUTH_COMMIT = "e01849f778afeb7c53ca79331313fbcfcb879486";
const UV_VERSION = "0.13.5";
const UV_INSTALLER_SHA256 = "1c6e7f025499664633ac2dce43a210800510e9ef0625c52e034a8afdf8bf177a";
const UV_INSTALLER_URL = `https://releases.astral.sh/github/uv/releases/download/${UV_VERSION}/uv-installer.sh`;

export async function ensureGeoSleuthRuntime({ env = process.env, runCommand = execFile, log = console.warn, uvInstallerSha256 = UV_INSTALLER_SHA256 } = {}) {
  if (env.GEO_SLEUTH_ENABLED !== "true") return { state: "disabled" };
  const root = path.resolve(env.GEO_SLEUTH_ROOT || path.join(process.cwd(), ".runtime", "geo-sleuth", "skills", "geo-sleuth"));
  const scriptsExist = () => existsSync(path.join(root, "scripts", "intake.py")) && existsSync(path.join(root, "scripts", "board.py"));
  if (scriptsExist()) return { state: "source_present", root };

  // Render's Dashboard build command can override render.yaml. Bootstrap only the
  // pinned source when absent; never replace or delete a pre-existing runtime.
  const repositoryRoot = path.resolve(root, "..", "..");
  if (existsSync(repositoryRoot)) {
    log("Geo-Sleuth source is missing and its configured repository directory already exists; refusing to overwrite it.");
    return { state: "blocked_existing_directory", root };
  }

  const temporaryParent = path.dirname(repositoryRoot);
  let temporaryClone;
  try {
    await mkdir(temporaryParent, { recursive: true });
    temporaryClone = await mkdtemp(path.join(temporaryParent, ".geo-sleuth-bootstrap-"));
    const clonePath = path.join(temporaryClone, "repo");
    await runCommand("git", ["clone", "--filter=blob:none", GEO_SLEUTH_REPOSITORY, clonePath], { timeout: 120000, maxBuffer: 1024 * 1024, windowsHide: true });
    await runCommand("git", ["-C", clonePath, "checkout", GEO_SLEUTH_COMMIT], { timeout: 30000, maxBuffer: 1024 * 1024, windowsHide: true });
    if (!existsSync(path.join(clonePath, "skills", "geo-sleuth", "scripts", "intake.py")) ||
        !existsSync(path.join(clonePath, "skills", "geo-sleuth", "scripts", "board.py"))) {
      throw new Error("Pinned Geo-Sleuth source is missing expected scripts.");
    }
    // Rename only after the pinned checkout passes validation.
    const { rename } = await import("node:fs/promises");
    await rename(clonePath, repositoryRoot);
  } catch (error) {
    log("Geo-Sleuth runtime bootstrap failed; ULTRON will start with this integration unavailable: " + String(error?.message || error).slice(0, 300));
    return { state: "bootstrap_failed", root };
  } finally {
    if (temporaryClone) await rm(temporaryClone, { recursive: true, force: true }).catch(() => {});
  }

  const localBin = path.join(os.homedir(), ".local", "bin");
  const uvExecutable = path.join(localBin, process.platform === "win32" ? "uv.exe" : "uv");
  try {
    if (existsSync(uvExecutable)) {
      await runCommand(uvExecutable, ["--version"], { timeout: 10000, maxBuffer: 256 * 1024, windowsHide: true });
    } else {
      await runCommand("uv", ["--version"], { timeout: 10000, maxBuffer: 256 * 1024, windowsHide: true });
    }
  } catch {
    let installerDirectory;
    let installer;
    try {
      // Use a unique temporary directory rather than a predictable shared /tmp path,
      // and download a versioned release asset over HTTPS before executing it.
      installerDirectory = await mkdtemp(path.join(os.tmpdir(), "ultron-uv-installer-"));
      installer = path.join(installerDirectory, "uv-installer.sh");
      await runCommand("curl", [
        "--proto", "=https", "--proto-redir", "=https", "--tlsv1.2",
        "--max-time", "30", "--max-filesize", "1048576",
        "-LsSf", UV_INSTALLER_URL, "-o", installer
      ], { timeout: 30000, maxBuffer: 256 * 1024, windowsHide: true });
      const installerDigest = createHash("sha256").update(await readFile(installer)).digest("hex");
      if (installerDigest !== uvInstallerSha256) {
        throw new Error("uv installer SHA-256 verification failed.");
      }
      await runCommand("sh", [installer], { timeout: 60000, maxBuffer: 1024 * 1024, windowsHide: true });
    } catch (error) {
      log("Geo-Sleuth source is present but uv could not be installed; integration remains unavailable: " + String(error?.message || error).slice(0, 300));
      return { state: "source_present_uv_missing", root };
    } finally {
      if (installerDirectory) await rm(installerDirectory, { recursive: true, force: true }).catch(() => {});
    }
  }

  return { state: scriptsExist() ? "source_present" : "bootstrap_failed", root };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  await ensureGeoSleuthRuntime();
}
