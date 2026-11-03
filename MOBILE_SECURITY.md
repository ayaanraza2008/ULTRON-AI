# ULTRON AI — Mobile Control Security Architecture & Permission Model

**Classification:** ULTRON Core Security Architecture  
**Security Standard:** Zero-Trust Hardware Bridge & Anti-Replay Gatekeeping  

---

## 1. 4-Tier Permission Model

Every mobile operation belongs to one of four strictly audited permission tiers:

| Tier | Name | Classification | Confirmation Gate | Example Actions |
| :--- | :--- | :--- | :--- | :--- |
| **Level 1** | **READ** | Read-Only Inspection | Autonomous (No Gate) | Device discovery, battery/vitals, screen dimensions, screenshots, UI element tree dump, system log inspection. |
| **Level 2** | **INTERACTION** | Reversible UI Actions | Autonomy Level >= 2 | Coordinate tap, double-tap, long-press, swipe, type text, press navigation keys (Home/Back), open allowed URLs, launch approved non-sensitive apps. |
| **Level 3** | **SENSITIVE** | State-Altering Actions | Operator Confirmation | Force-stopping apps, clearing app data, accessing system clipboard, modifying GPS location or screen orientation, start/stop screen recording. |
| **Level 4** | **CRITICAL** | Irreversible / High Risk | Single-Use Token Required | App installation/uninstallation, cellular phone calls, SMS/messages, payment execution, or interacting with sensitive applications (banking, wallet, settings). |

---

## 2. Cryptographic Single-Use Confirmation Tokens

For any Level 3 or Level 4 action:
1. **Generation:** When a critical action is requested, `MobilePermissionEngine` generates a cryptographically random single-use token:
   ```javascript
   const token = crypto.randomUUID();
   ```
2. **Time-To-Live (TTL):** The token is registered in an in-memory buffer with an unforgeable 60-second expiration:
   ```javascript
   const expiresAt = Date.now() + 60000;
   ```
3. **Atomic Consumption (Anti-Replay):**
   - When the user clicks **Authorize** in the HUD modal (or sends `POST /api/mobile/confirm`), the engine immediately and atomically deletes the token from memory:
     ```javascript
     this.pendingConfirmations.delete(token);
     ```
   - Any replay attack, retransmission, or reused token is rejected with HTTP 403 `INVALID_CONFIRMATION_TOKEN`.
4. **Action & Device Binding:** The token is bound specifically to the requested `actionName` and `deviceId`. Mismatched actions or devices are rejected even if the token is valid.

---

## 3. Sensitive Application Shield

Applications involving financial transactions, authentication credentials, communications, or operating system privileges are guarded by the **Sensitive Application Shield**:

```javascript
export const SENSITIVE_PACKAGES = [
  "com.android.settings",                     // Android System Settings
  "com.google.android.apps.walletnfcrel",     // Google Wallet
  "com.paypal.android.p2pmobile",             // PayPal
  "com.whatsapp",                             // WhatsApp
  "org.telegram.messenger",                   // Telegram
  "org.thoughtcrime.securesms",               // Signal
  "com.google.android.apps.messaging",        // SMS Messages
  "com.android.mms",                          // MMS Messaging
  "com.google.android.apps.authenticator2"    // Google Authenticator MFA
];
```

Any attempt by an LLM or workflow to launch, tap, type into, or interact with these packages is automatically upgraded to **Level 4 Critical**, halting execution until explicit human authorization is granted.

---

## 4. URL Sanitization & SSRF Defense

When `mobile_open_url` is invoked, the URL is strictly validated:
1. **Allowed Protocols:** Only `http:` and `https:` are permitted. Dangerous schemes (`javascript:`, `file:`, `content:`, `data:`) are rejected immediately.
2. **SSRF Blocking:** Mobile browser navigation cannot be directed to:
   - Loopback (`localhost`, `127.0.0.1`, `::1`)
   - Private RFC 1918 subnets (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`)
   - Cloud metadata endpoints (`169.254.169.254`)
   - IPv6 unique local addresses (`fc00::/7`, `fe80::/10`)

---

## 5. Network Safety & Host Isolation

1. **Strict Loopback Binding:** When running in Streamable HTTP mode, the `@mobilenext/mobile-mcp` daemon binds exclusively to `127.0.0.1`. It never listens on `0.0.0.0` or public network adapters.
2. **Bearer Token Authentication:** Every Streamable HTTP request requires `Authorization: Bearer <MOBILEMCP_AUTH>`. Unauthenticated requests receive HTTP 401.
3. **No Biometric or Lock Screen Bypass:** ULTRON adheres strictly to system security boundaries. It cannot bypass Android lock screen PINs, patterns, fingerprint authentication, or banking MFA prompts.
