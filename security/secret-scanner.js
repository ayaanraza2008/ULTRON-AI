/**
 * ULTRON AI — Advanced Defensive Security Quality Gate
 * Module: SECRET SCANNER (security/secret-scanner.js)
 *
 * Implements high-precision repository secret detection with strict
 * zero-retention redaction. Scans working tree files and Git history.
 * Detects API keys, access tokens, private keys, database credentials,
 * and certificates without ever printing or persisting raw secrets.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { ultronGuardian } from "./ultron-guardian.js";
import { targetAuthorizationGateway, PERMITTED_ACTIVITIES } from "./target-authorization-gateway.js";

export const SECRET_RULES = [
  {
    id: "SEC-AWS-KEY",
    name: "AWS Access Key ID",
    severity: "CRITICAL",
    pattern: /\b(AKIA[0-9A-Z]{16})\b/g,
    description: "AWS IAM Access Key ID detected.",
    recommendation: "Rotate AWS access key immediately and store credentials in AWS Secrets Manager or environment variables."
  },
  {
    id: "SEC-GITHUB-PAT",
    name: "GitHub Personal Access Token",
    severity: "CRITICAL",
    pattern: /\b(gh[pousr]_[A-Za-z0-9_]{36,})\b/g,
    description: "GitHub Personal Access Token (classic or fine-grained) detected.",
    recommendation: "Revoke token via GitHub Security Settings and migrate to short-lived GitHub App tokens or secrets store."
  },
  {
    id: "SEC-OPENAI-KEY",
    name: "OpenAI / LLM API Key",
    severity: "CRITICAL",
    pattern: /\b(sk-[a-zA-Z0-9_\-]{20,})\b/g,
    description: "OpenAI or compatible LLM provider API key detected.",
    recommendation: "Revoke API key in provider dashboard and configure via environment variable."
  },
  {
    id: "SEC-GOOGLE-KEY",
    name: "Google API / Gemini Key",
    severity: "CRITICAL",
    pattern: /\b(AIza[0-9A-Za-z\-_]{35})\b/g,
    description: "Google Cloud / Gemini API key detected.",
    recommendation: "Restrict and rotate key in Google Cloud Console; supply via runtime secret configuration."
  },
  {
    id: "SEC-SLACK-TOKEN",
    name: "Slack API Token",
    severity: "HIGH",
    pattern: /\b(xox[baprs]-[0-9a-zA-Z]{10,48})\b/g,
    description: "Slack Bot, User, or Workspace token detected.",
    recommendation: "Revoke token in Slack App Management and rotate."
  },
  {
    id: "SEC-SUPABASE-KEY",
    name: "Supabase Secret / Service Role Key",
    severity: "CRITICAL",
    pattern: /\b(sb_secret_[a-zA-Z0-9_.-]{20,})\b/g,
    description: "Supabase Secret or service role key detected.",
    recommendation: "Rotate Supabase service role secret and ensure it is never committed to version control."
  },
  {
    id: "SEC-PRIVATE-KEY",
    name: "Private Cryptographic Key",
    severity: "CRITICAL",
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
    description: "Unencrypted private cryptographic key block detected.",
    recommendation: "Remove private key from repository; revoke associated certificates and public keys."
  },
  {
    id: "SEC-DB-CONN-STRING",
    name: "Database Connection String with Password",
    severity: "CRITICAL",
    pattern: /postgres(?:ql)?:\/\/[a-zA-Z0-9_.-]+:[^@\s]+@[a-zA-Z0-9_.-]+(?::[0-9]+)?\/[a-zA-Z0-9_.-]+/g,
    description: "Database connection URI containing embedded plaintext password.",
    recommendation: "Separate database credentials into secure environment variables (e.g. PGUSER, PGPASSWORD)."
  },
  {
    id: "SEC-GENERIC-PASSWORD",
    name: "Hardcoded Password Assignment",
    severity: "HIGH",
    pattern: /(?:(?:password|passwd|pwd|db_pass)\s*[:=]\s*["'])([^"'\s]{8,})(?:["'])/gi,
    description: "High-entropy password literal assigned in configuration or source code.",
    recommendation: "Store passwords in environment variables or an enterprise secret manager."
  }
];

export const DEFAULT_IGNORE_PATTERNS = [
  /node_modules/,
  /(?:^|[\\/])\.git(?:[\\/]|$)/,
  /(?:^|[\\/])\.antigravity(?:[\\/]|$)/,
  /(?:^|[\\/])dist(?:[\\/]|$)/,
  /(?:^|[\\/])build(?:[\\/]|$)/,
  /(?:^|[\\/])coverage(?:[\\/]|$)/,
  /(?:^|[\\/])tests?(?:[\\/]|$)/,
  /(?:^|[\\/])vendor(?:[\\/]|$)/,
  /(?:^|[\\/])reports(?:[\\/]|$)/,
  /\.onnx$/i,
  /\.png$/i,
  /\.jpg$/i,
  /\.jpeg$/i,
  /\.gif$/i,
  /\.ico$/i,
  /\.woff2?$/i,
  /\.ttf$/i,
  /\.lock$/i,
  /package-lock\.json$/i
];

export class SecretScanner {
  constructor(options = {}) {
    this.guardian = options.guardian || ultronGuardian;
    this.authGateway = options.authGateway || targetAuthorizationGateway;
    this.ignorePatterns = options.ignorePatterns || DEFAULT_IGNORE_PATTERNS;
    this.rules = options.rules || SECRET_RULES;
  }

  /**
   * Hashes a secret value with SHA-256 for zero-retention safe identification.
   */
  hashSecret(secret) {
    if (!secret) return "unknown";
    return crypto.createHash("sha256").update(String(secret)).digest("hex").slice(0, 10);
  }

  /**
   * Redacts secret values in a string, replacing with SHA-256 fingerprint.
   */
  redactText(text) {
    if (typeof text !== "string") return text;
    let sanitized = text;

    for (const rule of this.rules) {
      // Create fresh non-global regex copy for replacement
      const regex = new RegExp(rule.pattern.source, rule.pattern.flags);
      sanitized = sanitized.replace(regex, (match, captured) => {
        const val = captured || match;
        const hash = this.hashSecret(val);
        return `[REDACTED_SECRET:${rule.id}:${hash}]`;
      });
    }

    return sanitized;
  }

  /**
   * Scans a text buffer or file content for secret patterns.
   */
  scanContent(content, filePath = "memory://content") {
    const findings = [];
    const text = String(content || "");
    const lines = text.split("\n");

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      // Skip commented-out test assertions / documentation explaining patterns
      if (line.includes("REDACTED_SECRET") || line.includes("pattern:")) continue;

      for (const rule of this.rules) {
        const regex = new RegExp(rule.pattern.source, rule.pattern.flags);
        let match;
        while ((match = regex.exec(line)) !== null) {
          const secretVal = match[1] || match[0];
          // Skip placeholders and test mocks
          if (
            secretVal.includes("XXXX") ||
            secretVal.includes("test-secret") ||
            secretVal.includes("canary") ||
            secretVal.includes("placeholder") ||
            secretVal.includes("example") ||
            secretVal.includes("YOUR_")
          ) {
            continue;
          }

          const fingerprint = this.hashSecret(secretVal);
          findings.push({
            findingId: "sec-" + crypto.randomBytes(4).toString("hex"),
            ruleId: rule.id,
            name: rule.name,
            severity: rule.severity,
            filePath,
            lineNumber: lineIdx + 1,
            fingerprint,
            maskedSnippet: this.redactText(line.trim().slice(0, 160)),
            description: rule.description,
            recommendation: rule.recommendation
          });
        }
      }
    }

    return findings;
  }

  /**
   * Checks whether a file path should be ignored during scanning.
   */
  isIgnored(filePath) {
    return this.ignorePatterns.some(pattern => pattern.test(filePath));
  }

  /**
   * Recursively scans all files in a directory tree.
   */
  async scanRepository(repoDir = process.cwd(), options = {}) {
    this.authGateway.assertAuthorization(repoDir, PERMITTED_ACTIVITIES.CODE_SECURITY_SAST);

    const findings = [];
    const scannedFiles = [];
    let linesScanned = 0;

    const walkDir = (currentDir) => {
      let entries = [];
      try {
        entries = fs.readdirSync(currentDir, { withFileTypes: true });
      } catch (_) {
        return;
      }

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        const relPath = path.relative(repoDir, fullPath);

        if (this.isIgnored(relPath) || this.isIgnored(fullPath)) {
          continue;
        }

        if (entry.isDirectory()) {
          walkDir(fullPath);
        } else if (entry.isFile()) {
          try {
            const stat = fs.statSync(fullPath);
            if (stat.size > 2 * 1024 * 1024) continue; // Skip files >2MB
            const content = fs.readFileSync(fullPath, "utf8");
            linesScanned += content.split("\n").length;
            scannedFiles.push(relPath);
            const fileFindings = this.scanContent(content, relPath);
            findings.push(...fileFindings);
          } catch (_) {}
        }
      }
    };

    walkDir(repoDir);

    const isSecure = findings.length === 0;
    const gitleaksStatus = await this.checkGitleaks();

    const report = {
      tool: "ultron-secret-scanner",
      target: repoDir,
      timestamp: new Date().toISOString(),
      filesScanned: scannedFiles.length,
      linesScanned,
      findingsCount: findings.length,
      isSecure,
      findings,
      externalToolStatus: {
        gitleaks: gitleaksStatus
      }
    };

    this.guardian.recordAudit("SECRET_SCAN_COMPLETED", "secret-scanner", {
      target: repoDir,
      filesScanned: scannedFiles.length,
      findingsCount: findings.length,
      isSecure
    });

    return report;
  }

  /**
   * Scans recent Git commit history for committed secrets.
   */
  async scanGitHistory(repoDir = process.cwd(), maxCommits = 25) {
    this.authGateway.assertAuthorization(repoDir, PERMITTED_ACTIVITIES.CODE_SECURITY_SAST);
    const isWin = process.platform === "win32";
    const bin = isWin ? (process.env.ComSpec || "cmd.exe") : "git";
    const args = isWin
      ? ["/d", "/s", "/c", `git log -p -n${maxCommits} --no-color`]
      : ["log", "-p", `-n${maxCommits}`, "--no-color"];

    return new Promise((resolve) => {
      execFile(
        bin,
        args,
        { cwd: repoDir, timeout: 15000, maxBuffer: 10 * 1024 * 1024 },
        (error, stdout) => {
          if (error) {
            return resolve({
              tool: "git-history-secret-scanner",
              status: "GIT_LOG_UNAVAILABLE",
              message: error.message,
              commitsScanned: 0,
              findingsCount: 0,
              isSecure: false,
              findings: []
            });
          }

          const findings = [];
          const lines = String(stdout || "").split("\n");
          const commitsScanned = lines.filter(line => line.startsWith("commit ")).length;
          if (commitsScanned === 0) {
            return resolve({
              tool: "git-history-secret-scanner",
              status: "GIT_LOG_EMPTY",
              commitsScanned: 0,
              findingsCount: 0,
              isSecure: false,
              findings: []
            });
          }
          let currentCommit = "HEAD";
          let currentFile = "unknown";

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.startsWith("commit ")) {
              currentCommit = line.slice(7, 15);
            } else if (line.startsWith("diff --git")) {
              const parts = line.split(" ");
              currentFile = parts[2] ? parts[2].replace(/^a\//, "") : "unknown";
            } else if (line.startsWith("+") && !line.startsWith("+++")) {
              if (this.isIgnored(currentFile)) continue;
              // Added line
              const addedContent = line.slice(1);
              if (addedContent.includes("REDACTED_SECRET") || addedContent.includes("pattern:")) continue;

              for (const rule of this.rules) {
                const regex = new RegExp(rule.pattern.source, rule.pattern.flags);
                let match;
                while ((match = regex.exec(addedContent)) !== null) {
                  const secretVal = match[1] || match[0];
                  if (
                    secretVal.includes("XXXX") ||
                    secretVal.includes("test-secret") ||
                    secretVal.includes("canary") ||
                    secretVal.includes("placeholder") ||
                    secretVal.includes("example") ||
                    secretVal.includes("YOUR_")
                  ) {
                    continue;
                  }

                  const fingerprint = this.hashSecret(secretVal);
                  findings.push({
                    findingId: "sec-hist-" + crypto.randomBytes(3).toString("hex"),
                    ruleId: rule.id,
                    name: rule.name,
                    severity: rule.severity,
                    commit: currentCommit,
                    file: currentFile,
                    fingerprint,
                    maskedSnippet: this.redactText(addedContent.trim().slice(0, 160)),
                    recommendation: rule.recommendation
                  });
                }
              }
            }
          }

          resolve({
            tool: "git-history-secret-scanner",
            target: repoDir,
            timestamp: new Date().toISOString(),
            status: "COMPLETED",
            commitsScanned,
            findingsCount: findings.length,
            isSecure: findings.length === 0,
            findings
          });
        }
      );
    });
  }

  /**
   * Checks whether gitleaks CLI is installed on the host system.
   */
  async checkGitleaks() {
    return new Promise((resolve) => {
      execFile("gitleaks", ["version"], { timeout: 3000 }, (error, stdout) => {
        if (error || !stdout) {
          resolve({
            available: false,
            status: "TOOL_UNAVAILABLE",
            message: "Gitleaks CLI not found in host PATH; executed native high-precision secret scanner engine."
          });
        } else {
          resolve({
            available: true,
            status: "AVAILABLE",
            version: stdout.trim()
          });
        }
      });
    });
  }
}

export const secretScanner = new SecretScanner();
