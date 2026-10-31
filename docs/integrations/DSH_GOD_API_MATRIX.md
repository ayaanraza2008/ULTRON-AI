# ULTRON AI — DSH-GOD API Endpoint Matrix

## 1. Management REST API Endpoints (`/api/integrations/dsh-god/*`)

All management endpoints are gated by Supabase owner authentication in production.

| Method | Endpoint | Description | Request Payload | Response Schema |
|---|---|---|---|---|
| `GET` | `/status` | Subsystem health, gateway status, provider stats, and token savings | None | `{ ok: true, version, gateway, providers, tokenSavings, usage, lanes, privacyDisclosures }` |
| `GET` | `/providers` | List providers with optional filtering | `?category=&authKind=&format=&search=&enabledOnly=` | `{ ok: true, count, providers: [...] }` |
| `GET` | `/providers/:id` | Get details for specific provider | None | `{ ok: true, provider: {...} }` |
| `POST` | `/providers/:id` | Update provider enable status, custom API key, or base URL | `{ enabled: bool, apiKey: string, baseUrl: string }` | `{ ok: true, provider: {...} }` |
| `GET` | `/combos` | List registered virtual combos | None | `{ ok: true, count, combos: [...] }` |
| `POST` | `/combos` | Create or update a virtual combo | `{ id?, name, models: [...], strategy, stickyLimit, enabled }` | `{ ok: true, combo: {...} }` |
| `DELETE` | `/combos/:id` | Delete a virtual combo | None | `{ ok: true, deleted: bool }` |
| `GET` | `/catalog` | Unified catalog of all models | `?query=&channel=&freeOnly=&visionOnly=` | `{ ok: true, count, catalog: [...] }` |
| `GET` | `/usage` | Usage monitor metrics and summary | None | `{ ok: true, usage: {...} }` |
| `POST` | `/usage/reset` | Clear usage counters | None | `{ ok: true, message: "Usage metrics reset." }` |
| `GET` | `/token-saver` | RTK savings counters and compaction summary | None | `{ ok: true, savings: {...}, description: string }` |
| `POST` | `/token-saver/reset` | Reset token savings counters | None | `{ ok: true, message: "Token savings counters reset." }` |
| `POST` | `/gateway/start` | Start local universal HTTP gateway | `{ port?: number, host?: string }` | `{ ok: true, gateway: {...} }` |
| `POST` | `/gateway/stop` | Stop local universal HTTP gateway | None | `{ ok: true, gateway: { status: "stopped" } }` |
| `GET` | `/channels` | Status report of 10 standalone account channels | None | `{ ok: true, report: { totalChannels, configuredCount, channels } }` |
| `POST` | `/channels/:id` | Configure account channel credentials | `{ credentials: {...} }` | `{ ok: true, channel: {...} }` |
| `POST` | `/chat` | Execute inference turn through DSH-GOD engine | `{ model, messages, stream, temperature, max_tokens }` | `{ ok: true, result: {...} }` |

---

## 2. Universal API Gateway Endpoints (`http://127.0.0.1:8080/v1/*`)

The gateway runs on port 8080 (or custom configured port) and enforces constant-time API key validation via `Authorization: Bearer <key>` or `x-api-key: <key>`.

| Method | Endpoint | Wire Specification | Compatibility |
|---|---|---|---|
| `GET` | `/health` | Gateway health ping | Public (No Auth required) |
| `GET` | `/v1/models` | OpenAI Models List format | OpenAI API standard |
| `POST` | `/v1/chat/completions` | OpenAI Chat Completions wire | OpenAI API standard |
| `POST` | `/v1/responses` | OpenAI Responses wire | OpenAI Responses standard |
| `POST` | `/v1/messages` | Anthropic Messages wire | Anthropic API standard |
| `POST` | `/v1/messages/count_tokens` | Anthropic Token Counter wire | Anthropic API standard |

---

## 3. Example Usage

### cURL: Test OpenAI Gateway Completion
```bash
curl -X POST http://127.0.0.1:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-ultron-dsh-gateway" \
  -d '{
    "model": "combo:fast-free",
    "messages": [{"role": "user", "content": "ping"}]
  }'
```

### cURL: Test Anthropic Messages Wire
```bash
curl -X POST http://127.0.0.1:8080/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: sk-ultron-dsh-gateway" \
  -d '{
    "model": "combo:fast-free",
    "messages": [{"role": "user", "content": "ping"}]
  }'
```
