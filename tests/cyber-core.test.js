import test from "node:test";
import assert from "node:assert/strict";
import { UltronCyberCore, CYBER_AGENTS } from "../security/cyber-core.js";

test("Cyber Core: Registers all 13 specialized cybersecurity agents", () => {
  const core = new UltronCyberCore();
  const agents = core.getAgentsStatus();

  assert.equal(agents.length, 13);
  assert.ok(agents.some(a => a.name === "CYBER-RECON"));
  assert.ok(agents.some(a => a.name === "CYBER-SCANNER"));
  assert.ok(agents.some(a => a.name === "CYBER-PENTEST"));
  assert.ok(agents.some(a => a.name === "CYBER-WEB"));
  assert.ok(agents.some(a => a.name === "CYBER-NETWORK"));
  assert.ok(agents.some(a => a.name === "CYBER-CODE"));
  assert.ok(agents.some(a => a.name === "CYBER-CLOUD"));
  assert.ok(agents.some(a => a.name === "CYBER-IDENTITY"));
  assert.ok(agents.some(a => a.name === "CYBER-AI"));
  assert.ok(agents.some(a => a.name === "CYBER-THREAT"));
  assert.ok(agents.some(a => a.name === "CYBER-INCIDENT"));
  assert.ok(agents.some(a => a.name === "CYBER-REMEDIATION"));
  assert.ok(agents.some(a => a.name === "CYBER-AUDITOR"));
});

test("Cyber Core: Executes comprehensive multi-agent security mission on authorized target", async () => {
  const core = new UltronCyberCore();

  const mission = await core.executeComprehensiveMission("localhost", {
    webHeaders: {
      "server": "Node/20",
      "x-powered-by": "Express"
    },
    sourceCode: `
      function testExec(userInput) {
        require('child_process').exec("ping " + userInput);
      }
    `,
    includeAiRedTeam: true
  });

  assert.equal(mission.status, "COMPLETED");
  assert.equal(mission.target, "localhost");
  assert.ok(mission.totalFindings >= 1);
  assert.ok(mission.reports.markdown.includes("ULTRON CYBER CORE — SECURITY MISSION REPORT"));
  assert.ok(mission.reports.html.includes("<!DOCTYPE html>"));
  assert.ok(mission.remediations.length >= 1);
  assert.ok(mission.recon.fingerprint.detectedStack.length >= 1);
});

test("Cyber Core: Rejects mission execution on out-of-scope unauthorized target", async () => {
  const core = new UltronCyberCore();

  await assert.rejects(
    () => core.executeComprehensiveMission("unauthorized-bank-target.com"),
    /TARGET_OUT_OF_SCOPE/
  );
});
