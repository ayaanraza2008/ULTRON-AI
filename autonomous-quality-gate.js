import { isIP } from "node:net";

/**
 * Deterministic quality gate for autonomous worker deliverables.
 * Checks structure and traceability only; it does not certify factual truth.
 */
function isPublicHttpUrl(value) {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || !url.hostname || url.username || url.password) return false;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") ||
        host === "metadata.google.internal" || host === "metadata.google") return false;
    if (isIP(host) === 4) {
      const octets = host.split(".").map(Number);
      const [a, b] = octets;
      if (a === 0 || a === 10 || a === 127 || a >= 224 ||
          (a === 100 && b >= 64 && b <= 127) ||
          (a === 169 && b === 254) ||
          (a === 172 && b >= 16 && b <= 31) ||
          (a === 192 && (b === 0 || b === 168 || (b === 88 && octets[2] === 99))) ||
          (a === 198 && (b === 18 || b === 19 || (b === 51 && octets[2] === 100))) ||
          (a === 203 && b === 0 && octets[2] === 113)) return false;
    } else if (isIP(host) === 6) {
      const normalized = host.toLowerCase();
      if (normalized === "::" || normalized === "::1" || normalized.startsWith("fc") ||
          normalized.startsWith("fd") || /^fe[89ab]/.test(normalized) ||
          normalized.startsWith("2001:db8:") || normalized.startsWith("2001:0:") || normalized.startsWith("2002:")) return false;
      const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
      if (mapped && !isPublicHttpUrl("https://" + mapped[1] + "/")) return false;
      // Hex-encoded IPv4-mapped IPv6 must inherit IPv4 private/reserved checks too.
      const mappedHex = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
      if (mappedHex) {
        const high = Number.parseInt(mappedHex[1], 16);
        const low = Number.parseInt(mappedHex[2], 16);
        const ipv4 = [(high >> 8) & 255, high & 255, (low >> 8) & 255, low & 255].join(".");
        if (!isPublicHttpUrl("https://" + ipv4 + "/")) return false;
      }
    } else if (!host.includes(".")) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function verifyAutonomousOutput({ research, report } = {}) {
  const answer = typeof report?.answer === "string" ? report.answer.trim() : "";
  const rawSources = Array.isArray(research?.sources) ? research.sources : [];
  const sources = rawSources.filter(source => isPublicHttpUrl(source?.url));
  const citedSource = sources.find(source => answer.includes(source.url));
  const checks = [
    { id: "report_nonempty", passed: answer.length >= 80, detail: answer.length >= 80 ? "A substantive report was produced." : "Report is empty or unusually short." },
    { id: "research_available", passed: Boolean(research), detail: research ? "Research stage returned a result." : "Research was skipped; claims are not supported by live research in this run." },
    { id: "sources_available", passed: sources.length > 0, detail: sources.length ? sources.length + " source record(s) with public HTTP(S) URLs are available." : "No usable public HTTP(S) source records are available." },
    { id: "citations_traceable", passed: Boolean(citedSource), detail: citedSource ? "At least one public source URL appears in the report." : "The report does not visibly cite a usable supplied source URL." }
  ];
  return {
    state: checks.every(check => check.passed) ? "passed" : "needs_review",
    checks,
    warning: "Automated quality gate checks completeness and traceability, not factual correctness. Human review is still recommended before relying on the report."
  };
}
