import express from "express";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const execFile = promisify(execFileCallback);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

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
  if (!ALLOWED_MIME.has(mime) || encoded.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 8) return null;
  const bytes = Buffer.from(encoded, "base64");
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES || bytes.toString("base64").replace(/=+$/, "") !== encoded.replace(/=+$/, "")) return null;
  const signatureOk =
    (mime === "image/jpeg" && bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) ||
    (mime === "image/png" && bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) ||
    (mime === "image/webp" && bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP");
  return signatureOk ? { mime, bytes, extension: mime === "image/jpeg" ? ".jpg" : mime === "image/png" ? ".png" : ".webp" } : null;
}

export function createGeoSleuthRouter({ env = process.env, requireSupabaseUser, runCommand = execFile } = {}) {
  const router = express.Router();

  router.get("/integrations/geo-sleuth/status", requireSupabaseUser, (_req, res) => {
    const root = path.resolve(env.GEO_SLEUTH_ROOT || path.join(process.cwd(), ".runtime", "geo-sleuth", "skills", "geo-sleuth"));
    res.setHeader("Cache-Control", "no-store");
    res.json({
      provider: "geo-sleuth",
      enabled: env.GEO_SLEUTH_ENABLED === "true",
      installedPathConfigured: Boolean(env.GEO_SLEUTH_ROOT),
      execution: "local-python-cli",
      reverseImageSearch: "opt-in-per-request",
      verified: false,
      note: env.GEO_SLEUTH_ENABLED === "true" ? "Configuration is enabled; run a photo intake to verify runtime dependencies." : "Set GEO_SLEUTH_ENABLED=true and install the pinned geo-sleuth source during build."
    });
  });

  router.post("/integrations/geo-sleuth/intake", requireSupabaseUser, async (req, res) => {
    if (env.GEO_SLEUTH_ENABLED !== "true") {
      return res.status(503).json({ error: { code: "GEO_SLEUTH_DISABLED", message: "Geo-Sleuth is not enabled on this ULTRON deployment." } });
    }
    const image = decodeImage(req.body?.imageBase64);
    if (!image) {
      return res.status(400).json({ error: { code: "GEO_SLEUTH_IMAGE_INVALID", message: "Provide a valid JPEG, PNG, or WebP image as base64 or a base64 data URI (max 8 MB)." } });
    }
    const root = path.resolve(env.GEO_SLEUTH_ROOT || path.join(process.cwd(), ".runtime", "geo-sleuth", "skills", "geo-sleuth"));
    const uvBin = typeof env.GEO_SLEUTH_UV_BIN === "string" && env.GEO_SLEUTH_UV_BIN.trim() ? env.GEO_SLEUTH_UV_BIN.trim() : "uv";
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ultron-geo-sleuth-"));
    const outputDir = path.join(workspace, "intake");
    const photoPath = path.join(workspace, "photo" + image.extension);
    try {
      await mkdir(outputDir, { recursive: true });
      await writeFile(photoPath, image.bytes, { mode: 0o600, flag: "wx" });
      const args = ["run", "scripts/intake.py", photoPath, "--out-dir", outputDir];
      // Reverse-image providers may receive image-derived queries or crops. Keep them off unless the caller opts in.
      if (req.body?.includeReverseSearch !== true) args.push("--no-rev");
      let commandResult = { stdout: "", stderr: "" };
      try {
        commandResult = await runCommand(uvBin, args, {
          cwd: root,
          timeout: 8 * 60 * 1000,
          maxBuffer: 2 * 1024 * 1024,
          windowsHide: true,
          env: { ...process.env, ...env, PYTHONUNBUFFERED: "1" }
        });
      } catch (error) {
        const timedOut = error?.code === "ETIMEDOUT" || error?.killed;
        return res.status(timedOut ? 504 : 502).json({
          error: {
            code: timedOut ? "GEO_SLEUTH_TIMEOUT" : "GEO_SLEUTH_EXECUTION_FAILED",
            message: timedOut ? "Geo-Sleuth intake exceeded its 8-minute limit." : "Geo-Sleuth could not complete intake. Check Python/uv dependencies and runtime logs."
          }
        });
      }
      let report;
      try { report = await readFile(path.join(outputDir, "intake.md"), "utf8"); }
      catch {
        return res.status(502).json({ error: { code: "GEO_SLEUTH_REPORT_MISSING", message: "Geo-Sleuth finished without producing intake.md; no location conclusion is available." } });
      }
      const { stdout = "", stderr = "" } = commandResult || {};
      return res.json({
        provider: "geo-sleuth",
        stage: "intake",
        status: "completed",
        report: report.slice(0, 30000),
        reportTruncated: report.length > 30000,
        reverseImageSearchEnabled: req.body?.includeReverseSearch === true,
        executionLog: (stdout || stderr).slice(0, 2000),
        note: "Intake is evidence preparation, not a verified camera-location conclusion. Continue with the candidate board and geometry checks; do not infer coordinates from intake alone."
      });
    } catch {
      return res.status(500).json({ error: { code: "GEO_SLEUTH_RUNTIME_ERROR", message: "Geo-Sleuth could not prepare the local workspace." } });
    } finally {
      await rm(workspace, { recursive: true, force: true }).catch(() => {});
    }
  });

  return router;
}
