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
  const requiredSections = [
    { id: "summary", pattern: /^#{1,4}\s+(?:executive\s+)?summary\b/im },
    { id: "deliverable", pattern: /^#{1,4}\s+(?:deliverable|findings|recommendation|result)\b/im },
    { id: "next_steps", pattern: /^#{1,4}\s+(?:next steps|action items|follow[- ]?up)\b/im },
    { id: "blockers", pattern: /^#{1,4}\s+(?:blockers|risks|limitations)\b/im },
    { id: "verification", pattern: /^#{1,4}\s+(?:verification criteria|verification|how to verify)\b/im }
  ];
  const headings = [...answer.matchAll(/^#{1,4}\s+([^\r\n]+?)\s*$/gm)];
  const sectionDetails = requiredSections.map(section => {
    const headingIndex = headings.findIndex(heading => section.pattern.test(heading[0]));
    const heading = headingIndex >= 0 ? headings[headingIndex] : null;
    if (!heading) return { id: section.id, headingIndex: -1, bodyLength: 0 };
    const bodyStart = heading.index + heading[0].length;
    const nextHeading = headings.find(candidate => candidate.index > heading.index);
    const bodyLength = answer.slice(bodyStart, nextHeading ? nextHeading.index : answer.length).trim().length;
    return { id: section.id, headingIndex, bodyLength };
  });
  const missingSections = sectionDetails.filter(section => section.headingIndex < 0).map(section => section.id);
  const emptySections = sectionDetails.filter(section => section.headingIndex >= 0 && section.bodyLength < 8).map(section => section.id);
  const presentPositions = sectionDetails.filter(section => section.headingIndex >= 0).map(section => section.headingIndex);
  const outOfOrder = presentPositions.some((position, index) => index > 0 && position < presentPositions[index - 1]);
  const structureIssues = [];
  if (missingSections.length) structureIssues.push("Missing required sections: " + missingSections.join(", ") + ".");
  if (emptySections.length) structureIssues.push("Empty or too-short sections: " + emptySections.join(", ") + ".");
  if (outOfOrder) structureIssues.push("Required sections are not in the requested order.");
  const structurePassed = missingSections.length === 0 && emptySections.length === 0 && !outOfOrder;
  const checks = [
    { id: "report_nonempty", passed: answer.length >= 80, detail: answer.length >= 80 ? "A substantive report was produced." : "Report is empty or unusually short." },
    { id: "research_available", passed: Boolean(research), detail: research ? "Research stage returned a result." : "Research was skipped; claims are not supported by live research in this run." },
    { id: "sources_available", passed: sources.length > 0, detail: sources.length ? sources.length + " source record(s) with public HTTP(S) URLs are available." : "No usable public HTTP(S) source records are available." },
    { id: "citations_traceable", passed: Boolean(citedSource), detail: citedSource ? "At least one public source URL appears in the report." : "The report does not visibly cite a usable supplied source URL." },
    { id: "deliverable_structure", passed: structurePassed, detail: structurePassed ? "Summary, deliverable, next steps, blockers/risks, and verification criteria contain content and appear in order." : structureIssues.join(" ") }
  ];
  return {
    state: checks.every(check => check.passed) ? "passed" : "needs_review",
    checks,
    warning: "Automated quality gate checks completeness and traceability, not factual correctness. Human review is still recommended before relying on the report."
  };
}
