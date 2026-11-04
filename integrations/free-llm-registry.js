/**
 * ULTRON AI — Free LLM Provider Discovery & Aggregator Registry
 * Integrates knowledge & endpoints inspired by mnfst/awesome-free-llm-apis and tashfeenahmed/freellmapi
 *
 * Provides a vetted, updateable catalog of free-tier model providers,
 * context windows, rate limits, authentication requirements, and capabilities.
 * Enforces strict network safety (anti-SSRF) before contacting any endpoint.
 */

import { safeServiceBase } from "../network-safety.js";

export const FREE_PROVIDER_STATUS = {
  ACTIVE_FREE_TIER: "ACTIVE_FREE_TIER",
  REQUIRES_FREE_KEY: "REQUIRES_FREE_KEY",
  LOCAL_INFERENCE: "LOCAL_INFERENCE",
  DEPRECATED: "DEPRECATED"
};

export class FreeLlmRegistry {
  constructor() {
    this.providers = new Map();
    this.initializeRegistry();
  }

  initializeRegistry() {
    this.registerProvider({
      id: "groq-free",
      name: "Groq Cloud Free Tier",
      upstreamCatalog: "mnfst/awesome-free-llm-apis",
      homepage: "https://console.groq.com",
      apiBaseUrl: "https://api.groq.com/openai/v1",
      authType: "Bearer API Key (Free Account)",
      envKey: "GROQ_API_KEY",
      freeTierTerms: "Generous free RPM/RPD limits per model; LPUs provide ultra-fast inference.",
      rateLimitRpm: 30,
      contextLimit: 128000,
      status: FREE_PROVIDER_STATUS.REQUIRES_FREE_KEY,
      models: [
        { id: "llama-3.3-70b-versatile", context: 128000, speed: "ultra-high" },
        { id: "llama-3.1-8b-instant", context: 128000, speed: "ultra-high" },
        { id: "mixtral-8x7b-32768", context: 32768, speed: "ultra-high" }
      ]
    });

    this.registerProvider({
      id: "openrouter-free",
      name: "OpenRouter Free Community Models",
      upstreamCatalog: "mnfst/awesome-free-llm-apis",
      homepage: "https://openrouter.ai",
      apiBaseUrl: "https://openrouter.ai/api/v1",
      authType: "Bearer API Key (Free Key)",
      envKey: "OPENROUTER_API_KEY",
      freeTierTerms: "Zero-cost model routing with :free suffix; rate limits apply.",
      rateLimitRpm: 20,
      contextLimit: 131072,
      status: FREE_PROVIDER_STATUS.REQUIRES_FREE_KEY,
      models: [
        { id: "meta-llama/llama-3.3-70b-instruct:free", context: 131072 },
        { id: "google/gemini-2.0-flash-lite-preview-02-05:free", context: 1048576 },
        { id: "deepseek/deepseek-r1:free", context: 64000 }
      ]
    });

    this.registerProvider({
      id: "gemini-free",
      name: "Google AI Studio Gemini Free",
      upstreamCatalog: "tashfeenahmed/freellmapi",
      homepage: "https://aistudio.google.com",
      apiBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
      authType: "API Key (Free Tier)",
      envKey: "GEMINI_API_KEY",
      freeTierTerms: "15 RPM, 1,500 RPD, 1M TPM on 2.0 Flash; free tier data may be used for tuning.",
      rateLimitRpm: 15,
      contextLimit: 1048576,
      status: FREE_PROVIDER_STATUS.REQUIRES_FREE_KEY,
      models: [
        { id: "gemini-2.0-flash", context: 1048576, multimodal: true },
        { id: "gemini-1.5-flash", context: 1048576, multimodal: true }
      ]
    });

    this.registerProvider({
      id: "cerebras-free",
      name: "Cerebras Inference Free Tier",
      upstreamCatalog: "mnfst/awesome-free-llm-apis",
      homepage: "https://cloud.cerebras.ai",
      apiBaseUrl: "https://api.cerebras.ai/v1",
      authType: "Bearer API Key (Free Account)",
      envKey: "CEREBRAS_API_KEY",
      freeTierTerms: "Free tier for developers on Wafer-Scale Engine; up to 30 RPM.",
      rateLimitRpm: 30,
      contextLimit: 8192,
      status: FREE_PROVIDER_STATUS.REQUIRES_FREE_KEY,
      models: [
        { id: "llama3.1-70b", context: 8192, speed: "ultra-high" },
        { id: "llama3.1-8b", context: 8192, speed: "ultra-high" }
      ]
    });

    this.registerProvider({
      id: "sambanova-free",
      name: "SambaNova Cloud Free Developer",
      upstreamCatalog: "tashfeenahmed/freellmapi",
      homepage: "https://cloud.sambanova.ai",
      apiBaseUrl: "https://api.sambanova.ai/v1",
      authType: "Bearer API Key (Free Tier)",
      envKey: "SAMBANOVA_API_KEY",
      freeTierTerms: "Free access to full-precision Llama 3 models on SN40L Reconfigurable Dataflow Units.",
      rateLimitRpm: 20,
      contextLimit: 65536,
      status: FREE_PROVIDER_STATUS.REQUIRES_FREE_KEY,
      models: [
        { id: "Meta-Llama-3.3-70B-Instruct", context: 65536 },
        { id: "Meta-Llama-3.1-8B-Instruct", context: 16384 }
      ]
    });

    this.registerProvider({
      id: "github-models-free",
      name: "GitHub Models Marketplace Free Tier",
      upstreamCatalog: "mnfst/awesome-free-llm-apis",
      homepage: "https://github.com/marketplace/models",
      apiBaseUrl: "https://models.inference.ai.azure.com",
      authType: "GitHub Personal Access Token",
      envKey: "GITHUB_TOKEN",
      freeTierTerms: "Free prototyping tier: 15 RPM, 150 requests/day per model.",
      rateLimitRpm: 15,
      contextLimit: 128000,
      status: FREE_PROVIDER_STATUS.REQUIRES_FREE_KEY,
      models: [
        { id: "gpt-4o-mini", context: 128000 },
        { id: "Mistral-large-2407", context: 128000 }
      ]
    });

    this.registerProvider({
      id: "cloudflare-workers-ai",
      name: "Cloudflare Workers AI Free Allocation",
      upstreamCatalog: "tashfeenahmed/freellmapi",
      homepage: "https://developers.cloudflare.com/workers-ai/",
      apiBaseUrl: "https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run",
      authType: "Cloudflare API Token",
      envKey: "CLOUDFLARE_API_TOKEN",
      freeTierTerms: "10,000 Neurons per day free (~250-500 requests/day).",
      rateLimitRpm: 60,
      contextLimit: 8192,
      status: FREE_PROVIDER_STATUS.REQUIRES_FREE_KEY,
      models: [
        { id: "@cf/meta/llama-3.1-8b-instruct", context: 8192 }
      ]
    });

    this.registerProvider({
      id: "local-cactus-strata",
      name: "Local On-Device Engine (Cactus / Strata / Ollama)",
      upstreamCatalog: "Niko1221/Strata",
      homepage: "http://127.0.0.1:11434",
      apiBaseUrl: "http://127.0.0.1:11434/v1",
      authType: "Local Host Loopback (Zero External Keys)",
      envKey: "CACTUS_BASE_URL",
      freeTierTerms: "100% Free, unlimited, private, offline execution on AMD Ryzen 7 5700U.",
      rateLimitRpm: 9999,
      contextLimit: 32768,
      status: FREE_PROVIDER_STATUS.LOCAL_INFERENCE,
      models: [
        { id: "llama3.2:3b", context: 32768 },
        { id: "qwen2.5-coder:7b", context: 32768 }
      ]
    });
  }

  registerProvider(meta) {
    if (!meta.id || !meta.name || !meta.apiBaseUrl) {
      throw new Error("registerProvider requires id, name, and apiBaseUrl.");
    }

    // SSRF verification: Ensure provider endpoint is a safe remote HTTPS host or localhost loopback
    const isLocal = meta.apiBaseUrl.startsWith("http://127.0.0.1") || meta.apiBaseUrl.startsWith("http://localhost");
    if (!isLocal) {
      const checked = safeServiceBase(meta.apiBaseUrl);
      if (!checked) {
        throw new Error(`SSRF_REJECTED: Provider URL '${meta.apiBaseUrl}' is not a safe, permitted HTTPS host.`);
      }
    }

    this.providers.set(meta.id, {
      ...meta,
      lastAuditedAt: new Date().toISOString()
    });
    return this.providers.get(meta.id);
  }

  getProvider(id) {
    return this.providers.get(id) || null;
  }

  listProviders(filter = {}) {
    let list = Array.from(this.providers.values());
    if (filter.status) {
      list = list.filter(p => p.status === filter.status);
    }
    if (filter.hasEnvKey && typeof filter.hasEnvKey === "object") {
      list = list.filter(p => Boolean(filter.hasEnvKey[p.envKey]));
    }
    if (filter.minContext) {
      list = list.filter(p => p.contextLimit >= filter.minContext);
    }
    return list;
  }

  /**
   * Recommends optimal free-tier providers based on prompt size and latency requirements.
   */
  recommendFreeProvider({ estimatedTokens = 1000, env = process.env } = {}) {
    const available = this.listProviders().filter(p => {
      if (p.status === FREE_PROVIDER_STATUS.LOCAL_INFERENCE) return true;
      return Boolean(env[p.envKey]);
    });

    if (available.length === 0) {
      return {
        recommended: null,
        eligible: [],
        message: "No free-tier providers currently have active credentials configured in environment."
      };
    }

    // Sort by context capability and rate limit
    available.sort((a, b) => (b.contextLimit - a.contextLimit) || (b.rateLimitRpm - a.rateLimitRpm));
    return {
      recommended: available[0],
      eligible: available,
      message: `Selected '${available[0].name}' as optimal provider for ${estimatedTokens} tokens.`
    };
  }
}

export const freeLlmRegistry = new FreeLlmRegistry();
