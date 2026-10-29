#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { startVideoStudioServer } from "../video-studio/server.mjs";

// A small local-only .env loader avoids adding a runtime dependency. Shell/service
// variables win over .env; multiline values and shell interpolation are unsupported.
async function loadLocalEnv(filename = path.resolve(process.cwd(), ".env")) {
  let raw = "";
  try { raw = await fs.readFile(filename, "utf8"); }
  catch (error) { if (error && error.code === "ENOENT") return; throw error; }
  for (const line of raw.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const valueLine = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
    const eq = valueLine.indexOf("=");
    if (eq <= 0) continue;
    const key = valueLine.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key] !== undefined) continue;
    let value = valueLine.slice(eq + 1).trim();
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, "").trim();
    process.env[key] = value;
  }
}
await loadLocalEnv();
startVideoStudioServer();
