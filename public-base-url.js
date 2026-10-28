import { safeServiceBase } from "./network-safety.js";

export const DEFAULT_PUBLIC_BASE_URL = "https://ultron-ai-core.onrender.com";

/**
 * Resolve ULTRON's public origin for provider attribution headers.
 * A deployment may override this with its own public HTTPS origin; invalid,
 * local, credential-bearing, or query-bearing values fail closed to Core.
 */
export function getPublicBaseUrl(env = process.env) {
  const configured = typeof env.ULTRON_PUBLIC_BASE_URL === "string" && env.ULTRON_PUBLIC_BASE_URL.trim()
    ? env.ULTRON_PUBLIC_BASE_URL.trim()
    : DEFAULT_PUBLIC_BASE_URL;
  const safe = safeServiceBase(configured);
  if (!safe) return DEFAULT_PUBLIC_BASE_URL;
  try {
    const parsed = new URL(safe);
    if (parsed.protocol !== "https:") return DEFAULT_PUBLIC_BASE_URL;
    return parsed.origin;
  } catch {
    return DEFAULT_PUBLIC_BASE_URL;
  }
}
