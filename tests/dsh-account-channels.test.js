import test from "node:test";
import assert from "node:assert/strict";
import {
  listAccountChannels,
  getAccountChannel,
  configureAccountChannel,
  removeAccountChannel,
  getAccountChannelStatusReport,
  ACCOUNT_CHANNELS,
} from "../integrations/dsh-god/account-channels.js";

test("DSH Account Channels: registers all 10 audited standalone channels", () => {
  assert.equal(ACCOUNT_CHANNELS.length, 10);

  const expectedChannels = [
    "lobsterai", "qoder", "qoder-cn", "trae", "cline",
    "loomy", "raccoon", "minimax-code", "zcode", "gemini-channel"
  ];

  for (const id of expectedChannels) {
    const ch = getAccountChannel(id);
    assert.ok(ch, `Channel ${id} must exist in catalog`);
    assert.equal(ch.status, "audited");
    assert.equal(ch.hardwareProfile, "pure-js");
  }
});

test("DSH Account Channels: manages configuration and credentials storage", () => {
  const trae = configureAccountChannel("trae", {
    token: "mock-trae-token-xyz",
    account: "user@example.com"
  });

  assert.equal(trae.configured, true);

  const report = getAccountChannelStatusReport();
  assert.equal(report.totalChannels, 10);
  assert.ok(report.configuredCount >= 1);

  removeAccountChannel("trae");
  const cleared = getAccountChannel("trae");
  assert.equal(cleared.configured, false);
});
