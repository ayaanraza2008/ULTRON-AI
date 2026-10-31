import test from "node:test";
import assert from "node:assert/strict";
import { CyberReconEngine } from "../security/cyber-recon.js";

test("Cyber Recon: Passive reconnaissance resolves DNS genuinely on authorized target", async () => {
  const recon = new CyberReconEngine();
  const report = await recon.performRecon("localhost", {
    headers: {
      server: "Express",
      "x-powered-by": "Node.js"
    }
  });

  assert.equal(report.target, "localhost");
  assert.equal(report.dnsSummary.status, "RESOLVED");
  assert.ok(["127.0.0.1", "::1"].includes(report.dnsSummary.ip));
  assert.ok(report.fingerprint.detectedStack.some(s => s.includes("Express")));
  assert.equal(report.attackSurface.exposedEndpointsCount, 0); // No fabricated open ports
});

test("Cyber Recon: Rejects unresolvable or out-of-scope targets", async () => {
  const recon = new CyberReconEngine();
  await assert.rejects(
    () => recon.performRecon("unauthorized-malicious-domain.evil"),
    /TARGET_OUT_OF_SCOPE/
  );
});
