import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { OperatorAuthorizationService } from "../security/operator-authorization.js";

test("OperatorAuthorizationService: issues cryptographic approval challenge bound to user, target, and digest", () => {
  const service = new OperatorAuthorizationService({ serverSecret: "test-secret-12345" });
  const digest = crypto.createHash("sha256").update("new code content").digest("hex");

  const challenge = service.createChallenge({
    ownerUserId: "user-owner-1",
    targetFile: "render.yaml",
    modificationDigest: digest
  });

  assert.ok(challenge.challengeId);
  assert.ok(challenge.approvalToken);
  assert.equal(challenge.targetFile, "render.yaml");
  assert.equal(challenge.modificationDigest, digest);
  assert.ok(new Date(challenge.expiresAt).getTime() > Date.now());

  // Successful verification
  const verify = service.verifyAndConsume({
    ownerUserId: "user-owner-1",
    targetFile: "render.yaml",
    modificationDigest: digest,
    approvalToken: challenge.approvalToken
  });

  assert.equal(verify.valid, true);
  assert.equal(verify.challengeId, challenge.challengeId);
});

test("OperatorAuthorizationService: enforces single-use consumption and blocks replay attacks", () => {
  const service = new OperatorAuthorizationService({ serverSecret: "test-secret-12345" });
  const digest = crypto.createHash("sha256").update("code").digest("hex");

  const challenge = service.createChallenge({
    ownerUserId: "user-owner-1",
    targetFile: "render.yaml",
    modificationDigest: digest
  });

  // First consumption: success
  const first = service.verifyAndConsume({
    ownerUserId: "user-owner-1",
    targetFile: "render.yaml",
    modificationDigest: digest,
    approvalToken: challenge.approvalToken
  });
  assert.equal(first.valid, true);

  // Second consumption attempt: REPLAY_ATTACK_DETECTED
  const second = service.verifyAndConsume({
    ownerUserId: "user-owner-1",
    targetFile: "render.yaml",
    modificationDigest: digest,
    approvalToken: challenge.approvalToken
  });
  assert.equal(second.valid, false);
  assert.equal(second.code, "REPLAY_ATTACK_DETECTED");
});

test("OperatorAuthorizationService: rejects mismatched user, target file, or change digest", () => {
  const service = new OperatorAuthorizationService({ serverSecret: "test-secret-12345" });
  const digest = crypto.createHash("sha256").update("code").digest("hex");

  const challenge = service.createChallenge({
    ownerUserId: "user-owner-1",
    targetFile: "render.yaml",
    modificationDigest: digest
  });

  // User mismatch
  const wrongUser = service.verifyAndConsume({
    ownerUserId: "user-attacker-99",
    targetFile: "render.yaml",
    modificationDigest: digest,
    approvalToken: challenge.approvalToken
  });
  assert.equal(wrongUser.valid, false);

  // Target file mismatch
  const wrongFile = service.verifyAndConsume({
    ownerUserId: "user-owner-1",
    targetFile: "autonomy-policy.js",
    modificationDigest: digest,
    approvalToken: challenge.approvalToken
  });
  assert.equal(wrongFile.valid, false);

  // Digest mismatch
  const wrongDigest = service.verifyAndConsume({
    ownerUserId: "user-owner-1",
    targetFile: "render.yaml",
    modificationDigest: "bad-digest-1234",
    approvalToken: challenge.approvalToken
  });
  assert.equal(wrongDigest.valid, false);
});

test("OperatorAuthorizationService: rejects expired tokens", () => {
  const service = new OperatorAuthorizationService({ serverSecret: "test-secret-12345", tokenTtlMs: -1000 });
  const digest = crypto.createHash("sha256").update("code").digest("hex");

  const challenge = service.createChallenge({
    ownerUserId: "user-owner-1",
    targetFile: "render.yaml",
    modificationDigest: digest
  });

  const res = service.verifyAndConsume({
    ownerUserId: "user-owner-1",
    targetFile: "render.yaml",
    modificationDigest: digest,
    approvalToken: challenge.approvalToken
  });

  assert.equal(res.valid, false);
  assert.equal(res.code, "TOKEN_EXPIRED");
});
