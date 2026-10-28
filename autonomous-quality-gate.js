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

function normalizePublicUrl(value) {
  if (!isPublicHttpUrl(value)) return "";
  try {
    return new URL(value).toString();
  } catch {
    return "";
  }
}

/**
 * Extract URL tokens rather than using substring matching. Without tokenization,
 * a source such as https://example.com/source could be "cited" accidentally by
 * https://example.com/source.evil or nested inside another URL's query string.
 */
function stripMarkdownCode(answer) {
  // Links inside code samples are not citations. Treat an unterminated fenced
  // block as code through end-of-report, preferring a review warning to a false pass.
  return answer
    .replace(/```[\\s\\S]*?(?:```|$)/g, " ")
    .replace(/`[^`\\n]*`/g, " ");
}

function extractPublicCitationUrls(answer) {
  const citations = new Set();
  const prose = stripMarkdownCode(answer);
  for (const match of prose.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
    const preceding = answer[match.index - 1] || "";
    // Do not treat an HTTP URL embedded in a larger URL/identifier as a citation.
    // Parentheses and square brackets remain valid Markdown link delimiters.
    if (/[A-Za-z0-9._~:/?#@!$&'*;,+%=-]/.test(preceding)) continue;
    const candidate = match[0].replace(/[.,;:!?)}\]]+$/g, "");
    const normalized = normalizePublicUrl(candidate);
    if (normalized) citations.add(normalized);
  }
  return citations;
}

export function verifyAutonomousOutput({ research, report } = {}) {
  const answer = typeof report?.answer === "string" ? report.answer.trim() : "";
  const rawSources = Array.isArray(research?.sources) ? research.sources : [];
  const sources = rawSources.filter(source => isPublicHttpUrl(source?.url));
  const citedUrls = extractPublicCitationUrls(answer);
  const citedSource = sources.find(source => citedUrls.has(normalizePublicUrl(source.url)));
  const checks = [
    { id: "report_nonempty", passed: answer.length >= 80, detail: answer.length >= 80 ? "A substantive report was produced." : "Report is empty or unusually short." },
    { id: "research_available", passed: Boolean(research), detail: research ? "Research stage returned a result." : "Research was skipped; claims are not supported by live research in this run." },
    { id: "sources_available", passed: sources.length > 0, detail: sources.length ? sources.length + " source record(s) with public HTTP(S) URLs are available." : "No usable public HTTP(S) source records are available." },
    { id: "citations_traceable", passed: Boolean(citedSource), detail: citedSource ? "At least one exact public source URL appears as a citation in the report." : "The report does not visibly cite an exact usable supplied source URL." }
  ];
  return {
    state: checks.every(check => check.passed) ? "passed" : "needs_review",
    checks,
    warning: "Automated quality gate checks completeness and traceability, not factual correctness. Human review is still recommended before relying on the report."
  };
}
