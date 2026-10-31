import test from "node:test";
import assert from "node:assert/strict";
import {
  filterGitDiff,
  filterGitStatus,
  filterGitLog,
  filterGrep,
  filterDirectoryListing,
  smartTruncate,
  compactContent,
  applyPromptShaping,
  optimizePayload,
  getCumulativeSavings,
  resetCumulativeSavings,
  describeSavings,
  formatBytes,
} from "../integrations/dsh-god/token-optimizer.js";

test("DSH Token Optimizer: RTK gitDiff compacts hunks while preserving file headers and counts", () => {
  const sampleDiff = `diff --git a/src/index.js b/src/index.js
index 1234567..89abcdef 100644
--- a/src/index.js
+++ b/src/index.js
@@ -1,5 +1,6 @@
 import express from 'express';
+import cors from 'cors';
 const app = express();
`;
  const compacted = filterGitDiff(sampleDiff, 50);
  assert.ok(compacted.includes("src/index.js"));
  assert.ok(compacted.includes("+1 -0"));
  assert.ok(compacted.includes("import cors from 'cors';"));
});

test("DSH Token Optimizer: RTK gitStatus compacts status entries into counts", () => {
  const sampleStatus = `On branch main
Changes to be committed:
  (use "git restore --staged <file>..." to unstage)
	new file:   src/new-feature.js

Changes not staged for commit:
	modified:   server.js

Untracked files:
	temp.log
`;
  const compacted = filterGitStatus(sampleStatus);
  assert.ok(compacted.includes("branch: main"));
  assert.ok(compacted.includes("Staged: 1 files"));
  assert.ok(compacted.includes("Modified: 1 files"));
  assert.ok(compacted.includes("Untracked: 1 files"));
});

test("DSH Token Optimizer: RTK gitLog compacts commits and preserves subject lines", () => {
  const sampleLog = `commit 1234567890abcdef1234567890abcdef12345678
Author: Developer <dev@example.com>
Date:   Sat Oct 31 20:00:00 2026 +0530

    feat: integrate DSH-GOD capabilities into ULTRON

    Detailed multi-line explanation of changes that takes up too many tokens...
`;
  const compacted = filterGitLog(sampleLog, 50);
  assert.ok(compacted.includes("commit 1234567890abcdef"));
  assert.ok(compacted.includes("Subject: feat: integrate DSH-GOD capabilities into ULTRON"));
});

test("DSH Token Optimizer: RTK filterDirectoryListing strips noise directories", () => {
  const sampleLs = `node_modules/express/index.js\nnode_modules/express/package.json\nsrc/app.js\n__pycache__/temp.pyc\n`;
  const compacted = filterDirectoryListing(sampleLs);
  assert.ok(!compacted.includes("node_modules/express"));
  assert.ok(!compacted.includes("__pycache__"));
  assert.ok(compacted.includes("src/app.js"));
  assert.ok(compacted.includes("omitted 3 noise directory entries"));
});

test("DSH Token Optimizer: smartTruncate preserves head and tail lines with truncation notice", () => {
  const lines = Array.from({ length: 300 }, (_, i) => `Line ${i + 1}: Some long output statement`).join("\n");
  const truncated = smartTruncate(lines, 20, 10);
  const truncLines = truncated.split("\n");
  assert.ok(truncLines.length < 50);
  assert.ok(truncated.includes("Line 1:"));
  assert.ok(truncated.includes("Line 300:"));
  assert.ok(truncated.includes("lines truncated for token efficiency"));
});

test("DSH Token Optimizer: prompt shaping injects Caveman and Ponytail directives", () => {
  const messages = [{ role: "user", content: "Explain quantum computing." }];
  const shapedCaveman = applyPromptShaping(messages, "caveman");
  assert.ok(shapedCaveman[0].content.includes("High information density"));

  const shapedPonytail = applyPromptShaping(messages, "ponytail");
  assert.ok(shapedPonytail[0].content.includes("Architecture-first"));
});

test("DSH Token Optimizer: tracks cumulative token savings and formats bytes", () => {
  resetCumulativeSavings();

  const longDiff = `diff --git a/file.js b/file.js\n@@ -1,5 +1,5 @@\n` +
    Array.from({ length: 50 }, (_, i) => `+added line ${i}`).join("\n");

  const payload = {
    model: "opencode:deepseek-chat",
    messages: [
      { role: "user", content: "Review this diff:\n" + longDiff }
    ]
  };

  const opt = optimizePayload(payload);
  assert.ok(opt.payload);
  assert.ok(opt.stats.bytesBefore > 0);

  const cum = getCumulativeSavings();
  assert.equal(cum.calls, 1);
  assert.ok(describeSavings().includes("Token Optimizer"));

  assert.equal(formatBytes(500), "500 B");
  assert.equal(formatBytes(2048), "2.0 KB");
  assert.equal(formatBytes(1048576 * 3), "3.00 MB");
});
