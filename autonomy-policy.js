/**
 * ULTRON autonomy policy.
 *
 * Classifies intent before tools are dispatched. This is a conservative
 * planning signal, not a replacement for authentication or tool-specific
 * authorization. Untrusted content can never grant permissions.
 */
const RULES = [
  { level: "destructive", pattern: /\b(delete|erase|wipe|format|drop database|destroy|remove all|factory reset)\b/i, reason: "Destructive or hard-to-reverse change" },
  { level: "external_effect", pattern: /\b(send email|send an email|email the customer|send message|send a message|publish|post publicly|submit application|purchase|buy|pay|transfer money|book appointment|place order|change password|change account|invite user)\b/i, reason: "Affects an external account, person, or financial transaction" },
  { level: "device_control", pattern: /\b(control my pc|control my computer|run shell|execute command|install software|shutdown|restart computer|remote desktop|keyboard and mouse)\b/i, reason: "Controls a device or executes code outside the hosted service" },
  { level: "private_data", pattern: /\b(read my email|read inbox|access drive|private files|personal documents|download my files)\b/i, reason: "Accesses private user data" }
];

const LEVEL_ORDER = { routine: 0, private_data: 1, device_control: 2, external_effect: 3, destructive: 4 };

export function classifyAutonomyRisk(input) {
  const text = typeof input === "string" ? input.slice(0, 6000) : "";
  let match = { level: "routine", reason: "Read-only, informational, or draft-oriented request" };
  for (const rule of RULES) {
    if (rule.pattern.test(text) && LEVEL_ORDER[rule.level] > LEVEL_ORDER[match.level]) {
      match = { level: rule.level, reason: rule.reason };
    }
  }
  const requiresConfirmation = ["device_control", "external_effect", "destructive"].includes(match.level);
  return {
    level: match.level,
    reason: match.reason,
    requiresConfirmation,
    policyVersion: "1.0.0"
  };
}

/**
 * Produces a small execution outline. It does not execute actions and never
 * treats user wording, model output, memory, or tool results as a permission.
 */
export function buildAutonomyPlan(input) {
  const task = typeof input === "string" ? input.trim().slice(0, 6000) : "";
  const risk = classifyAutonomyRisk(task);
  const steps = [
    { id: "understand", action: "identify_goal_and_constraints", status: "ready" },
    { id: "select_tools", action: "select_available_allowlisted_tools", status: "ready" },
    { id: "execute", action: "execute_safe_steps_and_record_results", status: risk.requiresConfirmation ? "approval_required" : "ready" },
    { id: "verify", action: "verify_outputs_and_report_blockers", status: "ready" }
  ];
  return { task, risk, steps, executionMode: risk.requiresConfirmation ? "guarded" : "autonomous_safe_steps_only" };
}
