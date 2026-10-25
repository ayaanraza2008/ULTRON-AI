/**
 * ULTRON autonomy policy.
 *
 * Classifies intent before tools are dispatched. This is a conservative
 * planning signal, not a replacement for authentication or tool-specific
 * authorization. Untrusted content can never grant permissions.
 */
const RULES = [
  // English and common Romanized Hindi/Hinglish phrasing are both covered.
  // Keep the most consequential category first; classification selects the highest level.
  { level: "destructive", pattern: /\b(delete|erase|wipe|format|drop database|clear (?:the )?database|destroy|remove (?:the )?(?:(?:old|unused|temporary|backup|config|configuration) )*(?:file|files|folder|directory|database|record|records|branch)|remove all|factory reset|uninstall everything|permanently remove|empty trash|delete branch|delete kar(?: do| de)?|hata do|hata de|mita do|mita de|uda do|uda de|saaf kar(?: do| de)?|files? (?:ko )?hata(?: do| de)?)\b/i, reason: "Destructive or hard-to-reverse change" },
  { level: "external_effect", pattern: /\b(send.{0,80}email|email.{0,80}(customer|supplier|recipient)|send message|send a message|publish|post publicly|submit\b|(?:click|tap|press|select)\s+(?:the\s+)?(?:send|submit|publish|save|confirm|checkout|purchase|pay|upload|share|invite|book|reserve)(?:\s+button)?|confirm (purchase|booking|order|payment)|purchase|buy|pay|transfer money|book appointment|place order|checkout|save changes|change password|change account|change settings|invite user|accept (?:the )?(?:invite|invitation)|create (?:a )?(?:new )?account|change permissions|make (?:(?:the|this|our|my) )?(?:repository|repo|project) public|set (?:the )?(?:repository|repo|project) to public|enable public access|transfer ownership|add (?:a )?(?:new )?admin(?:istrator)?|promote .{0,30}admin(?:istrator)?|disable (?:two.factor|2fa|mfa|multi.factor authentication)|turn off (?:two.factor|2fa|mfa)|rotate (?:the )?(?:api )?key|rotate secrets?|change dns|change nameservers?|make .{0,40}(?:bucket|storage|database) public|export (?:all )?(?:customer|user|personal) data|revoke all sessions|reset all sessions|upload\b|share\b|grant access|revoke access|connect account|sign (in|up)|log (in|out)|cancel subscription|unsubscribe|deploy to production|deploy production|deploy changes to production|trigger deployment|restart production service|change production config|modify production environment|merge.{0,20}(pull request|pr)|merge branch.{0,50}(main|master|production)|push.{0,50}(main|master|production)|promote (?:the )?release|publish (?:a )?release|ship (?:the )?release|release to production|bhej(?: do| de)?|email kar(?: do| de)?|message kar(?: do| de)?|post kar(?: do| de)?|publish kar(?: do| de)?|payment kar(?: do| de)?|paise transfer kar(?: do| de)?|paise bhej(?: do| de)?|kharid(?: lo| do)?|order kar(?: do| de)?|booking kar(?: do| de)?|upload kar(?: do| de)?|share kar(?: do| de)?|access de do|setting(?:s)? badal(?: do| de)?)\b/i, reason: "Affects an external account, person, or financial transaction" },
  { level: "device_control", pattern: /\b(control my pc|control my computer|run shell|run (a )?(terminal|command|script|powershell)|execute (a )?(command|script)|install software|install (an )?app|uninstall (an )?app|shutdown|shut down|restart computer|remote desktop|keyboard and mouse|move files on my pc|access local files|run code on my computer|disable (?:the )?(?:firewall|antivirus|windows defender|security protections?)|turn off (?:the )?(?:firewall|antivirus|windows defender|security protections?)|bypass (?:the )?(?:firewall|antivirus|security protections?)|mera pc (?:restart|shutdown|band) kar(?: do| de)?|computer (?:restart|shutdown|band) kar(?: do| de)?|terminal command chala(?: do| de)?|script chala(?: do| de)?|software install kar(?: do| de)?|app install kar(?: do| de)?|mere pc par code chala(?: do| de)?|files? move kar(?: do| de)?)\b/i, reason: "Controls a device or executes code outside the hosted service" },
  { level: "private_data", pattern: /\b(read my email|read (my )?(emails|inbox)|access (my )?(drive|email|inbox)|search my inbox|open my private files|private files|personal documents|download my files|read my documents|meri emails? (?:padh|read) kar(?: do| de)?|mera inbox (?:check|search|khol) kar(?: do| de)?|meri files? access kar(?: do| de)?|meri drive check kar(?: do| de)?|mere documents (?:padh|read) kar(?: do| de)?)\b/i, reason: "Accesses private user data" }
];

const LEVEL_ORDER = { routine: 0, private_data: 1, device_control: 2, external_effect: 3, destructive: 4 };
const ACKNOWLEDGEMENT = /^(?:yes|yeah|yep|ok|okay|do it|yes do it|go ahead|proceed|sure|haan|han|haan bhai|haan bhai kar de|haan bhai kar do|kar do|kar de|karo|continue|confirm|approved|approve it|please do|do that|that's fine|sounds good)[\s🙏❤️]*$/i;

/**
 * Short confirmations inherit the immediately preceding user task so "yes,
 * do it" cannot accidentally downgrade a consequential request to routine.
 */
export function resolveAutonomyIntent(prompt, history = []) {
  const current = typeof prompt === "string" ? prompt.trim().slice(0, 6000) : "";
  const messages = Array.isArray(history) ? history : [];
  const normalizedCurrent = current.toLowerCase().replace(/[.,!?]/g, " ").replace(/\s+/g, " ").trim();
  if (current && ACKNOWLEDGEMENT.test(normalizedCurrent)) {
    const priorUser = messages.filter(message => message?.role === "user" && typeof message.content === "string")
      .map(message => message.content.trim())
      .filter(content => content && content !== current)
      .at(-1);
    if (priorUser) return (priorUser.slice(0, 6000) + "\n" + current).slice(0, 6000);
  }
  if (current) return current;
  return messages.filter(message => message?.role === "user" && typeof message.content === "string")
    .at(-1)?.content?.slice(0, 6000) || "";
}

export function classifyAutonomyRisk(input) {
  const text = typeof input === "string" ? input.slice(0, 6000) : "";
  let match = { level: "routine", reason: "Read-only, informational, or draft-oriented request" };
  for (const rule of RULES) {
    if (rule.pattern.test(text) && LEVEL_ORDER[rule.level] > LEVEL_ORDER[match.level]) {
      match = { level: rule.level, reason: rule.reason };
    }
  }
  const requiresConfirmation = ["private_data", "device_control", "external_effect", "destructive"].includes(match.level);
  return {
    level: match.level,
    reason: match.reason,
    requiresConfirmation,
    policyVersion: "1.3.0"
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
