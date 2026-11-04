# ULTRON OPENCODE CONNECTION MATRIX

| Service / Tool | Connection method | Connected | Authenticated | Tested | Missing permissions | Remaining actions |
|---|---|---|---|---|---|---|
| GitHub (gh CLI) | HTTPS + OAuth token | Yes | Yes (ayaanraza2008) | Yes (branches/PRs) | None | None |
| GitHub MCP | stdio `@modelcontextprotocol/server-github` | Configured | Token via env | Not exercised this session | `GITHUB_PERSONAL_ACCESS_TOKEN` env | Exercise MCP tools |
| Render (workspace Ultron core) | HTTP MCP / REST | Config not exercised | No `RENDER_API_KEY` in env | No (timeout on core) | Render API key | Obtain key; verify services |
| Render CLI | n/a | Not installed | n/a | No | CLI install | Install if needed (owner approval) |
| Supabase (project opdjfhwepmcprbqojpat) | REST / MCP | REST reachable | Publishable key not in env | Partial (HTTP 404 root) | Service role key, publishable key | Configure env; run diagnostics |
| Supabase CLI | n/a | Not installed | n/a | No | CLI install | Install if needed |
| OpenRouter | REST (OpenAI-compatible) | Not configured | No key | No | `OPENROUTER_API_KEY` | Add key; run smoke test |
| Groq | REST | Not configured | No key | No | `GROQ_API_KEY` | Add key; run smoke test |
| Google Gemini | REST | Key present but invalid | No (401) | Yes (failed) | Valid `GEMINI_API_KEY` | Replace key |
| Ollama (local) | HTTP localhost | Not installed | n/a | No | Install Ollama | Owner decision (no auto-download) |
| ComfyUI | HTTP | Not configured | No | No | `COMFYUI_BASE_URL` | Configure endpoint |
| VoiceStudio | HTTP | Not configured | No | No | `VOICESTUDIO_BASE_URL` | Configure endpoint |
| OmniVoice | HTTP | Not configured | No | No | `OMNIVOICE_API_BASE_URL` | Configure endpoint |
| Hermes Agent | HTTP | Disabled (`HERMES_AGENT_ENABLED=false`) | No | No | Secured endpoint + key + owner UUID | Enable after securing |
| Chatwoot | HTTP | Not configured | No | No | `CHATWOOT_*` | Configure |
| Cal.com | HTTP | Not configured | No | No | `CALDIY_*` | Configure |
| OpenProject | HTTP | Not configured | No | No | `OPENPROJECT_*` | Configure |
| AppFlowy | n/a | Not present | n/a | No | Integration code | Evaluate |
| Obscura | HTTP MCP | Not configured | No | No | `OBSCURA_MCP_URL/TOKEN` | Configure |
| Cactus Compute | HTTP | Not configured | No | No | `CACTUS_BASE_URL` | Configure (no auto-download) |
| AgentMemory | HTTP | Not configured | No | No | `AGENTMEMORY_URL/SECRET` | Configure |
| Browser-use bridge | HTTP | Not configured | No | No | `ULTRON_BROWSER_USE_URL/TOKEN` | Configure |
| Android / ADB | USB/ADB | ADB not installed | n/a | No | ADB + device | Install ADB; device pairing out of software scope |
| Windows companion | .NET 8 WPF | Build verified in CI | n/a | Build only | Physical install | Out of software scope |
| Kokoro TTS | Local ONNX | Model present | n/a | Verified on host | None | None |
| Browser automation (Playwright) | Local | Verified in CI | n/a | Yes | None | None |
| Node.js / npm | Local | Installed v24.20.0 | n/a | Yes | None | None |
| Python | Local | Installed | n/a | Yes | None | None |
| PowerShell | Local | Installed | n/a | Yes | None | None |
| Git | Local | Installed | Yes | Yes | None | None |
| OpenCode MCP (global) | CLI | Installed | n/a | Partial | Project config | Add project-level instructions |

## Legend
- **Connected**: integration is configured and reachable.
- **Authenticated**: valid credentials present and accepted.
- **Tested**: verified by a successful execution or build.