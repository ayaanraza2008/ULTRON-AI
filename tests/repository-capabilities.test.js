import test from "node:test";
import assert from "node:assert/strict";
import {
  listRepositoryCapabilities,
  matchRepositoryCapabilities,
  buildRepositoryCapabilityGuidance,
  getRepositoryCapabilityStatus
} from "../repository-capabilities.js";

test("registry contains every requested repository exactly once", () => {
  const items = listRepositoryCapabilities();
  assert.equal(items.length, 31);
  assert.equal(new Set(items.map(item => item.id)).size, 31);
  assert.ok(items.some(item => item.repo === "darkzOGx/youtube-automation-agent"));
  assert.ok(items.some(item => item.repo === "morluto/rea"));
  assert.ok(items.some(item => item.repo === "h4ckf0r0day/obscura"));
  assert.ok(items.some(item => item.repo === "cactus-compute/cactus"));
  assert.ok(items.some(item => item.repo === "NousResearch/hermes-agent"));
});

test("capability router matches distinct task domains automatically", () => {
  const results = matchRepositoryCapabilities("Research a YouTube channel launch plan and triage the Chatwoot support inbox");
  const ids = results.map(item => item.id);
  assert.ok(ids.includes("youtube-automation-agent"));
  assert.ok(ids.includes("chatwoot"));
  const hermes = matchRepositoryCapabilities("Use Hermes Agent to delegate work to subagents and create reusable skills");
  assert.ok(hermes.some(item => item.id === "hermes-agent"));
});

test("matching is bounded and empty tasks do not pick arbitrary repositories", () => {
  assert.deepEqual(matchRepositoryCapabilities("   "), []);
  assert.ok(matchRepositoryCapabilities("research paper statistics diagrams security audit", { limit: 2 }).length <= 2);
});

test("readiness reports key names/states without returning credential values", () => {
  const secret = "do-not-return-this-secret";
  const status = getRepositoryCapabilityStatus({
    ULTRON_INTEGRATION_OWNER_USER_ID: "00000000-0000-4000-8000-000000000001",
    CHATWOOT_BASE_URL: "https://support.example.test",
    CHATWOOT_API_TOKEN: secret,
    CHATWOOT_ACCOUNT_ID: "12",
    GEO_SLEUTH_ENABLED: "true",
    GEO_SLEUTH_ROOT: "/opt/geo-sleuth",
    OPENPROJECT_BASE_URL: "https://projects.example",
    OPENPROJECT_API_TOKEN: "configured-token",
    CALDIY_BASE_URL: "https://cal.example",
    CALDIY_API_TOKEN: "cal-secret"
  });
  const chatwoot = status.integrations.find(item => item.id === "chatwoot");
  const geo = status.integrations.find(item => item.id === "geo-sleuth");
  const openproject = status.integrations.find(item => item.id === "openproject");
  const caldiy = status.integrations.find(item => item.id === "cal-diy");
  const godsEye = status.integrations.find(item => item.id === "gods-eye-view");
  const kaliGpt = status.integrations.find(item => item.id === "kaligpt");
  const openViking = status.integrations.find(item => item.id === "openviking");
  assert.equal(openViking.state, "missing_configuration");
  const configuredOpenViking = getRepositoryCapabilityStatus({
    OPENVIKING_BASE_URL: "https://openviking.example",
    OPENVIKING_API_TOKEN: "openviking-synthetic-secret",
    ULTRON_INTEGRATION_OWNER_USER_ID: "00000000-0000-4000-8000-000000000001"
  }).integrations.find(item => item.id === "openviking");
  assert.equal(configuredOpenViking.state, "configured_unverified");
  assert.equal(godsEye.state, "adapter_present_unverified_live");
  assert.equal(kaliGpt.state, "bounded_security_routes_present");
  assert.equal(chatwoot.state, "configured_unverified");
  assert.equal(geo.state, "configured_unverified");
  assert.equal(openproject.state, "configured_unverified");
  assert.equal(caldiy.state, "configured_unverified");
  assert.equal(JSON.stringify(status).includes(secret), false);
  assert.equal(JSON.stringify(status).includes("configured-token"), false);
  assert.equal(JSON.stringify(status).includes("cal-secret"), false);
  assert.equal(status.integrations.find(item => item.id === "hermes-agent").state, "disabled_by_config");
});

test("task guidance states real limitations and selects matches", () => {
  const guidance = buildRepositoryCapabilityGuidance("Please schedule a meeting using Cal.diy");
  assert.ok(guidance.matches.some(item => item.id === "cal-diy"));
  assert.ok(guidance.rules.some(rule => rule.includes("adapter_not_implemented")));
  assert.ok(guidance.rules.some(rule => rule.includes("Do not invoke metered providers")));
});
