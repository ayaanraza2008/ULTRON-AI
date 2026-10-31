/**
 * ULTRON AI — Advanced Brain Router & Intelligence Engine
 *
 * Implements dynamic model routing, task complexity classification,
 * Hindi/English/Hinglish language detection, hallucination detection,
 * and hardware-aware CPU/cloud provider failover.
 */

const COMPLEXITY_PATTERNS = {
  coding: /\b(function|class|const|let|var|def|import|export|refactor|debug|syntax|bug|error|test|git|repo|code|script|api|algorithm|database|sql|endpoint|stack trace|null pointer|undefined)\b/i,
  multimodal: /\b(image|picture|photo|screenshot|camera|webcam|diagram|visual|screen|ui|ocr|look at this|inspect this image)\b/i,
  complex: /\b(architect|plan|strategy|multi-step|evaluate|optimize|decompose|compare all|synthesize|system design|trade-offs|workflow|deep analysis)\b/i,
  analytical: /\b(explain|why|how does|summarize|calculate|analyze|research|investigate|find out|difference between|pros and cons)\b/i
};

const HINGLISH_PATTERNS = [
  /\b(kya|kaise|kyun|kab|kahan|kaun|mera|meri|mere|aap|tum|hum|bhai|kar|karo|karna|de|do|hata|bhejo|dikhao|batao|khol|band|chalao|suno)\b/i,
  /\b(haan|nahi|theek|sahi|galat|accha|bahut|thoda|zyada|jaldi|aaram se|samajh|aaya|gaya|hoga|raha|rahi|rahe)\b/i,
  /\b(kardo|karde|batao|dikhao|likho|padho|chala|rok|roko|samjhao)\b/i
];

const HINDI_DEVANAGARI_REGEX = /[\u0900-\u097F]/;

const UNCERTAINTY_MARKERS = [
  /\b(i think|i believe|i might be wrong|i'm not entirely sure|i cannot guarantee|possibly|perhaps|it could be|it may be|not 100% sure|take this with a grain of salt)\b/i,
  /\b(as an ai|i don't have real-time access|i might hallucinate|unverified speculation|to the best of my guessing)\b/i,
  /\b(shayad|ho sakta hai|pakka nahi pata|mujhe lagta hai|confirm nahi hai)\b/i
];

export class BrainRouter {
  constructor(options = {}) {
    this.env = options.env || process.env;
    this.providerStats = new Map();
    this.offlineMode = false;
    this.circuitBreakers = new Map();
  }

  /**
   * Classify task complexity to route to the ideal model.
   * Hardware aware: keeps routine queries on fast/lightweight models to save 8GB RAM headroom.
   */
  classifyComplexity(prompt, context = {}) {
    const text = typeof prompt === "string" ? prompt : "";
    const hasMedia = Boolean(context.hasMedia || context.imageUrl || context.screenshot);

    if (hasMedia || COMPLEXITY_PATTERNS.multimodal.test(text)) {
      return { tier: "multimodal", modelClass: "vision", recommendedModel: "nvidia/nemotron-3.5-super-vl:free", priority: 1 };
    }
    if (COMPLEXITY_PATTERNS.coding.test(text)) {
      return { tier: "coding", modelClass: "reasoning_code", recommendedModel: "cohere/north-mini-code:free", priority: 2 };
    }
    if (COMPLEXITY_PATTERNS.complex.test(text)) {
      return { tier: "complex", modelClass: "strategic_reasoning", recommendedModel: "openrouter/free", priority: 3 };
    }
    if (COMPLEXITY_PATTERNS.analytical.test(text)) {
      return { tier: "analytical", modelClass: "balanced_chat", recommendedModel: "nvidia/nemotron-3.5-lightning:free", priority: 4 };
    }
    return { tier: "routine", modelClass: "fast_lightweight", recommendedModel: "openrouter/free", priority: 5 };
  }

  /**
   * Detect language and conversational style (English, Hindi, or Hinglish).
   */
  detectLanguage(prompt) {
    if (typeof prompt !== "string" || !prompt.trim()) {
      return { language: "en", script: "latin", dialect: "standard_english", isHinglish: false };
    }

    if (HINDI_DEVANAGARI_REGEX.test(prompt)) {
      return { language: "hi", script: "devanagari", dialect: "pure_hindi", isHinglish: false };
    }

    let hinglishScore = 0;
    for (const pattern of HINGLISH_PATTERNS) {
      const matches = prompt.match(pattern);
      if (matches) hinglishScore += matches.length;
    }

    if (hinglishScore >= 2 || (hinglishScore >= 1 && prompt.split(/\s+/).length <= 4)) {
      return { language: "hinglish", script: "latin", dialect: "conversational_hinglish", isHinglish: true, confidence: Math.min(1, hinglishScore * 0.35 + 0.3) };
    }

    return { language: "en", script: "latin", dialect: "standard_english", isHinglish: false };
  }

  /**
   * Evaluate a model response for uncertainty or potential hallucinations.
   */
  evaluateConfidence(responseText) {
    if (typeof responseText !== "string" || !responseText.trim()) {
      return { confidence: 0, uncertaintyScore: 1.0, flagged: true, markers: ["empty_response"] };
    }

    const markersFound = [];
    for (const marker of UNCERTAINTY_MARKERS) {
      const match = responseText.match(marker);
      if (match) markersFound.push(match[0].toLowerCase());
    }

    // Heuristic scoring: base confidence 0.95, penalized per uncertainty marker
    const penalty = markersFound.length * 0.22;
    const confidence = Math.max(0.1, Number((0.95 - penalty).toFixed(2)));
    const uncertaintyScore = Number((1.0 - confidence).toFixed(2));
    const flagged = uncertaintyScore > 0.45;

    return {
      confidence,
      uncertaintyScore,
      flagged,
      markers: markersFound,
      recommendation: flagged ? "verify_with_tools_or_sources" : "sufficient_confidence"
    };
  }

  /**
   * Select candidate model provider chain with CPU fallback and circuit breaking.
   * Supports Groq and Gemini Flash providers when keys are configured or requested.
   */
  selectProviderChain(taskComplexity = {}) {
    const primaryCloud = {
      name: "openrouter-primary",
      type: "cloud_free",
      model: taskComplexity.recommendedModel || "openrouter/free",
      baseUrl: this.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
      apiKeyEnv: "OPENROUTER_API_KEY",
      supportsTools: true,
      circuitOpen: this.isCircuitOpen("openrouter-primary")
    };

    const secondaryCloud = {
      name: "openrouter-secondary",
      type: "cloud_fallback",
      model: "cohere/north-mini-code:free",
      baseUrl: this.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
      apiKeyEnv: "OPENROUTER_API_KEY",
      supportsTools: true,
      circuitOpen: this.isCircuitOpen("openrouter-secondary")
    };

    const localCpu = {
      name: "ollama-local-cpu",
      type: "local_cpu",
      model: "tinyllama:latest",
      baseUrl: this.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434",
      apiKeyEnv: null,
      supportsTools: false,
      hardwareOptimized: "Ryzen 7 5700U CPU",
      circuitOpen: this.isCircuitOpen("ollama-local-cpu")
    };

    const extraProviders = [];

    if (this.env.GROQ_API_KEY) {
      extraProviders.push({
        name: "groq-cloud",
        type: "cloud_ultra_fast",
        model: taskComplexity.tier === "coding" ? "llama-3.3-70b-versatile" : "llama-3.1-8b-instant",
        baseUrl: this.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1",
        apiKeyEnv: "GROQ_API_KEY",
        supportsTools: true,
        circuitOpen: this.isCircuitOpen("groq-cloud")
      });
    }

    if (this.env.GEMINI_API_KEY) {
      extraProviders.push({
        name: "gemini-flash",
        type: "cloud_multimodal",
        model: "gemini-1.5-flash",
        baseUrl: this.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai",
        apiKeyEnv: "GEMINI_API_KEY",
        supportsTools: true,
        supportsVision: true,
        circuitOpen: this.isCircuitOpen("gemini-flash")
      });
    }

    let candidates = [];
    if (taskComplexity.tier === "multimodal" && this.env.GEMINI_API_KEY) {
      const gemini = extraProviders.find(p => p.name === "gemini-flash");
      candidates = [gemini, primaryCloud, secondaryCloud, ...extraProviders.filter(p => p.name !== "gemini-flash"), localCpu];
    } else if (taskComplexity.preferredProvider === "groq" && this.env.GROQ_API_KEY) {
      const groq = extraProviders.find(p => p.name === "groq-cloud");
      candidates = [groq, primaryCloud, secondaryCloud, ...extraProviders.filter(p => p.name !== "groq-cloud"), localCpu];
    } else {
      candidates = [primaryCloud, secondaryCloud, ...extraProviders, localCpu];
    }

    const chain = candidates.filter(provider => provider && !provider.circuitOpen);
    return chain.length > 0 ? chain : [primaryCloud];
  }

  recordAttempt(providerName, success, latencyMs = 0) {
    const stats = this.providerStats.get(providerName) || { attempts: 0, successes: 0, failures: 0, avgLatencyMs: 0 };
    stats.attempts += 1;
    if (success) {
      stats.successes += 1;
      stats.consecutiveFailures = 0;
      stats.avgLatencyMs = stats.avgLatencyMs === 0 ? latencyMs : Math.round((stats.avgLatencyMs * 0.8) + (latencyMs * 0.2));
    } else {
      stats.failures += 1;
      stats.consecutiveFailures = (stats.consecutiveFailures || 0) + 1;
      if (stats.consecutiveFailures >= 3) {
        this.tripCircuit(providerName, 60_000);
      }
    }
    this.providerStats.set(providerName, stats);
  }

  tripCircuit(providerName, cooldownMs = 60_000) {
    this.circuitBreakers.set(providerName, { resetAt: Date.now() + cooldownMs });
  }

  isCircuitOpen(providerName) {
    const breaker = this.circuitBreakers.get(providerName);
    if (!breaker) return false;
    if (Date.now() > breaker.resetAt) {
      this.circuitBreakers.delete(providerName);
      return false;
    }
    return true;
  }

  getHealthSummary() {
    const summary = {};
    for (const [name, stats] of this.providerStats.entries()) {
      summary[name] = {
        attempts: stats.attempts,
        successRate: stats.attempts ? Number(((stats.successes / stats.attempts) * 100).toFixed(1)) : 100,
        avgLatencyMs: stats.avgLatencyMs,
        circuitOpen: this.isCircuitOpen(name)
      };
    }
    return summary;
  }

  /**
   * Executes inference through the candidate provider chain with automatic fallback,
   * circuit breaker tripping, latency recording, and hallucination scoring.
   */
  async executeInference({ prompt, messages = null, context = {}, preferredProvider = null, fetchImpl = fetch } = {}) {
    const rawPrompt = typeof prompt === "string" ? prompt : "";
    const conversation = Array.isArray(messages) && messages.length > 0
      ? messages
      : [{ role: "user", content: rawPrompt }];

    const complexity = this.classifyComplexity(rawPrompt, context);
    if (preferredProvider) complexity.preferredProvider = preferredProvider;
    const language = this.detectLanguage(rawPrompt);
    const chain = this.selectProviderChain(complexity);

    let lastError = null;

    for (const provider of chain) {
      if (this.isCircuitOpen(provider.name)) continue;

      const apiKey = provider.apiKeyEnv ? this.env[provider.apiKeyEnv] : null;
      if (provider.apiKeyEnv && (!apiKey || !String(apiKey).trim())) {
        continue;
      }

      const startTime = Date.now();
      try {
        const headers = {
          "Content-Type": "application/json",
          "Accept": "application/json"
        };
        if (apiKey) {
          headers["Authorization"] = "Bearer " + apiKey.trim();
        }

        const endpoint = provider.baseUrl.replace(/\/+$/, "") + "/chat/completions";
        const timeoutMs = provider.type === "local_cpu" ? 30_000 : 15_000;

        const response = await fetchImpl(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: provider.model,
            messages: conversation,
            stream: false
          }),
          signal: AbortSignal.timeout(timeoutMs)
        });

        if (!response.ok) {
          throw new Error(`Provider ${provider.name} returned HTTP ${response.status}`);
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || "";
        const latencyMs = Date.now() - startTime;
        this.recordAttempt(provider.name, true, latencyMs);

        const confidence = this.evaluateConfidence(content);

        return {
          success: true,
          content,
          provider: provider.name,
          model: provider.model,
          latencyMs,
          language,
          complexityTier: complexity.tier,
          confidence,
          fallbackCount: chain.indexOf(provider)
        };
      } catch (err) {
        const latencyMs = Date.now() - startTime;
        this.recordAttempt(provider.name, false, latencyMs);
        lastError = err;
      }
    }

    return {
      success: false,
      content: null,
      error: lastError ? lastError.message : "ALL_PROVIDERS_UNAVAILABLE",
      language,
      complexityTier: complexity.tier,
      chainAttempted: chain.map(p => p.name)
    };
  }
}
