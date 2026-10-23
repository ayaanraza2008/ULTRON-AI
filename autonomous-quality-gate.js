/**
 * Deterministic quality gate for autonomous worker deliverables.
 * Checks structure and traceability only; it does not certify factual truth.
 */
export function verifyAutonomousOutput({ research, report } = {}) {
  const answer = typeof report?.answer === "string" ? report.answer.trim() : "";
  const sources = Array.isArray(research?.sources) ? research.sources : [];
  const checks = [
    { id: "report_nonempty", passed: answer.length >= 80, detail: answer.length >= 80 ? "A substantive report was produced." : "Report is empty or unusually short." },
    { id: "research_available", passed: Boolean(research), detail: research ? "Research stage returned a result." : "Research was skipped; claims are not supported by live research in this run." },
    { id: "sources_available", passed: sources.length > 0, detail: sources.length ? sources.length + " source record(s) are available." : "No source records are available." },
    { id: "citations_traceable", passed: sources.length > 0 && sources.some(source => source?.url && answer.includes(source.url)), detail: sources.some(source => source?.url && answer.includes(source.url)) ? "At least one supplied source URL appears in the report." : "The report does not visibly cite a supplied source URL." }
  ];
  return {
    state: checks.every(check => check.passed) ? "passed" : "needs_review",
    checks,
    warning: "Automated quality gate checks completeness and traceability, not factual correctness. Human review is still recommended before relying on the report."
  };
}
