import { checkHermesAgentService } from "../integrations/hermes-agent.js";

const userId = process.env.ULTRON_INTEGRATION_OWNER_USER_ID || "";
const result = await checkHermesAgentService({ userId });

const report = {
  integration: "hermes-agent",
  state: result.state,
  provider: result.provider || "hermes-agent",
  endpointReachable: result.endpointReachable === true,
  configuredModel: result.configuredModel,
  configuredModelListed: result.configuredModelListed,
  capabilities: result.capabilities || {},
  errors: Array.isArray(result.errors) ? result.errors.map(item => ({ code: item.code })) :
    result.error?.code ? [{ code: result.error.code }] : []
};

console.log(JSON.stringify(report, null, 2));
if (result.state !== "completed") process.exitCode = 1;
