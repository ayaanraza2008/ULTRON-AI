# ULTRON AI — DSH-GOD Provider Registry Overview

## 1. Registry Summary

- **Total Registered Providers:** 76
- **Categories:** `apikey`, `free`, `free-tier`, `local`, `oauth`
- **Wire Formats:** `openai-chat`, `openai-responses`, `anthropic-messages`
- **Authentication Types:** `apiKey`, `none`, `oauth`, `adc`
- **Location:** `integrations/dsh-god/provider-registry.json`

---

## 2. Categorized Providers Breakdown

### A. API Key Providers (`apikey`)
Major commercial model providers and platforms requiring standard API keys:
- OpenAI, Anthropic, Mistral AI, Cohere, Groq, DeepSeek, Cerebras, SambaNova, Together AI, Fireworks AI, Perplexity, Voyage AI, AI21 Labs, Replicate, Upstage, Novita, 01.AI, Zhipu AI, Moonshot AI, Baichuan, StepFun, DeepInfra, OpenRouter, Hyperbolic, Lepton AI, Scaleway, SiliconFlow, OctoAI, FriendliAI, Lambda, MonsterAPI, Anyscale, Predibase, etc.

### B. Free & Free-Tier Providers (`free` & `free-tier`)
Keyless and pooled zero-cost inference providers:
- OpenCode Zen / Free Inference v1 (`https://opencode.ai/inference/v1`)
- Kilo AI Free Pool (`https://api.kilo.ai/api/gateway`)
- Cloudflare Workers AI Free Tier
- Hugging Face Inference API Free Tier
- GitHub Models Playground Free Tier
- Google AI Studio (Free quota tier)

### C. Local Model Runners (`local`)
Keyless local engine and self-hosted runners:
- Ollama (`http://127.0.0.1:11434`)
- LM Studio (`http://127.0.0.1:1234`)
- vLLM (`http://127.0.0.1:8000`)
- LocalAI (`http://127.0.0.1:8080`)
- llama.cpp server (`http://127.0.0.1:8080`)
- Aphrodite Engine
- TGI (Text Generation Inference)

### D. Cloud & Enterprise OAuth / ADC Providers (`oauth`, `adc`)
- Google Cloud Vertex AI (Application Default Credentials)
- Microsoft Azure OpenAI Service
- Amazon Bedrock (AWS Signature v4 / IAM)
- IBM watsonx.ai
- Oracle Cloud Infrastructure GenAI

---

## 3. Excluded Denied Channels Policy

The following channels are explicitly filtered and denied by `isDeniedChannel()`:
1. `workbuddy` (and `workbuddy-ai`, `codebuddy`, `codebuddy-cn`): Excluded due to unsigned client fingerprint spoofing risks.
2. `huaweicloud` (and `codearts`, `modelarts`): Excluded per upstream product safety boundary.
