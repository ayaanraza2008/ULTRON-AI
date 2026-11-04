# ULTRON AI — Zero-Cost AI Processing & Multi-Tier Fallback
## FREE-FIRST HIERARCHY · RYZEN 7 5700U OPTIMIZATION · OFFLINE RELIABILITY

---

## 1. Zero-Cost Architectural Philosophy

ULTRON operates under a strict **Zero-Cost-First Principle**: no paid subscriptions, credits, billing meters, or commercial cloud fees are required.

The system arranges intelligence providers into a 4-tier waterfall:

```
[ Tier 1: Configured Free Cloud Providers ]
  (OpenRouter Free, Groq Cloud, Cerebras, Google AI Studio)
                        │
                        ▼ (HTTP 429, 500, Timeout)
[ Tier 2: Dynamic Cloud Provider Fallback Chain ]
  (Sequential failover through alternative free providers)
                        │
                        ▼ (Cloud Outage / No Internet)
[ Tier 3: Local AI on AMD Ryzen 7 5700U ]
  (Ollama/llama.cpp · 8 CPU Threads · <= 85% RAM Ceiling Guard)
                        │
                        ▼ (RAM Pressure > 85% or Model Unavailable)
[ Tier 4: Deterministic Offline Intent Engine ]
  (Regex pattern matching & local rule automation)
```

---

## 2. Tier Details & Hardware Constraints

### Tier 1 & 2: Free Cloud AI Providers
- **OpenRouter Free Tier**: Access to free open models (`meta-llama/llama-3.3-70b-instruct:free`, `google/gemini-2.0-flash-exp:free`, `qwen/qwen-2.5-coder-32b-instruct:free`). Rate limits: ~20 requests/minute.
- **Groq Cloud Free Tier**: Hardware LPU acceleration for `llama-3.3-70b-versatile` and `llama-3.1-8b-instant`. Free limits: 30 requests/minute, 6,000 tokens/minute.
- **Cerebras Inference**: Wafer-scale AI engine providing sub-second completions on `llama3.1-8b`. Free limits: 30 requests/minute, 60,000 tokens/minute.
- **Google AI Studio (Gemini)**: Free tier access to `gemini-1.5-flash` and `gemini-2.0-flash`. Free limits: 15 requests/minute, 1,500 requests/day.

### Tier 3: AMD Ryzen 7 5700U Local AI Optimization
- **Hardware Architecture**: AMD Ryzen 7 5700U (8 Cores, 16 Threads, Zen 2/Zen 3 architecture, 1.8 GHz base, 4.3 GHz boost).
- **RAM Constraints**: 8.00 GB DDR4 shared memory.
- **Memory Ceiling Guard**:
  - The runtime continuously monitors `os.freemem()`.
  - If total RAM consumption exceeds **85%** or available free RAM drops below **1.2 GB**, local model inference is blocked to prevent system freeze or swap thrashing.
- **Thread Allocation**: Configured with `num_thread: 8` to maximize performance across Ryzen 7 physical cores.
- **No CUDA Assumptions**: Since the AMD Radeon Graphics are integrated, the engine avoids CUDA code paths and uses AVX2 CPU instructions or Vulkan acceleration.
- **Model Size Ceiling**: Recommended models are capped at **2.5 GB** (`qwen2.5:1.5b` Q4_K_M, `phi3:mini` Q4, or `tinyllama`). The system **never** triggers multi-gigabyte background downloads automatically.

### Tier 4: Deterministic Offline Intent Engine
When all cloud and local model inference paths are unreachable:
- Regex and rule-based parser matches:
  - App launches: "open chrome", "launch vs code", "open notepad", "calculator"
  - Hardware controls: "lock pc", "volume up", "volume down", "mute"
  - Telemetry: "battery", "vitals", "status"
  - Time, date, and basic conversational acknowledgments.
- Zero crashes, zero network calls, instantaneous response.
