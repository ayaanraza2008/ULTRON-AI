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
  assert.equal(items.length, 43);
  assert.equal(new Set(items.map(item => item.id)).size, 43);
  assert.ok(items.some(item => item.repo === "darkzOGx/youtube-automation-agent"));
  assert.ok(items.some(item => item.repo === "morluto/rea"));
  assert.ok(items.some(item => item.repo === "h4ckf0r0day/obscura"));
  assert.ok(items.some(item => item.repo === "cactus-compute/cactus"));
  assert.ok(items.some(item => item.repo === "NousResearch/hermes-agent"));
  assert.ok(items.some(item => item.repo === "p-e-w/heretic"));
  assert.ok(items.some(item => item.repo === "SaarthurR/atticus-mac"));
  assert.ok(items.some(item => item.repo === "affaan-m/ECC"));
  assert.ok(items.some(item => item.repo === "Niko1221/Strata"));
  assert.ok(items.some(item => item.id === "chrome-devtools"));
});

test("capability router matches distinct task domains automatically", () => {
  const results = matchRepositoryCapabilities("Research a YouTube channel launch plan and triage the Chatwoot support inbox");
  const ids = results.map(item => item.id);
  assert.ok(ids.includes("youtube-automation-agent"));
  assert.ok(ids.includes("chatwoot"));
  const hermes = matchRepositoryCapabilities("Use Hermes Agent to delegate work to subagents and create reusable skills");
  assert.ok(hermes.some(item => item.id === "hermes-agent"));
});

test("new screenshot repositories have explicit safe/unverified states", () => {
  const status = getRepositoryCapabilityStatus({});
  const byId = Object.fromEntries(status.integrations.map(item => [item.id, item]));
  assert.equal(byId["heretic"].state, "review_required_license_and_resource_gate");
  assert.equal(byId["open-generative-ai"].state, "adapter_not_implemented");
  assert.equal(byId["agency-agents"].state, "guidance_only");
  assert.equal(byId["jcode"].state, "local_cli_runtime_required");
  assert.equal(byId["open-generative-ai"].repo, "Anil-matcha/Open-Generative-AI");
  assert.equal(byId["agency-agents"].repo, "msitarzewski/agency-agents");
  assert.equal(byId["jcode"].repo, "1jehuang/jcode");
  assert.equal(byId["atticus-mac"].state, "desktop_companion_required");
  assert.equal(byId["ecc"].state, "task_aware_skill_selector");
  assert.equal(byId["strata"].state, "optional");
  assert.equal(byId["open-seo"].state, "missing_configuration");
  assert.equal(byId["open-higgsfield"].state, "disabled_by_config");
  assert.equal(byId["open-design"].state, "disabled_by_config");
  const openDesignSecret = "synthetic-open-design-daemon-token";
  const configuredOpenDesign = getRepositoryCapabilityStatus({
    OPEN_DESIGN_ENABLED: "true",
    OPEN_DESIGN_BASE_URL: "https://design.example.com",
    OPEN_DESIGN_API_TOKEN: openDesignSecret,
    OPEN_DESIGN_PROJECT_ID: "personal_project_123",
    OPEN_DESIGN_BYOK_BASE_URL: "https://openrouter.ai/api/v1",
    OPEN_DESIGN_BYOK_API_KEY: "synthetic-provider-token",
    OPEN_DESIGN_BYOK_MODEL: "openrouter/free",
    ULTRON_INTEGRATION_OWNER_USER_ID: "00000000-0000-4000-8000-000000000001"
  }).integrations.find(item => item.id === "open-design");
  assert.equal(configuredOpenDesign.state, "configured_unverified");
  assert.equal(configuredOpenDesign.configured, true);
  assert.equal(JSON.stringify(configuredOpenDesign).includes(openDesignSecret), false);
  assert.equal(JSON.stringify(configuredOpenDesign).includes("synthetic-provider-token"), false);
  const hfConfigured = getRepositoryCapabilityStatus({
    ULTRON_OPEN_HIGGSFIELD_ENABLED: "true",
    HF_API_BASE_URL: "https://api.higgsfield.ai",
    OPEN_HIGGSFIELD_API_KEY: "synthetic-id:synthetic-secret-12345",
    ULTRON_INTEGRATION_OWNER_USER_ID: "00000000-0000-4000-8000-000000000001"
  }).integrations.find(item => item.id === "open-higgsfield");
  assert.equal(hfConfigured.state, "configured_unverified");
  assert.equal(hfConfigured.configured, true);
  assert.equal(JSON.stringify(hfConfigured).includes("synthetic-secret-12345"), false);
  const openSeoSecret = "oseo_test-key-abcdef123456";
  const configuredOpenSeo = getRepositoryCapabilityStatus({
    OPENSEO_API_KEY: openSeoSecret,
    ULTRON_INTEGRATION_OWNER_USER_ID: "00000000-0000-4000-8000-000000000001"
  }).integrations.find(item => item.id === "open-seo");
  assert.equal(configuredOpenSeo.state, "configured_unverified");
  assert.equal(configuredOpenSeo.configured, true);
  assert.equal(JSON.stringify(configuredOpenSeo).includes(openSeoSecret), false);
  const configuredStrata = getRepositoryCapabilityStatus({ STRATA_BASE_URL: "http://127.0.0.1:8080/v1", STRATA_MODEL: "local-model" }).integrations.find(item => item.id === "strata");
  assert.equal(configuredStrata.state, "configured_unverified");
  assert.equal(configuredStrata.configured, true);
  for (const id of ["free-cloud-code", "not-ai", "dramadaw", "opendudley"]) {
    assert.equal(byId[id].state, "review_required_upstream_unverified", id);
  }
  assert.equal(byId["chrome-devtools"].state, "blocked");
  assert.equal(status.verification, "configuration_and_capability_registry_only");
});

test("new repo topics route to their documented capability entries", () => {
  assert.ok(matchRepositoryCapabilities("Review the ECC engineering workflow for coding agents").some(item => item.id === "ecc"));
  assert.ok(matchRepositoryCapabilities("Can Strata run a local OpenAI-compatible model server?").some(item => item.id === "strata"));
  assert.ok(matchRepositoryCapabilities("collect Chrome DevTools console errors and performance trace").some(item => item.id === "chrome-devtools"));
  assert.ok(matchRepositoryCapabilities("review Heretic model-weight experiments").some(item => item.id === "heretic"));
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
    OPENPROJECT_BASE_URL: "https://projects.example.com",
    OPENPROJECT_API_TOKEN: "configured-token",
    CALDIY_BASE_URL: "https://cal.example.com",
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
    OPENVIKING_BASE_URL: "https://openviking.example.com",
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
