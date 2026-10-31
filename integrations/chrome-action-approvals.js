import { randomUUID } from "node:crypto";

const MAX_PENDING = 256;
const DEFAULT_TTL_MS = 90_000;
const pending = new Map();

function cleanText(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normalizeOrigin(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname))) return "";
    if (url.username || url.password) return "";
    return url.origin;
  } catch {
    return "";
  }
}

function normalizePageUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (!normalizeOrigin(url.origin)) return "";
    url.search = "";
    url.hash = "";
    return url.toString().slice(0, 1000);
  } catch {
    return "";
  }
}

export function normalizeChromeApprovalInspection(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      value.action !== "inspect_click") return null;
  const origin = normalizeOrigin(value.origin);
  const pageUrl = normalizePageUrl(value.url);
  const selector = cleanText(value.selector, 600);
  const label = cleanText(value.label, 240);
  const tag = cleanText(value.tag, 20).toLowerCase();
  const type = cleanText(value.type, 40).toLowerCase();
  const formActionOrigin = value.formActionOrigin ? normalizeOrigin(value.formActionOrigin) : "";
  if (!origin || !pageUrl || !selector || !tag) return null;
  return Object.freeze({
    origin,
    pageUrl,
    selector,
    label,
    tag,
    type,
    formActionOrigin,
    highImpact: value.highImpact === true,
    crossOriginForm: value.crossOriginForm === true
  });
}

function prune(nowMs) {
  for (const [id, entry] of pending) {
    if (entry.expiresAt <= nowMs) pending.delete(id);
  }
  while (pending.size >= MAX_PENDING) pending.delete(pending.keys().next().value);
}

export function createChromeActionApproval({ userId, inspection, nowMs = Date.now, ttlMs = DEFAULT_TTL_MS } = {}) {
  const owner = cleanText(userId, 100);
  const fingerprint = normalizeChromeApprovalInspection(inspection);
  if (!owner || !fingerprint) return { ok: false, code: "CHROME_APPROVAL_CONTEXT_INVALID" };
  const now = nowMs();
  prune(now);
  const ttl = Number.isFinite(ttlMs) ? Math.max(15_000, Math.min(DEFAULT_TTL_MS, Math.trunc(ttlMs))) : DEFAULT_TTL_MS;
  const id = randomUUID();
  const expiresAt = now + ttl;
  pending.set(id, { id, userId: owner, fingerprint, createdAt: now, expiresAt });
  return {
    ok: true,
    id,
    expiresAt: new Date(expiresAt).toISOString(),
    approvalPhrase: "I approve ULTRON Chrome action " + id,
    summary: {
      action: "click",
      origin: fingerprint.origin,
      selector: fingerprint.selector,
      label: fingerprint.label,
      element: fingerprint.tag,
      formActionOrigin: fingerprint.formActionOrigin || null,
      expiresInSeconds: Math.ceil(ttl / 1000)
    }
  };
}

export function getChromeActionApproval({ approvalId, userId, nowMs = Date.now } = {}) {
  const id = cleanText(approvalId, 80);
  const owner = cleanText(userId, 100);
  const entry = pending.get(id);
  if (!entry || !owner || entry.userId !== owner) return { ok: false, code: "CHROME_APPROVAL_NOT_FOUND" };
  const now = nowMs();
  if (entry.expiresAt <= now) {
    pending.delete(id);
    return { ok: false, code: "CHROME_APPROVAL_EXPIRED" };
  }
  return {
    ok: true,
    id,
    fingerprint: entry.fingerprint,
    expiresAt: entry.expiresAt
  };
}

export function consumeChromeActionApproval({ approvalId, userId, inspection, nowMs = Date.now } = {}) {
  const current = getChromeActionApproval({ approvalId, userId, nowMs });
  if (!current.ok) return current;
  const fingerprint = normalizeChromeApprovalInspection(inspection);
  if (!fingerprint || JSON.stringify(fingerprint) !== JSON.stringify(current.fingerprint)) {
    pending.delete(current.id);
    return { ok: false, code: "CHROME_APPROVAL_STALE" };
  }
  // Delete before dispatch: concurrent requests and retries cannot reuse an approval.
  pending.delete(current.id);
  return { ok: true, id: current.id, fingerprint };
}

export function clearChromeActionApprovalsForTests() {
  pending.clear();
}

export function getChromeActionApprovalCountForTests() {
  return pending.size;
}
