import { createHmac, timingSafeEqual } from "node:crypto";

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""), "utf8");
  const b = Buffer.from(String(right || ""), "utf8");
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Twilio signs the exact webhook URL plus sorted POST parameters with HMAC-SHA1.
 * Keep TELEPHONY_PUBLIC_BASE_URL fixed to the public HTTPS URL configured at Twilio;
 * never build it from the untrusted Host/X-Forwarded-Host request headers.
 */
export function validateTwilioWebhook(req, { authToken, publicBaseUrl } = {}) {
  const token = String(authToken || "").trim();
  const signature = String(req?.headers?.["x-twilio-signature"] || req?.get?.("x-twilio-signature") || "").trim();
  const base = String(publicBaseUrl || "").trim();
  if (!token || !signature || !base) return false;

  let url;
  try {
    const baseUrl = new URL(base);
    if (baseUrl.protocol !== "https:" || baseUrl.username || baseUrl.password) return false;
    url = new URL(req.originalUrl || req.url || "/", baseUrl).toString();
  } catch {
    return false;
  }

  const params = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
  let signedPayload = url;
  for (const key of Object.keys(params).sort()) {
    const rawValue = params[key];
    const values = Array.isArray(rawValue)
      ? Array.from(new Set(rawValue.map(item => String(item)))).sort()
      : [String(rawValue ?? "")];
    for (const value of values) signedPayload += key + value;
  }

  const expected = createHmac("sha1", token).update(signedPayload, "utf8").digest("base64");
  return safeEqual(expected, signature);
}

/**
 * Provider webhooks must prove possession of a server-side secret. The generic
 * shared-secret header is useful for compatible providers and private test
 * harnesses; Twilio uses its native X-Twilio-Signature validation.
 */
export function createTelephonyWebhookGuard({ env = process.env } = {}) {
  return function requireTelephonyWebhook(req, res, next) {
    const sharedSecret = String(env.ULTRON_TELEPHONY_WEBHOOK_SECRET || "").trim();
    const providedSecret = String(req?.headers?.["x-ultron-telephony-secret"] || req?.get?.("x-ultron-telephony-secret") || "").trim();

    if (sharedSecret.length >= 32 && safeEqual(sharedSecret, providedSecret)) {
      return next();
    }

    const authToken = String(env.TWILIO_AUTH_TOKEN || "").trim();
    const publicBaseUrl = String(env.TELEPHONY_PUBLIC_BASE_URL || "").trim();
    if (authToken && publicBaseUrl && validateTwilioWebhook(req, { authToken, publicBaseUrl })) {
      return next();
    }

    const configured = Boolean(sharedSecret || authToken || publicBaseUrl);
    return res.status(configured ? 401 : 503).json({
      error: {
        code: configured ? "TELEPHONY_WEBHOOK_AUTH_FAILED" : "TELEPHONY_WEBHOOK_AUTH_NOT_CONFIGURED",
        message: configured
          ? "Telephony webhook authentication failed; the request was rejected."
          : "Telephony callbacks are disabled until a provider webhook secret or valid Twilio signature configuration is installed."
      }
    });
  };
}
