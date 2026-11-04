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
  assert.equal(report.fingerprint.evidenceStatus, "CALLER_SUPPLIED_HEADERS");
  assert.equal(report.attackSurface.exposedEndpointsCount, 0); // No fabricated open ports
  assert.equal(report.attackSurface.status, "NOT_SCANNED");
  assert.equal(report.tlsStatus.status, "NOT_CHECKED");
  assert.equal(report.tlsStatus.certificateStatus, "NOT_VERIFIED");
  assert.equal(report.tlsStatus.tlsVersion, null);
});

test("Cyber Recon: Caller-supplied ports and certificates remain explicitly unverified", async () => {
  const recon = new CyberReconEngine();
  const report = await recon.performRecon("localhost", {
    openPorts: [80, 443, 443, 0, 65536, "3000"],
    tlsCert: { subject: "CN=localhost", validTo: "2099-01-01" }
  });

  assert.equal(report.attackSurface.status, "UNVERIFIED_INPUT");
  assert.equal(report.attackSurface.exposedEndpointsCount, 0);
  assert.equal(report.attackSurface.reportedEndpointsCount, 2);
  assert.deepEqual(report.attackSurface.identifiedServices, [
    { port: 80, state: "UNVERIFIED", evidenceSource: "CALLER_SUPPLIED" },
    { port: 443, state: "UNVERIFIED", evidenceSource: "CALLER_SUPPLIED" }
  ]);
  assert.equal(report.tlsStatus.status, "UNVERIFIED_INPUT");
  assert.equal(report.tlsStatus.certificateStatus, "NOT_VERIFIED");
  assert.equal(report.tlsStatus.tlsVersion, null);
  assert.equal(report.tlsStatus.validUntil, null);
  assert.equal(report.fingerprint.evidenceStatus, "NOT_PROVIDED");
  assert.deepEqual(report.fingerprint.detectedStack, ["No header evidence supplied"]);
});

test("Cyber Recon: Rejects unresolvable or out-of-scope targets", async () => {
  const recon = new CyberReconEngine();
  await assert.rejects(
    () => recon.performRecon("unauthorized-malicious-domain.evil"),
    /TARGET_OUT_OF_SCOPE/
  );
});
