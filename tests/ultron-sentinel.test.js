import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { createJarvisRouter } from "../jarvis-router.js";
import { ultronSentinel, SCAN_STATUS, RISK_SEVERITY } from "../security/sentinel/ultron-sentinel.js";
import { cveDatabase, parseServiceBanner, compareVersions, isVersionAffected } from "../security/sentinel/cve-database.js";
import { hardwareAdapter, PLATFORM_TYPES } from "../security/sentinel/hardware-adapter.js";
import { NetworkDiscoveryEngine } from "../security/sentinel/network-discovery.js";
import { SentinelAgent } from "../security/sentinel/sentinel-agent.js";
import { SentinelMemory } from "../security/sentinel/sentinel-memory.js";
import { SentinelMonitor } from "../security/sentinel/sentinel-monitor.js";
import { targetAuthorizationGateway } from "../security/target-authorization-gateway.js";

async function withSentinelRouter({ env = { ULTRON_INTEGRATION_OWNER_USER_ID: "owner-user" }, userId = "owner-user" } = {}, run) {
  const app = express();
  const requireSupabaseUser = (req, _res, next) => {
    if (userId) {
      req.supabaseUser = { id: userId };
    }
    next();
  };
  app.use(express.json());
  app.use("/api", createJarvisRouter({ env, requireSupabaseUser }));
  const server = createServer(app);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  try {
    await run("http://127.0.0.1:" + address.port);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test("CVE Database: accurate version comparison and range matching", () => {
  assert.equal(compareVersions("8.5p1", "8.5p1"), 0);
  assert.equal(compareVersions("8.9p1", "8.5p1"), 1);
  assert.equal(compareVersions("8.4p1", "8.5p1"), -1);
  assert.equal(compareVersions("9.8p1", "9.7p1"), 1);

  // regreSSHion range: >=8.5p1 <=9.7p1
  const sshRange = ">=8.5p1 <=9.7p1";
  assert.equal(isVersionAffected("8.9p1", sshRange), true);
  assert.equal(isVersionAffected("9.7p1", sshRange), true);
  assert.equal(isVersionAffected("8.5p1", sshRange), true);
  assert.equal(isVersionAffected("8.4p1", sshRange), false);
  assert.equal(isVersionAffected("9.8p1", sshRange), false);

  // Apache CVE-2021-42013 exact version: =2.4.50
  assert.equal(isVersionAffected("2.4.50", "=2.4.50"), true);
  assert.equal(isVersionAffected("2.4.51", "=2.4.50"), false);
  assert.equal(isVersionAffected("2.4.49", "=2.4.50"), false);

  // Redis CVE-2022-0543: <=6.2.6
  assert.equal(isVersionAffected("6.2.6", "<=6.2.6"), true);
  assert.equal(isVersionAffected("6.0.9", "<=6.2.6"), true);
  assert.equal(isVersionAffected("7.0.0", "<=6.2.6"), false);
});

test("CVE Database: banner parsing and vulnerability correlation", () => {
  const sshBanner = parseServiceBanner("SSH-2.0-OpenSSH_8.9p1 Ubuntu-3ubuntu0.7");
  assert.equal(sshBanner.name, "openssh");
  assert.equal(sshBanner.version, "8.9p1");

  const apacheBanner = parseServiceBanner("Apache/2.4.50 (Unix)");
  assert.equal(apacheBanner.name, "apache");
  assert.equal(apacheBanner.version, "2.4.50");

  const findings = cveDatabase.matchVulnerabilities({
    service: "ssh",
    product: "openssh",
    version: "8.9p1",
    port: 22
  });

  assert.ok(findings.length >= 1);
  const regreSSHion = findings.find(f => f.cveId === "CVE-2024-6387");
  assert.ok(regreSSHion);
  assert.equal(regreSSHion.severity, RISK_SEVERITY.HIGH);
  assert.ok(regreSSHion.remediation.includes("9.8p1"));

  // Safe configuration check for unencrypted Docker API on port 2375
  const dockerFindings = cveDatabase.matchVulnerabilities({
    service: "docker",
    port: 2375
  });
  assert.ok(dockerFindings.some(f => f.cveId === "CVE-CONFIG-DOCKER-2375"));

  // Safe search catalog
  const searchResults = cveDatabase.search("Apache");
  assert.ok(searchResults.length >= 2);
});

test("Hardware Adapter: pure CPU execution, 0 CUDA, and platform profile", () => {
  const profile = hardwareAdapter.getHardwareProfile();
  assert.ok(profile.platform);
  assert.equal(profile.cudaAvailable, false);
  assert.equal(profile.executionMode, "PURE_CPU_LIGHTWEIGHT");
  assert.ok(profile.vCpuCount >= 1);
  assert.ok(profile.totalMemoryMB > 0);
  assert.equal(profile.nightcrawlerConstraintHandled, true);

  const health = hardwareAdapter.checkProcessHealth();
  assert.equal(health.cudaRequired, false);
  assert.ok(health.rssMB > 0 && health.rssMB < 350);
});

test("Scope Validation Proxy: blocks out-of-scope targets fail-closed", async () => {
  const agent = new SentinelAgent();

  // Out of scope target must throw TARGET_OUT_OF_SCOPE
  await assert.rejects(
    async () => {
      await agent.runMission("unauthorized-bank.com", { dryRun: true });
    },
    err => {
      assert.ok(err.message.includes("TARGET_OUT_OF_SCOPE") || err.message.includes("AUTHORIZATION_DENIED"));
      return true;
    }
  );

  // Empty target must fail
  await assert.rejects(
    async () => {
      await agent.runMission("", { dryRun: true });
    },
    /Target must be specified/
  );
});

test("Autonomous Sentinel Agent: executes 7-phase loop with dry-run simulation", async () => {
  const agent = new SentinelAgent();

  // Target localhost is authorized by default in TargetAuthorizationGateway
  const result = await agent.runMission("localhost", { dryRun: true });

  assert.equal(result.status, SCAN_STATUS.COMPLETED);
  assert.equal(result.target, "localhost");
  assert.equal(result.isDryRun, true);
  assert.equal(result.phasesExecuted.length, 7);

  // Verify all 7 phases executed in order
  const expectedPhases = ["DISCOVER", "INVENTORY", "ANALYZE", "IDENTIFY_RISKS", "PRIORITIZE", "RECOMMEND", "REPORT"];
  result.phasesExecuted.forEach((p, idx) => {
    assert.equal(p.phase, expectedPhases[idx]);
    assert.ok(p.rationale && p.rationale.length > 5);
  });

  // Verify assets and topology
  assert.equal(result.assets.length, 1);
  assert.ok(result.topology.nodes.length >= 2);
  assert.ok(result.topology.edges.length >= 1);

  // Verify findings and prioritizations
  assert.ok(result.findings.length > 0);
  assert.ok(result.prioritizedRisks.length > 0);
  assert.ok(result.recommendations.length > 0);
  assert.ok(result.executiveSummary.includes("ULTRON SENTINEL"));
  assert.ok(typeof result.risk.score === "number");
});

test("Network Discovery: builds topology and classifies node devices", () => {
  const engine = new NetworkDiscoveryEngine();
  const mockAssets = [
    {
      ip: "192.168.1.10",
      hostname: "srv-db.lab",
      deviceType: "SERVER",
      openPorts: [
        { port: 5432, protocol: "tcp", service: "postgresql" },
        { port: 22, protocol: "tcp", service: "ssh" }
      ]
    },
    {
      ip: "192.168.1.20",
      hostname: "wk-01.lab",
      deviceType: "WORKSTATION",
      openPorts: [
        { port: 3000, protocol: "tcp", service: "node-http" }
      ]
    }
  ];

  const topology = engine.buildTopology(mockAssets);
  assert.equal(topology.assetCount, 2);
  assert.ok(topology.nodeCount >= 3);
  assert.ok(topology.edgeCount >= 2);
  assert.ok(topology.subnets.includes("192.168.1.0/24"));
});

test("Sentinel Memory: records scan history and tracks drift", () => {
  const mem = new SentinelMemory({ storagePath: "./test-sentinel-mem-" + Date.now() + ".json" });
  try {
    mem.recordScan({
      scanId: "scan-test-01",
      target: "localhost",
      findings: [{ cveId: "CVE-2024-6387" }],
      risk: { score: 75 }
    });

    assert.equal(mem.scanHistory.length, 1);

    // Initial finding
    const drift1 = mem.updateFindings("localhost", [
      { cveId: "CVE-2024-6387", port: 22, title: "regreSSHion", severity: "HIGH", cvssScore: 8.1 }
    ]);
    assert.equal(drift1.newVulnerabilities.length, 1);
    assert.equal(drift1.recurringVulnerabilities.length, 0);

    // Port drift
    const portDrift = mem.computeAssetDrift("localhost", [22, 80], [22, 443]);
    assert.equal(portDrift.hasDrift, true);
    assert.deepEqual(portDrift.openedPorts, [443]);
    assert.deepEqual(portDrift.closedPorts, [80]);
  } finally {
    mem.clear();
  }
});

test("Sentinel Controls & Monitor: pause, resume, stop, and emergency halt", async () => {
  const monitor = new SentinelMonitor();
  const startResult = monitor.start(["localhost"], 60_000);
  assert.equal(startResult.running, true);

  const status = monitor.getStatus();
  assert.equal(status.running, true);

  monitor.stop();
  assert.equal(monitor.getStatus().running, false);

  try {
    // Emergency halt
    const halt = ultronSentinel.emergencyStop("Test halt");
    assert.equal(halt.emergencyStopEngaged, true);
    assert.equal(targetAuthorizationGateway.emergencyStopEngaged, true);

    // New scans must be blocked while emergency stop is engaged
    await assert.rejects(
      async () => {
        await ultronSentinel.startScan("localhost", { dryRun: true });
      },
      /halted/i
    );

    // Resume operations
    const resume = ultronSentinel.emergencyResume("ULTRON_OPERATOR_MASTER_KEY_SECRET");
    assert.equal(resume.emergencyStopEngaged, false);
    assert.equal(targetAuthorizationGateway.emergencyStopEngaged, false);
  } finally {
    targetAuthorizationGateway.emergencyStopEngaged = false;
  }
});

test("Sentinel REST Routes: status, hardware, findings, cve query, and report generation", async () => {
  await withSentinelRouter({}, async base => {
    // 1. GET /api/jarvis/sentinel/status
    const statusRes = await fetch(base + "/api/jarvis/sentinel/status");
    const statusBody = await statusRes.json();
    assert.equal(statusRes.status, 200);
    assert.equal(statusBody.success, true);
    assert.equal(statusBody.name, "ULTRON SENTINEL");
    assert.equal(statusBody.cudaAvailable, false);
    assert.equal(statusBody.executionMode, "PURE_CPU_LIGHTWEIGHT");

    // 2. GET /api/jarvis/sentinel/hardware
    const hwRes = await fetch(base + "/api/jarvis/sentinel/hardware");
    const hwBody = await hwRes.json();
    assert.equal(hwRes.status, 200);
    assert.equal(hwBody.success, true);
    assert.ok(hwBody.profile.vCpuCount >= 1);
    assert.equal(hwBody.health.cudaRequired, false);

    // 3. GET /api/jarvis/sentinel/cve
    const cveRes = await fetch(base + "/api/jarvis/sentinel/cve?q=openssh");
    const cveBody = await cveRes.json();
    assert.equal(cveRes.status, 200);
    assert.equal(cveBody.success, true);
    assert.ok(cveBody.count >= 1);

    // 4. POST /api/jarvis/sentinel/scan/start on authorized target
    const scanRes = await fetch(base + "/api/jarvis/sentinel/scan/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: "localhost", options: { dryRun: true } })
    });
    const scanBody = await scanRes.json();
    assert.equal(scanRes.status, 200);
    assert.equal(scanBody.success, true);
    assert.equal(scanBody.scan.status, SCAN_STATUS.COMPLETED);
    const scanId = scanBody.scan.scanId;

    // 5. POST /api/jarvis/sentinel/report
    const reportRes = await fetch(base + "/api/jarvis/sentinel/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scanId, format: "markdown" })
    });
    const reportBody = await reportRes.json();
    assert.equal(reportRes.status, 200);
    assert.equal(reportBody.success, true);
    assert.ok(reportBody.report.content.includes("ULTRON SENTINEL — CYBERSECURITY ASSESSMENT REPORT"));

    // 6. Security rejection: out-of-scope target must return 403 Forbidden
    const deniedRes = await fetch(base + "/api/jarvis/sentinel/scan/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: "evil-unauthorized-target.org", options: { dryRun: true } })
    });
    assert.equal(deniedRes.status, 403);
    const deniedBody = await deniedRes.json();
    assert.ok(deniedBody.error.message.includes("TARGET_OUT_OF_SCOPE") || deniedBody.error.message.includes("AUTHORIZATION_DENIED"));
  });
});

test("Sentinel Security & User Isolation: rejects unauthenticated and non-owner callers", async () => {
  // Non-owner caller
  await withSentinelRouter({ userId: "stranger-attacker" }, async base => {
    const res = await fetch(base + "/api/jarvis/sentinel/status");
    assert.equal(res.status, 403);
  });

  // Unauthenticated caller
  await withSentinelRouter({ userId: null }, async base => {
    const res = await fetch(base + "/api/jarvis/sentinel/status");
    assert.equal(res.status, 403);
  });
});

test("CVE Database: aggregate risk scoring and catalog edge cases", () => {
  // Empty findings
  const emptyRisk = cveDatabase.calculateAggregateRisk([]);
  assert.equal(emptyRisk.score, 0);
  assert.equal(emptyRisk.severity, RISK_SEVERITY.INFORMATIONAL);

  // Critical findings
  const critRisk = cveDatabase.calculateAggregateRisk([
    { cvssScore: 9.8, severity: RISK_SEVERITY.CRITICAL },
    { cvssScore: 8.5, severity: RISK_SEVERITY.HIGH }
  ]);
  assert.ok(critRisk.score >= 80);
  assert.equal(critRisk.severity, RISK_SEVERITY.CRITICAL);

  // Search case insensitivity
  const resultsUpper = cveDatabase.search("REDIS");
  const resultsLower = cveDatabase.search("redis");
  assert.equal(resultsUpper.length, resultsLower.length);
  assert.ok(resultsUpper.length >= 2);

  // Non-existent search
  const noResults = cveDatabase.search("non_existent_exploit_xyz");
  assert.equal(noResults.length, 0);
});

test("Sentinel Agent: scan pause, resume, and stop controls", async () => {
  const agent = new SentinelAgent();
  const scan = await agent.runMission("localhost", { dryRun: true });
  const scanId = scan.scanId;

  // Set running state to test pause
  scan.status = SCAN_STATUS.RUNNING;
  const pauseRes = agent.pauseScan(scanId);
  assert.equal(pauseRes.success, true);
  assert.equal(pauseRes.status, SCAN_STATUS.PAUSED);

  const resumeRes = agent.resumeScan(scanId);
  assert.equal(resumeRes.success, true);
  assert.equal(resumeRes.status, SCAN_STATUS.RUNNING);

  const stopRes = agent.stopScan(scanId);
  assert.equal(stopRes.success, true);
  assert.equal(stopRes.status, SCAN_STATUS.STOPPED);
});
