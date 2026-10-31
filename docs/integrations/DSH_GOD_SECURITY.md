# ULTRON AI — DSH-GOD Security & Privacy Governance

## 1. Zero Secret Leakage Governance

### A. Automatic Credential Redaction
All user-configured API keys, bearer tokens, passwords, and sensitive credentials pass through `redact()` in `integrations/dsh-god/privacy-policy.js`:
- Regex filters wipe `sk-[a-zA-Z0-9_\-]{20,}` and `Bearer [token]` strings from logs, error traces, and status reports.
- JSON error responses and HTTP status payloads are deep-sanitized before reaching client responses.

### B. Constant-Time Authentication
The local and LAN universal HTTP gateway validates API keys using `crypto.timingSafeEqual` in `integrations/dsh-god/gateway-manager.js`:
- Completely eliminates timing attack vectors on bearer token and `x-api-key` validation.

---

## 2. Privacy Disclosures & Free Lane Safeguards

### A. Kilo AI Free Pool Disclosure
- Prompts sent to Kilo AI free pool may be logged and inspected upstream for model evaluation and fine-tuning.
- ULTRON displays a persistent disclosure banner in the Cyber-HUD UI and checks privacy clearance before egress.

### B. Egress Privacy Clearance
- `checkPrivacyClearance()` inspects prompt payloads before dispatching to free lanes.
- If private RSA/SSH keys or secret credentials are detected in the prompt, egress is blocked immediately with a security advisory.

---

## 3. Host System Resource Budgeting

### Hardware Constraints:
- **Processor:** AMD Ryzen 7 5700U (8 Cores, 16 Threads)
- **Memory:** 8 GB DDR4 System RAM

### Guardrails:
1. **Binary Exclusion:** The 68MB embedded Magpie binary (`vendor/magpie/bin/magpie-win32-x64.exe`) is excluded from build and execution.
2. **Pure JS Execution:** All gateway and channel adapters run in native Node.js ES modules with bounded buffer sizes (max body 16MB).
3. **Loopback Default:** Local HTTP gateway listens on `127.0.0.1` by default. LAN (`0.0.0.0`) access is strictly opt-in via `DSH_ALLOW_LAN=true`.
