/**
 * Process-local, unforgeable, single-use proof that an authenticated
 * AutonomousOrchestrator approval was checked and consumed before dispatch.
 *
 * The proof object is held only in a WeakMap. JSON, caller-supplied booleans,
 * IDs, and copied object shapes cannot recreate it.
 */
import crypto from "node:crypto";

const approvedProofs = new WeakMap();

function stableSerialize(value, seen = new WeakSet(), depth = 0) {
  if (depth > 24) throw new TypeError("Approval parameters are too deeply nested.");
  // Match JSON semantics: undefined object properties are omitted below,
  // while undefined array slots serialize as null.
  if (value === undefined) return "null";
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Approval parameters contain a non-finite number.");
    return JSON.stringify(value);
  }
  if (typeof value !== "object") throw new TypeError("Approval parameters must be JSON-compatible.");
  if (seen.has(value)) throw new TypeError("Approval parameters contain a circular reference.");
  seen.add(value);
  try {
    if (Array.isArray(value)) return "[" + value.map(item => stableSerialize(item, seen, depth + 1)).join(",") + "]";
    const keys = Object.keys(value).filter(key => value[key] !== undefined).sort();
    return "{" + keys.map(key =>
      JSON.stringify(key) + ":" + stableSerialize(value[key], seen, depth + 1)
    ).join(",") + "}";
  } finally {
    seen.delete(value);
  }
}

function parametersFingerprint(params) {
  return crypto.createHash("sha256").update(stableSerialize(params ?? {})).digest("hex");
}

export function createToolApprovalProof({ actorId, toolId, permissionLevel, approvalId, params } = {}) {
  if (typeof actorId !== "string" || !actorId.trim() ||
      typeof toolId !== "string" || !toolId.trim() ||
      !Number.isInteger(Number(permissionLevel)) || Number(permissionLevel) < 1 ||
      typeof approvalId !== "string" || !approvalId.trim() || params === undefined) {
    throw new TypeError("A verified owner, tool, permission level, and approval ID are required to mint a tool proof.");
  }

  const proof = Object.freeze(Object.create(null));
  approvedProofs.set(proof, {
    actorId: actorId.trim(),
    toolId: toolId.trim(),
    permissionLevel: Number(permissionLevel),
    approvalId: approvalId.trim(),
    parametersFingerprint: parametersFingerprint(params),
    createdAt: Date.now()
  });
  return proof;
}

export function consumeToolApprovalProof(proof, { actorId, toolId, permissionLevel, params } = {}) {
  if (!proof || (typeof proof !== "object" && typeof proof !== "function")) return false;
  const record = approvedProofs.get(proof);
  if (!record) return false;

  // Consume before comparing so a mismatched proof cannot be replayed later
  // against the correct tool or actor.
  approvedProofs.delete(proof);
  return record.actorId === actorId &&
    record.toolId === toolId &&
    record.permissionLevel === Number(permissionLevel) &&
    record.parametersFingerprint === parametersFingerprint(params ?? {}) &&
    Date.now() - record.createdAt <= 5 * 60 * 1000;
}
