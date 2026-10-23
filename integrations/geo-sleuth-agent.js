import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const execFile = promisify(execFileCallback);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function decodeImage(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  let mime = "image/jpeg";
  let encoded = value.trim();
  const dataUri = encoded.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\r\n]+)$/i);
  if (dataUri) {
    mime = dataUri[1].toLowerCase();
    encoded = dataUri[2].replace(/\s/g, "");
  } else {
    if (!/^[A-Za-z0-9+/=\r\n]+$/.test(encoded)) return null;
    encoded = encoded.replace(/\s/g, "");
  }
  const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
  if (!allowed.has(mime) || encoded.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 8) return null;
  const bytes = Buffer.from(encoded, "base64");
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) return null;
  const valid =
    (mime === "image/jpeg" && bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) ||
    (mime === "image/png" && bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) ||
    (mime === "image/webp" && bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP");
  if (!valid) return null;
  return { bytes, extension: mime === "image/jpeg" ? ".jpg" : mime === "image/png" ? ".png" : ".webp" };
}

function safeEnv(env) {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    USERPROFILE: process.env.USERPROFILE,
    LOCALAPPDATA: process.env.LOCALAPPDATA,
    PYTHONUNBUFFERED: "1",
    GEO_DEVICE: "cpu"
  };
}

export async function runGeoSleuthInvestigation({
  imageBase64,
  includeReverseSearch = false,
  env = process.env,
  runCommand = execFile
} = {}) {
  if (env.GEO_SLEUTH_ENABLED !== "true") {
    return { state: "blocked", code: "GEO_SLEUTH_DISABLED", message: "Geo-Sleuth is disabled on this deployment." };
  }
  const image = decodeImage(imageBase64);
  if (!image) {
    return { state: "needs_input", code: "GEO_SLEUTH_IMAGE_INVALID", message: "Attach a valid JPEG, PNG, or WebP image (maximum 8 MB) so ULTRON can investigate it." };
  }
  const root = path.resolve(env.GEO_SLEUTH_ROOT || path.join(process.cwd(), ".runtime", "geo-sleuth", "skills", "geo-sleuth"));
  const uvBin = typeof env.GEO_SLEUTH_UV_BIN === "string" && env.GEO_SLEUTH_UV_BIN.trim() ? env.GEO_SLEUTH_UV_BIN.trim() : "uv";
  const workspace = await mkdtemp(path.join(os.tmpdir(), "ultron-geo-sleuth-agent-"));
  const photoPath = path.join(workspace, "photo" + image.extension);
  const intakeDir = path.join(workspace, "intake");
  const boardDir = path.join(workspace, "board");
  const stages = [];
  async function runStage(stage, args, timeout = 180000) {
    try {
      const result = await runCommand(uvBin, ["run", ...args], {
        cwd: root,
        timeout,
        maxBuffer: 3 * 1024 * 1024,
        windowsHide: true,
        env: safeEnv(env),
        // The board state and generated artifacts live in the unique workspace.
        // uv runs from the skill root for imports, so board commands use explicit --state where supported.
      });
      stages.push({ stage, state: "completed", stdout: String(result?.stdout || "").slice(0, 8000), stderr: String(result?.stderr || "").slice(0, 2000) });
      return { ok: true, result };
    } catch (error) {
      const timedOut = error?.code === "ETIMEDOUT" || error?.killed;
      stages.push({ stage, state: timedOut ? "timed_out" : "failed", error: timedOut ? "Stage exceeded its time limit." : "Stage failed; see safe error summary.", detail: String(error?.stderr || error?.message || "").slice(0, 1500) });
      return { ok: false, timedOut };
    }
  }
  try {
    await mkdir(intakeDir, { recursive: true });
    await mkdir(boardDir, { recursive: true });
    await writeFile(photoPath, image.bytes, { mode: 0o600, flag: "wx" });

    const intakeArgs = ["scripts/intake.py", photoPath, "--out-dir", intakeDir];
    if (!includeReverseSearch) intakeArgs.push("--no-rev");
    const intake = await runStage("intake", intakeArgs, 10 * 60 * 1000);
    if (!intake.ok) return { state: intake.timedOut ? "timed_out" : "failed", provider: "geo-sleuth", stages, note: "No location conclusion was produced." };

    let intakeReport = "";
    try { intakeReport = await readFile(path.join(intakeDir, "intake.md"), "utf8"); }
    catch { return { state: "failed", provider: "geo-sleuth", stages, error: "Intake completed without intake.md; no location conclusion is available." }; }

    // Start a separate candidate board in the isolated workspace. Geo-Sleuth's
    // board CLI supports --state so independent user investigations cannot collide.
    const init = await runStage("candidate_board_init", ["scripts/board.py", "--board", path.join(boardDir, "board.json"), "init", "--photo", photoPath], 120000);
    if (init.ok) {
      await runStage("candidate_board_next", ["scripts/board.py", "--board", path.join(boardDir, "board.json"), "next"], 120000);
      await runStage("candidate_board_check", ["scripts/board.py", "--board", path.join(boardDir, "board.json"), "check"], 120000);
      await runStage("candidate_board_report", ["scripts/board.py", "--board", path.join(boardDir, "board.json"), "report", "--merge", path.join(boardDir, "result.json")], 120000);
    }

    let boardReport = "";
    try { boardReport = await readFile(path.join(boardDir, "result.json"), "utf8"); } catch {}
    const allStagesSucceeded = stages.every(s => s.state === "completed");
    return {
      provider: "geo-sleuth",
      state: allStagesSucceeded ? "completed_initial_investigation" : "partial",
      execution: "autonomous_bounded_investigation",
      stages,
      intake: intakeReport.slice(0, 24000),
      intakeTruncated: intakeReport.length > 24000,
      candidateBoard: boardReport ? boardReport.slice(0, 12000) : null,
      reverseImageSearchEnabled: includeReverseSearch === true,
      conclusion: "This automated run prepares intake evidence and starts the candidate-board workflow. It must not claim a verified location or precision radius unless actual geometry, imagery matches, and evidence checks have completed.",
      nextActions: ["Review OCR and metadata clues", "Generate and compare candidate locations", "Run relevant OSM/terrain/satellite or street-view checks", "Run board.py check before any precision claim"]
    };
  } finally {
    await rm(workspace, { recursive: true, force: true }).catch(() => {});
  }
}
