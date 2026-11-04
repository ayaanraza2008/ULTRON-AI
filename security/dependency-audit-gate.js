/**
 * Fail-closed exit policy for the standalone dependency audit.
 * 0 = completed with no HIGH/CRITICAL advisories
 * 1 = completed and at least one HIGH/CRITICAL advisory was found
 * 2 = audit could not be completed or returned an invalid report
 */
export function dependencyAuditExitCode(report) {
  if (!report || report.status !== "COMPLETED" || !report.severityBreakdown) return 2;
  const critical = Number(report.severityBreakdown.critical ?? 0);
  const high = Number(report.severityBreakdown.high ?? 0);
  if (!Number.isFinite(critical) || !Number.isFinite(high)) return 2;
  return critical > 0 || high > 0 ? 1 : 0;
}
