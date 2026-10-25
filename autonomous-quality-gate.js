import { isPublicNetworkHost } from "./network-safety.js";

/**
 * Deterministic quality gate for autonomous worker deliverables.
 * Checks structure and traceability only; it does not certify factual truth.
 */
function isPublicHttpUrl(value) {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || !url.hostname ||
        url.username || url.password || url.port && !/^\d+$/.test(url.port)) return false;
    return isPublicNetworkHost(url.hostname);
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
