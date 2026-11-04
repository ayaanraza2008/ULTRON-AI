/**
 * Process-local, unforgeable, single-use proof that an authenticated
 * AutonomousOrchestrator approval was checked and consumed before dispatch.
 *
 * The proof object is held only in a WeakMap. JSON, caller-supplied booleans,
 * IDs, and copied object shapes cannot recreate it.
 */
const approvedProofs = new WeakMap();

export function createToolApprovalProof({ actorId, toolId, permissionLevel, approvalId } = {}) {
  if (typeof actorId !== "string" || !actorId.trim() ||
      typeof toolId !== "string" || !toolId.trim() ||
      !Number.isInteger(Number(permissionLevel)) || Number(permissionLevel) < 3 ||
      typeof approvalId !== "string" || !approvalId.trim()) {
    throw new TypeError("A verified owner, tool, permission level, and approval ID are required to mint a tool proof.");
  }

  const proof = Object.freeze(Object.create(null));
  approvedProofs.set(proof, {
    actorId: actorId.trim(),
    toolId: toolId.trim(),
    permissionLevel: Number(permissionLevel),
    approvalId: approvalId.trim(),
    createdAt: Date.now()
  });
  return proof;
}

export function consumeToolApprovalProof(proof, { actorId, toolId, permissionLevel } = {}) {
  if (!proof || (typeof proof !== "object" && typeof proof !== "function")) return false;
  const record = approvedProofs.get(proof);
  if (!record) return false;

  // Consume before comparing so a mismatched proof cannot be replayed later
  // against the correct tool or actor.
  approvedProofs.delete(proof);
  return record.actorId === actorId &&
    record.toolId === toolId &&
    record.permissionLevel === Number(permissionLevel) &&
    Date.now() - record.createdAt <= 5 * 60 * 1000;
}
