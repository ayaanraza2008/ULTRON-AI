/**
 * ULTRON AI — Cryptographic Operator Authorization Service
 * Module: security/operator-authorization.js
 *
 * Implements short-lived, cryptographically signed, single-use approval tokens
 * bound to the authenticated operator user ID, target file path, and proposed
 * modification SHA-256 digest. Prevents replay attacks, unauthorized client bypasses,
 * and immutable system file modifications.
 */

import crypto from "node:crypto";

export class OperatorAuthorizationService {
  constructor(options = {}) {
    this.serverSecret = options.serverSecret || process.env.ULTRON_OPERATOR_SECRET || process.env.SUPABASE_JWT_SECRET || ("ultron-auth-key-" + crypto.randomBytes(32).toString("hex"));
    this.activeChallenges = new Map();
    this.tokenTtlMs = options.tokenTtlMs || 5 * 60 * 1000; // 5 minutes
    this.maxChallenges = options.maxChallenges || 300;
  }

  /**
   * Generates a cryptographically signed approval challenge for a proposed file modification.
   */
  createChallenge({ ownerUserId, targetFile, modificationDigest }) {
    if (!ownerUserId || typeof ownerUserId !== "string" || !ownerUserId.trim()) {
      throw new Error("createChallenge requires a valid ownerUserId.");
    }
    if (!targetFile || typeof targetFile !== "string" || !targetFile.trim()) {
      throw new Error("createChallenge requires a valid targetFile.");
    }
    if (!modificationDigest || typeof modificationDigest !== "string" || !modificationDigest.trim()) {
      throw new Error("createChallenge requires a valid modificationDigest.");
    }

    const challengeId = crypto.randomUUID();
    const expiresAt = Date.now() + this.tokenTtlMs;
    const nonce = crypto.randomBytes(16).toString("hex");

    const normalizedTarget = targetFile.replace(/\\/g, "/");
    const payload = `${ownerUserId}:${normalizedTarget}:${modificationDigest}:${challengeId}:${expiresAt}:${nonce}`;
    const signature = crypto.createHmac("sha256", this.serverSecret).update(payload).digest("hex");
    const approvalToken = `${challengeId}.${expiresAt}.${nonce}.${signature}`;

    this.activeChallenges.set(challengeId, {
      challengeId,
      ownerUserId,
      targetFile: normalizedTarget,
      modificationDigest,
      expiresAt,
      used: false,
      createdAt: Date.now()
    });

    // Clean up expired or consumed challenges
    if (this.activeChallenges.size > this.maxChallenges) {
      const now = Date.now();
      for (const [key, val] of this.activeChallenges.entries()) {
        if (val.expiresAt < now || val.used) {
          this.activeChallenges.delete(key);
        }
      }
    }

    return {
      challengeId,
      approvalToken,
      targetFile: normalizedTarget,
      modificationDigest,
      expiresAt: new Date(expiresAt).toISOString()
    };
  }

  /**
   * Verifies an approval token against owner identity, target file, and change digest,
   * then consumes it to prevent replay attacks.
   */
  verifyAndConsume({ ownerUserId, targetFile, modificationDigest, approvalToken }) {
    if (!approvalToken || typeof approvalToken !== "string") {
      return { valid: false, code: "MISSING_APPROVAL_TOKEN", reason: "Operator approval token is required." };
    }

    const parts = approvalToken.split(".");
    if (parts.length !== 4) {
      return { valid: false, code: "MALFORMED_TOKEN", reason: "Approval token format is invalid." };
    }

    const [challengeId, expiresAtStr, nonce, signature] = parts;
    const expiresAt = Number(expiresAtStr);

    if (Number.isNaN(expiresAt) || Date.now() > expiresAt) {
      return { valid: false, code: "TOKEN_EXPIRED", reason: "Operator approval token has expired." };
    }

    const normalizedTarget = (targetFile || "").replace(/\\/g, "/");
    const payload = `${ownerUserId}:${normalizedTarget}:${modificationDigest}:${challengeId}:${expiresAt}:${nonce}`;
    const expectedSig = crypto.createHmac("sha256", this.serverSecret).update(payload).digest("hex");

    try {
      const sigBuf = Buffer.from(signature, "hex");
      const expBuf = Buffer.from(expectedSig, "hex");
      if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
        return { valid: false, code: "INVALID_SIGNATURE", reason: "Cryptographic signature verification failed." };
      }
    } catch {
      return { valid: false, code: "SIGNATURE_VERIFICATION_ERROR", reason: "Error verifying signature buffer." };
    }

    const record = this.activeChallenges.get(challengeId);
    if (!record) {
      return { valid: false, code: "CHALLENGE_NOT_FOUND", reason: "Challenge does not exist or has expired." };
    }

    if (record.used) {
      return { valid: false, code: "REPLAY_ATTACK_DETECTED", reason: "Approval token has already been consumed." };
    }

    if (record.ownerUserId !== ownerUserId) {
      return { valid: false, code: "USER_MISMATCH", reason: "Approval was issued for a different operator identity." };
    }

    if (record.targetFile !== normalizedTarget) {
      return { valid: false, code: "TARGET_MISMATCH", reason: "Approval was issued for a different target file." };
    }

    if (record.modificationDigest !== modificationDigest) {
      return { valid: false, code: "DIGEST_MISMATCH", reason: "Proposed modification does not match approved digest." };
    }

    // Mark single-use token as consumed immediately
    record.used = true;
    record.consumedAt = Date.now();

    return { valid: true, challengeId };
  }
}

export const operatorAuthorizationService = new OperatorAuthorizationService();
