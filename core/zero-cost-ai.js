/**
 * ULTRON AI — Zero-Cost-First Autonomous AI Fallback Engine
 * 
 * Implements 4-Tier Zero-Cost AI Hierarchy:
 * Tier 1: Configured Free Cloud AI Providers (OpenRouter free, Groq, Cerebras, Gemini Flash).
 * Tier 2: Dynamic Provider Fallback Mechanism (sequential failover on 429, 500, timeouts).
 * Tier 3: AMD Ryzen 7 5700U Lightweight Local AI (Ollama/llama.cpp, 8 threads, 8 GB RAM safety guard).
 * Tier 4: Deterministic Offline Intent Engine (zero-network rule/pattern processing).
 * 
 * Hardware Profile:
 * - CPU: AMD Ryzen 7 5700U (8 Cores, 16 Threads)
 * - RAM: 8.00 GB DDR4 (85% Safety Ceiling: Throttles if free RAM < 1.2 GB)
 * - GPU: AMD Radeon Graphics (Integrated - CPU AVX2 / Vulkan, No CUDA)
 */

import os from "node:os";

export const FREE_TIER_LIMITS = {
  openrouter_free: {
    name: "OpenRouter Free Models",
    models: ["meta-llama/llama-3.3-70b-instruct:free", "google/gemini-2.0-flash-exp:free", "qwen/qwen-2.5-coder-32b-instruct:free"],
    rateLimit: "20 requests/minute",
    cost: "$0.00 / month"
  },
  groq_free: {
    name: "Groq Cloud Free Tier",
    models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
    rateLimit: "30 requests/minute, 6,000 tokens/minute",
    cost: "$0.00 / month"
  },
  cerebras_free: {
    name: "Cerebras Inference Free Tier",
    models: ["llama3.1-8b", "llama-3.3-70b"],
    rateLimit: "30 requests/minute, 60,000 tokens/minute",
    cost: "$0.00 / month"
  },
  gemini_free: {
    name: "Google AI Studio Free Tier",
    models: ["gemini-1.5-flash", "gemini-2.0-flash"],
    rateLimit: "15 requests/minute, 1,500 requests/day",
    cost: "$0.00 / month"
  },
  ryzen_local_ai: {
    name: "On-Device Local AI (Ollama / GGUF)",
    hardware: "AMD Ryzen 7 5700U · 8 GB RAM",
    recommendedModels: ["qwen2.5:1.5b", "phi3:mini", "tinyllama:latest"],
    maxModelSizeGb: 2.5,
    cost: "$0.00 / month"
  }
};

export class ZeroCostAiEngine {
  constructor(options = {}) {
    this.env = options.env || process.env;
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.logger = options.logger || console;
    this.fallbackHistory = [];
    this.localOllamaUrl = options.localOllamaUrl || this.env.OLLAMA_HOST || "http://127.0.0.1:11434";
  }

  /**
   * Evaluates system RAM headroom for AMD Ryzen 7 5700U with 8 GB RAM.
   * Returns true if safe to run local inference without exhausting system memory.
   */
  checkRyzenMemorySafety() {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedPercent = ((totalMem - freeMem) / totalMem) * 100;
    const freeMb = freeMem / (1024 * 1024);

    // RAM Safety Ceiling: If RAM used > 85% or free RAM < 1200 MB, reject local model loading
    const isSafe = usedPercent <= 85.0 && freeMb >= 1200;

    return {
      isSafe,
      totalMemGb: Number((totalMem / (1024 * 1024 * 1024)).toFixed(2)),
      freeMemGb: Number((freeMem / (1024 * 1024 * 1024)).toFixed(2)),
      usedPercent: Number(usedPercent.toFixed(1)),
      cpuModel: os.cpus()[0]?.model || "AMD Ryzen 7 5700U",
      cpuCores: os.cpus().length,
      warning: !isSafe ? "RAM pressure exceeds 85% safety ceiling. Local model execution throttled." : null
    };
  }

  /**
   * Discovers free cloud providers configured in the environment.
   */
  getFreeCloudProviders() {
    const providers = [];

    // 1. OpenRouter
    const openRouterKey = this.env.OPENROUTER_API_KEY?.trim();
    if (openRouterKey) {
      providers.push({
        name: "openrouter_free",
        tier: 1,
        baseUrl: (this.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").trimEnd("/"),
        apiKey: openRouterKey,
        defaultModel: this.env.OPENROUTER_DEFAULT_MODEL || "openrouter/free"
      });
    }

    // 2. Groq
    const groqKey = this.env.GROQ_API_KEY?.trim();
    if (groqKey) {
      providers.push({
        name: "groq_free",
        tier: 1,
        baseUrl: "https://api.groq.com/openai/v1",
        apiKey: groqKey,
        defaultModel: "llama-3.3-70b-versatile"
      });
    }

    // 3. Cerebras
    const cerebrasKey = this.env.CEREBRAS_API_KEY?.trim();
    if (cerebrasKey) {
      providers.push({
        name: "cerebras_free",
        tier: 1,
        baseUrl: "https://api.cerebras.ai/v1",
        apiKey: cerebrasKey,
        defaultModel: "llama3.1-8b"
      });
    }

    // 4. Gemini AI Studio
    const geminiKey = this.env.GEMINI_API_KEY?.trim();
    if (geminiKey) {
      providers.push({
        name: "gemini_free",
        tier: 1,
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
        apiKey: geminiKey,
        defaultModel: "gemini-1.5-flash"
      });
    }

    return providers;
  }

  /**
   * Attempts local Ollama inference on AMD Ryzen 7 5700U CPU threads.
   */
  async tryLocalInference(prompt, systemPrompt = "") {
    const memoryCheck = this.checkRyzenMemorySafety();
    if (!memoryCheck.isSafe) {
      return { success: false, reason: "MEMORY_SAFETY_GUARD", memoryCheck };
    }

    try {
      const response = await this.fetchImpl(`${this.localOllamaUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "qwen2.5:1.5b",
          prompt: `${systemPrompt}\nUser: ${prompt}\nAssistant:`,
          stream: false,
          options: {
            num_thread: 8, // Utilize Ryzen 7 5700U 8 cores
            temperature: 0.6
          }
        }),
        signal: AbortSignal.timeout(10_000)
      });

      if (!response.ok) {
        return { success: false, reason: `HTTP_${response.status}` };
      }

      const data = await response.json();
      return {
        success: true,
        text: data.response || "",
        tier: 3,
        provider: "ryzen_7_5700u_local_ollama",
        model: "qwen2.5:1.5b"
      };
    } catch (err) {
      return { success: false, reason: err.name || "LOCAL_AI_UNAVAILABLE" };
    }
  }

  /**
   * Deterministic Offline Intent Engine (Tier 4).
   * Executes pattern matching when all cloud and local model inference is unavailable.
   */
  processOfflineIntent(text = "") {
    const lower = String(text || "").toLowerCase().trim();

    // 1. Cross-device app launch
    if (lower.includes("chrome")) {
      return { matched: true, tier: 4, action: "launch_app", targetApp: "chrome", reply: "Affirmative. Launching Google Chrome." };
    }
    if (lower.includes("edge")) {
      return { matched: true, tier: 4, action: "launch_app", targetApp: "msedge", reply: "Launching Microsoft Edge." };
    }
    if (lower.includes("code") || lower.includes("vscode")) {
      return { matched: true, tier: 4, action: "launch_app", targetApp: "code", reply: "Opening Visual Studio Code workspace." };
    }
    if (lower.includes("notepad")) {
      return { matched: true, tier: 4, action: "launch_app", targetApp: "notepad", reply: "Opening Notepad." };
    }
    if (lower.includes("calc")) {
      return { matched: true, tier: 4, action: "launch_app", targetApp: "calculator", reply: "Opening Calculator." };
    }
    if (lower.includes("terminal") || lower.includes("cmd")) {
      return { matched: true, tier: 4, action: "launch_app", targetApp: "terminal", reply: "Launching Windows Terminal." };
    }

    // 2. Workstation control
    if (lower.includes("lock")) {
      return { matched: true, tier: 4, action: "lock_workstation", reply: "Locking Windows workstation. Security armed." };
    }
    if (lower.includes("volume up")) {
      return { matched: true, tier: 4, action: "set_volume", value: "up", reply: "Increasing system volume." };
    }
    if (lower.includes("volume down")) {
      return { matched: true, tier: 4, action: "set_volume", value: "down", reply: "Decreasing system volume." };
    }
    if (lower.includes("mute")) {
      return { matched: true, tier: 4, action: "set_volume", value: "mute", reply: "Muting system audio." };
    }

    // 3. System status
    if (lower.includes("status") || lower.includes("battery") || lower.includes("vitals")) {
      return { matched: true, tier: 4, action: "get_system_vitals", reply: "ULTRON Core is nominal. Querying PC hardware vitals." };
    }

    // 4. Conversational greetings
    if (lower.includes("hello") || lower.includes("hi ultron") || lower.includes("namaste")) {
      return { matched: true, tier: 4, action: "greeting", reply: "Greetings Ayaan. All systems operational. How may I assist you?" };
    }

    return {
      matched: false,
      tier: 4,
      action: "offline_fallback",
      reply: "ULTRON offline mode active. Standing by for approved commands."
    };
  }

  /**
   * Executes completion with strict zero-cost fallback through all 4 tiers.
   */
  async completeWithFallback({ prompt, systemPrompt = "", temperature = 0.7, maxTokens = 800 }) {
    const attempts = [];

    // --- Tier 1 & 2: Free Cloud Providers with Sequential Fallback ---
    const cloudProviders = this.getFreeCloudProviders();
    for (const provider of cloudProviders) {
      try {
        const response = await this.fetchImpl(`${provider.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${provider.apiKey}`
          },
          body: JSON.stringify({
            model: provider.defaultModel,
            messages: [
              ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
              { role: "user", content: prompt }
            ],
            temperature,
            max_tokens: maxTokens
          }),
          signal: AbortSignal.timeout(12_000)
        });

        if (response.ok) {
          const data = await response.json();
          const content = data.choices?.[0]?.message?.content || "";
          if (content.trim()) {
            return {
              success: true,
              text: content.trim(),
              tier: 1,
              provider: provider.name,
              model: provider.defaultModel,
              attempts
            };
          }
        }

        attempts.push({ provider: provider.name, status: response.status, fallback: true });
      } catch (err) {
        attempts.push({ provider: provider.name, error: err.name || "ERROR", fallback: true });
      }
    }

    // --- Tier 3: Local AI on AMD Ryzen 7 5700U ---
    const localResult = await this.tryLocalInference(prompt, systemPrompt);
    if (localResult.success) {
      return {
        ...localResult,
        attempts
      };
    }
    attempts.push({ provider: "ryzen_local_ai", reason: localResult.reason, fallback: true });

    // --- Tier 4: Offline Deterministic Engine ---
    const offlineResult = this.processOfflineIntent(prompt);
    return {
      success: true,
      text: offlineResult.reply,
      tier: 4,
      provider: "offline_deterministic_rules",
      action: offlineResult.action,
      attempts
    };
  }

  /**
   * Generates comprehensive free-tier cost & resource audit report.
   */
  getFreeTierAuditReport() {
    const memory = this.checkRyzenMemorySafety();
    const cloudProviders = this.getFreeCloudProviders();

    return {
      zeroCostCompliance: true,
      monthlyInfrastructureCost: "$0.00",
      activeCloudProviders: cloudProviders.map(p => ({
        provider: p.name,
        baseUrl: p.baseUrl,
        model: p.defaultModel
      })),
      localHardware: {
        processor: "AMD Ryzen 7 5700U (8C/16T)",
        totalRamGb: memory.totalMemGb,
        freeRamGb: memory.freeMemGb,
        memoryHeadroomSafe: memory.isSafe,
        maxSafeModelSizeGb: 2.5,
        cudaRequired: false,
        accelerationMethod: "CPU AVX2 / Vulkan Compute"
      },
      tiersConfigured: [
        { tier: 1, description: "Configured Free Cloud Providers (OpenRouter, Groq, Cerebras, Gemini)" },
        { tier: 2, description: "Dynamic Multi-Provider Fallback on Rate-Limits or HTTP 5xx" },
        { tier: 3, description: "Ryzen 7 5700U Local Model Inference (8 Cores, <= 85% RAM Guard)" },
        { tier: 4, description: "Offline Pattern & Intent Rule Dispatcher" }
      ],
      freeTierLimits: FREE_TIER_LIMITS,
      timestamp: new Date().toISOString()
    };
  }
}

export const zeroCostAiEngine = new ZeroCostAiEngine();
