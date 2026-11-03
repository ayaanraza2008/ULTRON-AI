import test from "node:test";
import assert from "node:assert/strict";
import { ForgeEngine } from "../forge/forge-engine.js";

test("ForgeEngine: analyzes repository files, languages, and symbol counts", () => {
  const forge = new ForgeEngine();
  const repoFiles = {
    "server.js": "import express from 'express';\nexport const app = express();\napp.listen(3000);",
    "helper.py": "def add(x, y):\n    return x + y\n",
    "README.md": "# Project Title\nDocumentation text."
  };

  const analysis = forge.analyzeRepository(repoFiles);
  assert.equal(analysis.totalFiles, 3);
  assert.ok(analysis.totalLinesOfCode >= 5);
  assert.ok(analysis.languages.js);
  assert.ok(analysis.languages.py);
  assert.ok(analysis.fileIndex["server.js"]);
  assert.equal(analysis.fileIndex["server.js"].exports.includes("app"), true);
});

test("ForgeEngine: generates paired implementation code and unit tests", () => {
  const forge = new ForgeEngine();
  const pair = forge.generateCodeWithTests({ name: "math_util", functionName: "multiply" });

  assert.equal(pair.codeFilename, "math_util.js");
  assert.equal(pair.testFilename, "math_util.test.js");
  assert.ok(pair.code.includes("export function multiply"));
  assert.ok(pair.testCode.includes("assert.equal"));
});

test("ForgeEngine: security analyzer detects hardcoded secrets and command injection", () => {
  const forge = new ForgeEngine();

  // Insecure snippet
  const vulnerableCode = `
    const apiKey = ["sk", "live", "1234567890abcdef1234"].join("-");
    const cmd = "rm -rf " + userInput;
    exec(cmd);
  `;
  const secReport = forge.analyzeSecurity(vulnerableCode);
  assert.equal(secReport.secure, false);
  assert.ok(secReport.findings.some(f => f.id === "HARDCODED_SECRET"));
  assert.ok(secReport.findings.some(f => f.id === "COMMAND_INJECTION"));

  // Secure snippet
  const safeCode = `
    const port = process.env.PORT || 3000;
    export function getPort() { return port; }
  `;
  const safeReport = forge.analyzeSecurity(safeCode);
  assert.equal(safeReport.secure, true);
  assert.equal(safeReport.findingsCount, 0);
});

test("ForgeEngine: iterative debugger loop executes patches until tests pass", async () => {
  const forge = new ForgeEngine();

  let state = "broken";
  const runner = async () => {
    if (state === "broken") throw new Error("AssertionError: expected true but got false");
    return { testsPassed: 10 };
  };

  const patcher = async (errMsg, attempt) => {
    if (attempt === 1) {
      state = "fixed";
    }
  };

  const result = await forge.runIterativeDebugger(runner, patcher, 3);
  assert.equal(result.success, true);
  assert.equal(result.totalAttempts, 2);
  assert.equal(result.history[0].status, "failed");
  assert.equal(result.history[1].status, "passed");
});

test("ForgeEngine: snapshot and automated rollback manager restores baseline state", () => {
  const forge = new ForgeEngine();
  const baselineState = {
    "config.json": '{"version": "1.0.0"}',
    "index.js": 'console.log("stable");'
  };

  forge.createSnapshot("snap-v1", baselineState);

  // Perform rollback
  const restored = forge.rollbackToSnapshot("snap-v1");
  assert.equal(restored.success, true);
  assert.equal(restored.fileCount, 2);
  assert.equal(restored.files["config.json"], '{"version": "1.0.0"}');
});

test("ForgeEngine: prepares pull request metadata and conventional specification", () => {
  const forge = new ForgeEngine();
  const pr = forge.preparePullRequest({
    scope: "autonomy",
    title: "integrate goal decomposition and verification DAG",
    changes: ["Created UltronAutonomy engine", "Added 5 unit tests"]
  });

  assert.ok(pr.title.startsWith("feat(autonomy):"));
  assert.ok(pr.body.includes("ULTRON AI Autonomous Pull Request"));
  assert.ok(pr.body.includes("Testing & Verification"));
  assert.equal(pr.targetBranch, "main");
});
