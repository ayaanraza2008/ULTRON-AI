/**
 * ULTRON AI — Proactive Notification Policy (quiet hours + urgent bypass)
 *
 * Pure, clock-injectable policy evaluation used by the owner notification
 * transport (/jarvis/notifications). Fail-open by policy absence; explicit
 * user configuration is required to enable quiet hours. Priority-labeled
 * urgent notifications may bypass quiet hours when the policy allows it.
 */

const PRIORITIES = new Set(["LOW", "NORMAL", "HIGH", "URGENT", "CRITICAL"]);
const URGENT_PRIORITIES = new Set(["HIGH", "URGENT", "CRITICAL"]);

function normalizePriority(value) {
  const key = String(value || "NORMAL").toUpperCase();
  return PRIORITIES.has(key) ? key : "NORMAL";
}

function parseHHMM(value) {
  if (typeof value !== "string") return null;
  const match = value.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function minutesOfDay(at) {
  return at.getHours() * 60 + at.getMinutes();
}

export function evaluateNotificationWindow({ policy, at = new Date(), priority }) {
  const normalizedPriority = normalizePriority(priority);
  if (!policy || typeof policy !== "object") return { allowed: true, policyActive: false };

  const quietHours = policy.quietHours;
  if (!quietHours || typeof quietHours !== "object" || quietHours.enabled !== true) {
    return { allowed: true, policyActive: false };
  }

  const start = parseHHMM(quietHours.startHHMM);
  const end = parseHHMM(quietHours.endHHMM);
  if (start === null || end === null) {
    // Misconfigured window must fail open rather than silently swallowing
    // proactive notifications.
    return { allowed: true, policyActive: false, policyError: "INVALID_QUIET_WINDOW" };
  }

  if (URGENT_PRIORITIES.has(normalizedPriority) && quietHours.allowUrgent !== false) {
    return { allowed: true, policyActive: true, urgentBypass: true };
  }

  const now = minutesOfDay(at);
  const inWindow = start <= end ? now >= start && now < end : now >= start || now < end;

  if (inWindow) {
    return {
      allowed: false,
      policyActive: true,
      reason: "QUIET_HOURS_ACTIVE",
      quietWindow: {
        startHHMM: quietHours.startHHMM,
        endHHMM: quietHours.endHHMM,
        overnight: start > end
      }
    };
  }

  return { allowed: true, policyActive: true };
}

/**
 * Reads the owner-controlled policy from the environment.
 * Expected format (ULTRON_NOTIFICATION_POLICY_JSON):
 *   {"quietHours":{"enabled":true,"startHHMM":"23:00","endHHMM":"07:00","allowUrgent":true}}
 * Anything malformed or absent results in an inactive policy (fail-open).
 */
export function loadNotificationPolicy(env) {
  const raw = typeof env.ULTRON_NOTIFICATION_POLICY_JSON === "string" ? env.ULTRON_NOTIFICATION_POLICY_JSON.trim() : "";
  if (!raw) return { quietHours: { enabled: false } };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { quietHours: { enabled: false }, policyError: "MALFORMED_NOTIFICATION_POLICY" };
    }
    return { ...parsed, quietHours: parsed.quietHours || { enabled: false } };
  } catch {
    return { quietHours: { enabled: false }, policyError: "MALFORMED_NOTIFICATION_POLICY" };
  }
}

export const NOTIFICATION_PRIORITIES = [...PRIORITIES];
