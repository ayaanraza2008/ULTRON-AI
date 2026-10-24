import path from "node:path";
import { fileURLToPath } from "node:url";
const MAX_RESPONSE_BYTES = 64 * 1024;

function safeSupabaseBase(value) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 2048) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
        (url.pathname !== "/" && url.pathname !== "") || !url.hostname.endsWith(".supabase.co")) return null;
    return url.origin;
  } catch { return null; }
}

async function readJsonLimited(response) {
  const declared = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    try { await response.body?.cancel?.(); } catch {}
    throw Object.assign(new Error("Settings response too large"), { code: "AUTH_SETTINGS_RESPONSE_TOO_LARGE" });
  }
  const reader = response.body?.getReader?.();
  if (!reader) throw Object.assign(new Error("Settings response is not stream-readable"), { code: "AUTH_SETTINGS_UNSAFE_RESPONSE" });
  const chunks = [], decoder = new TextDecoder();
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        try { await reader.cancel(); } catch {}
        throw Object.assign(new Error("Settings response too large"), { code: "AUTH_SETTINGS_RESPONSE_TOO_LARGE" });
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    try {
      const parsed = JSON.parse(chunks.join(""));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("unexpected JSON shape");
      return parsed;
    } catch {
      throw Object.assign(new Error("Invalid settings JSON"), { code: "AUTH_SETTINGS_INVALID_RESPONSE" });
    }
  } finally { try { reader.releaseLock(); } catch {} }
}

const boolOrNull = value => typeof value === "boolean" ? value : null;

function sanitizeSettings(settings, generatedAt) {
  const external = settings.external && typeof settings.external === "object" && !Array.isArray(settings.external)
    ? settings.external : {};
  const autoConfirm = boolOrNull(settings.mailer_autoconfirm ?? settings.autoconfirm);
  const smsProvider = typeof settings.sms_provider === "string" ? settings.sms_provider.trim() : "";
  return {
    status: "passed",
    verification: "public_auth_settings_only",
    signupDisabled: boolOrNull(settings.disable_signup),
    emailProviderEnabled: boolOrNull(external.email),
    emailConfirmationRequired: autoConfirm === null ? null : !autoConfirm,
    googleProviderEnabled: boolOrNull(external.google),
    phoneProviderEnabled: boolOrNull(external.phone),
    phoneAutoconfirm: boolOrNull(settings.phone_autoconfirm),
    smsProviderConfigured: Boolean(smsProvider),
    emailDeliveryVerified: false,
    notes: [
      "This reports public Supabase Auth runtime settings only.",
      "It does not send email or SMS, create accounts, verify OAuth secrets, or prove email delivery.",
      "Leaked-password protection and SMTP delivery health are not exposed by this public settings response."
    ],
    generatedAt
  };
}

/** Read-only auth diagnostic: no signup, email/SMS, database writes, or secret output. */
export async function diagnoseSupabaseAuth({ env = process.env, fetchImpl = globalThis.fetch, now = () => new Date().toISOString() } = {}) {
  const baseUrl = safeSupabaseBase(env.SUPABASE_URL);
  const apiKey = typeof env.SUPABASE_PUBLISHABLE_KEY === "string" && env.SUPABASE_PUBLISHABLE_KEY.trim()
    ? env.SUPABASE_PUBLISHABLE_KEY.trim()
    : typeof env.SUPABASE_ANON_KEY === "string" && env.SUPABASE_ANON_KEY.trim()
      ? env.SUPABASE_ANON_KEY.trim() : "";
  if (!baseUrl || !apiKey) {
    return { status: "blocked", reason: "SAFE_SUPABASE_URL_AND_PUBLISHABLE_KEY_REQUIRED", verification: "not_started", generatedAt: now() };
  }
  if (typeof fetchImpl !== "function") return { status: "blocked", reason: "FETCH_UNAVAILABLE", verification: "not_started", generatedAt: now() };
  try {
    const response = await fetchImpl(baseUrl + "/auth/v1/settings", {
      method: "GET",
      headers: { Accept: "application/json", apikey: apiKey },
      redirect: "error",
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) {
      const code = response.status === 401 || response.status === 403 ? "AUTH_SETTINGS_KEY_REJECTED"
        : response.status === 429 ? "AUTH_SETTINGS_RATE_LIMITED"
        : response.status >= 500 ? "AUTH_SETTINGS_UPSTREAM_UNAVAILABLE" : "AUTH_SETTINGS_REQUEST_REJECTED";
      try { await response.body?.cancel?.(); } catch {}
      return { status: "failed", reason: code, httpStatus: response.status, verification: "request_failed", generatedAt: now() };
    }
    return sanitizeSettings(await readJsonLimited(response), now());
  } catch (error) {
    const reason = error?.code && /^AUTH_SETTINGS_[A-Z_]+$/.test(error.code) ? error.code
      : error?.name === "TimeoutError" || error?.name === "AbortError" ? "AUTH_SETTINGS_TIMEOUT" : "AUTH_SETTINGS_UNREACHABLE";
    return { status: "failed", reason, verification: "request_failed", generatedAt: now() };
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const result = await diagnoseSupabaseAuth();
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  if (result.status !== "passed") process.exitCode = result.status === "blocked" ? 2 : 1;
}