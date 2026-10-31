/**
 * ULTRON AI — Advanced Ethical Hacking & Cybersecurity System
 * Module: CODE SHIELD (security/code-shield.js)
 *
 * Implements Static Application Security Testing (SAST),
 * Software Bill of Materials (SBOM) generation, dependency vulnerability analysis,
 * secret detection with zero-retention redaction, and safe remediation generation.
 */

import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ultronGuardian } from "./ultron-guardian.js";
import { targetAuthorizationGateway, PERMITTED_ACTIVITIES } from "./target-authorization-gateway.js";

export const SAST_RULES = [
  {
    id: "SAST-CWE-78",
    cwe: "CWE-78",
    name: "Command Injection",
    severity: "CRITICAL",
    cvss: 9.8,
    pattern: /\b(?:exec|execSync|spawn|spawnSync)\s*\([^)]*(?:\$\{|\+\s*[a-zA-Z0-9_]|userInput|req\.(?:query|body|params))/i,
    description: "Untrusted input concatenated into system execution commands.",
    remediation: "Use parameterized execution arrays without shell invocation, or validate inputs against a strict allowlist."
  },
  {
    id: "SAST-CWE-89",
    cwe: "CWE-89",
    name: "SQL Injection",
    severity: "CRITICAL",
    cvss: 9.8,
    pattern: /\b(?:query|execute|raw)\s*\(\s*["'`].*?(?:SELECT|INSERT|UPDATE|DELETE).*?(?:\$\{|\+\s*[a-zA-Z0-9_])/i,
    description: "Dynamic SQL statement constructed using string concatenation or template literals.",
    remediation: "Utilize parameterized prepared statements or safe ORM query builders."
  },
  {
    id: "SAST-CWE-79",
    cwe: "CWE-79",
    name: "Cross-Site Scripting (XSS)",
    severity: "HIGH",
    cvss: 7.5,
    pattern: /(?:\.innerHTML\s*=\s*|\bdocument\.write\s*\(|\bv-html\s*=\s*)/i,
    description: "Direct assignment of raw HTML strings without context-aware escaping.",
    remediation: "Use textContent/innerText, DOMPurify sanitization, or framework-native safe bindings."
  },
  {
    id: "SAST-CWE-22",
    cwe: "CWE-22",
    name: "Path Traversal",
    severity: "HIGH",
    cvss: 7.5,
    pattern: /(?:path\.join|path\.resolve|fs\.readFile|fs\.readFileSync)\s*\([^)]*(?:\.\.\/|\.\.\\|req\.(?:query|body|params))/i,
    description: "File path constructed using external input without path containment validation.",
    remediation: "Resolve paths against a canonical base directory and verify `path.startsWith(baseDir)`."
  },
  {
    id: "SAST-CWE-918",
    cwe: "CWE-918",
    name: "Server-Side Request Forgery (SSRF)",
    severity: "HIGH",
    cvss: 8.6,
    pattern: /\b(?:fetch|axios\.get|axios\.post|http\.get|https\.get)\s*\(\s*(?:req\.(?:query|body|params)|userInput|targetUrl)/i,
    description: "Outbound HTTP request executed against user-controlled URL without host pinning or loopback defense.",
    remediation: "Validate destination against an authorized domain allowlist and block private/loopback IP ranges via network-safety."
  },
  {
    id: "SAST-CWE-1321",
    cwe: "CWE-1321",
    name: "Prototype Pollution",
    severity: "HIGH",
    cvss: 7.5,
    pattern: /__proto__|constructor\s*\[\s*["']prototype["']\s*\]/i,
    description: "Object modification directly targeting prototype properties.",
    remediation: "Use Map or Object.create(null) for unkeyed lookups and sanitize keys."
  },
  {
    id: "SAST-CWE-798",
    cwe: "CWE-798",
    name: "Hardcoded Credential Exposure",
    severity: "CRITICAL",
    cvss: 8.9,
    pattern: /(?:(?:api[_-]?key|secret|token|password|auth_key)\s*[:=]\s*["'][A-Za-z0-9_\-]{20,}["']|\bsk-[A-Za-z0-9_-]{24,}|\bghp_[A-Za-z0-9_]{30,}|\bsb_secret_[A-Za-z0-9_.-]{20,})/i,
    description: "Plaintext credential or API token stored in source code.",
    remediation: "Store credentials in secure environment variables or vault secret managers; redact from git history."
  }
];

export class CodeShield {
  constructor(options = {}) {
    this.guardian = options.guardian || ultronGuardian;
    this.authGateway = options.authGateway || targetAuthorizationGateway;
    this.scanHistory = [];
  }

  /**
   * Static Application Security Testing (SAST) on provided code or repository files.
   */
  scanSourceCode(codeSnippet, options = {}) {
    const target = options.target || "memory://source-buffer";
    // Assert scope authorization
    this.authGateway.assertAuthorization(target, PERMITTED_ACTIVITIES.CODE_SECURITY_SAST);

    const source = String(codeSnippet || "");
    const lines = source.split("\n");
    const findings = [];

    lines.forEach((line, lineIndex) => {
      for (const rule of SAST_RULES) {
        if (rule.pattern.test(line)) {
          findings.push({
            findingId: "vuln-" + crypto.randomBytes(4).toString("hex"),
            ruleId: rule.id,
            cwe: rule.cwe,
            title: rule.name,
            severity: rule.severity,
            cvss: rule.cvss,
            lineNumber: lineIndex + 1,
            snippet: this.guardian.redactSecrets(line.trim().slice(0, 160)),
            description: rule.description,
            remediation: rule.remediation,
            confidence: 0.95
          });
        }
      }
    });

    const isSecure = findings.length === 0;
    const maxCvss = findings.reduce((max, f) => Math.max(max, f.cvss), 0);

    const result = {
      target,
      timestamp: new Date().toISOString(),
      linesScanned: lines.length,
      findingsCount: findings.length,
      isSecure,
      maxCvssScore: maxCvss,
      findings
    };

    this.scanHistory.push(result);
    if (this.scanHistory.length > 50) this.scanHistory.shift();

    this.guardian.recordAudit("CODE_SHIELD_SCAN_COMPLETED", "code-shield", {
      target,
      findingsCount: findings.length,
      isSecure
    });

    return result;
  }

  /**
   * Executes genuine `npm audit --json` using the local npm toolchain.
   * Never fabricates CVEs or CVSS scores; records actual tool findings.
   */
  async auditDependencies(repoDir = process.cwd(), options = {}) {
    this.authGateway.assertAuthorization(repoDir, PERMITTED_ACTIVITIES.CODE_SECURITY_SAST);
    const isWin = process.platform === "win32";
    const bin = isWin ? (process.env.ComSpec || "cmd.exe") : "npm";
    const args = isWin ? ["/d", "/s", "/c", "npm audit --json"] : ["audit", "--json"];

    return new Promise((resolve) => {
      execFile(
        bin,
        args,
        { cwd: repoDir, timeout: 25000, maxBuffer: 10 * 1024 * 1024 },
        (error, stdout) => {
          let parsed = null;
          try {
            if (stdout && stdout.trim()) {
              parsed = JSON.parse(stdout);
            }
          } catch (_) {}

          if (!parsed && error && error.code === "ENOENT") {
            return resolve({
              tool: "npm audit",
              status: "TOOL_UNAVAILABLE",
              isSecure: null,
              vulnerabilitiesCount: 0,
              message: "npm executable not found in host environment.",
              findings: []
            });
          }

          const metadata = parsed?.metadata || {};
          const vulns = parsed?.vulnerabilities || {};
          const findings = [];

          for (const [pkgName, detail] of Object.entries(vulns)) {
            const severity = String(detail.severity || "LOW").toUpperCase();
            const via = Array.isArray(detail.via) ? detail.via : [];
            const cves = via.map(v => typeof v === "object" ? (v.cwe || v.title || v.name) : v).filter(Boolean);

            findings.push({
              findingId: "dep-" + crypto.randomBytes(3).toString("hex"),
              tool: "npm audit",
              package: pkgName,
              severity,
              range: detail.range || "*",
              isDirect: Boolean(detail.isDirect),
              fixAvailable: Boolean(detail.fixAvailable),
              cves,
              description: `Vulnerable dependency '${pkgName}' (${severity})`,
              remediation: detail.fixAvailable ? `Run 'npm audit fix' or update ${pkgName}` : `Review dependency ${pkgName} for available upstream patches.`
            });
          }

          const totalVulns = metadata.vulnerabilities?.total ?? findings.length;
          const isSecure = totalVulns === 0;

          const report = {
            tool: "npm audit",
            target: repoDir,
            timestamp: new Date().toISOString(),
            status: "COMPLETED",
            isSecure,
            vulnerabilitiesCount: totalVulns,
            severityBreakdown: metadata.vulnerabilities || {
              info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0
            },
            totalDependencies: metadata.dependencies?.total || 0,
            findings
          };

          this.guardian.recordAudit("DEPENDENCY_AUDIT_COMPLETED", "code-shield", {
            target: repoDir,
            vulnerabilitiesCount: totalVulns,
            isSecure
          });

          resolve(report);
        }
      );
    });
  }

  /**
   * Generates a Software Bill of Materials (SBOM) in standard CycloneDX-compatible format.
   */
  generateSbom(packageJson = {}, options = {}) {
    const target = options.target || "memory://package.json";
    this.authGateway.assertAuthorization(target, PERMITTED_ACTIVITIES.CODE_SECURITY_SAST);

    const pkg = typeof packageJson === "string" ? JSON.parse(packageJson) : packageJson;
    const dependencies = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

    const components = Object.entries(dependencies).map(([name, version]) => ({
      name,
      version: String(version).replace(/[\^~]/g, ""),
      purl: `pkg:npm/${name}@${String(version).replace(/[\^~]/g, "")}`,
      type: "library",
      scope: pkg.devDependencies?.[name] ? "development" : "required"
    }));

    return {
      bomFormat: "CycloneDX",
      specVersion: "1.5",
      serialNumber: "urn:uuid:" + crypto.randomUUID(),
      version: 1,
      metadata: {
        timestamp: new Date().toISOString(),
        component: {
          name: pkg.name || "ultron-ai",
          version: pkg.version || "1.0.0",
          type: "application"
        }
      },
      totalComponents: components.length,
      components
    };
  }

  /**
   * Generates automated safe code remediation recommendation.
   */
  proposeRemediation(finding) {
    if (!finding) {
      throw new Error("Invalid finding: finding object is required.");
    }

    const cweId = finding.cwe || finding.check || finding.id || "CWE-MISC";
    let proposedPatch = "";
    let explanation = "";

    switch (cweId) {
      case "CWE-78":
        proposedPatch = "// REPLACED dynamic exec with safe execFile:\nexecFile('cmd', ['--safe-flag', sanitizedArg], { timeout: 5000 });";
        explanation = "Replaced shell execution with safe array argument passing to eliminate shell interpolation.";
        break;
      case "CWE-89":
        proposedPatch = "// REPLACED string concatenation with parameterized prepared statement:\nawait db.query('SELECT * FROM users WHERE id = $1', [userId]);";
        explanation = "Replaced string template literal with parameterized query parameter placeholder.";
        break;
      case "CWE-79":
        proposedPatch = "// REPLACED innerHTML with safe text assignment:\nelement.textContent = userMessage;";
        explanation = "Replaced innerHTML with textContent to ensure browser treats input strictly as plain text.";
        break;
      case "CWE-22":
        proposedPatch = "// Added path containment check:\nconst safePath = path.resolve(BASE_DIR, userFile);\nif (!safePath.startsWith(BASE_DIR)) throw new Error('Path traversal blocked');";
        explanation = "Enforced canonical path boundary check against authorized base directory.";
        break;
      case "CWE-798":
        proposedPatch = "// Migrated hardcoded secret to environment variable:\nconst apiKey = process.env.SERVICE_API_KEY;";
        explanation = "Replaced plaintext credential with secure environment variable retrieval.";
        break;
      default:
        proposedPatch = `// Apply standard remediation for ${cweId}:\n// ${finding.remediation || "Follow security configuration best practices."}`;
        explanation = finding.description || finding.impact || "Follow defensive security best practices.";
    }

    return {
      findingId: finding.findingId || finding.id || "vuln-" + crypto.randomBytes(3).toString("hex"),
      cwe: cweId,
      title: finding.title || finding.check || "Security Finding",
      severity: finding.severity || "MEDIUM",
      proposedPatch,
      explanation,
      status: "PROPOSED"
    };
  }
}

export const codeShield = new CodeShield();
