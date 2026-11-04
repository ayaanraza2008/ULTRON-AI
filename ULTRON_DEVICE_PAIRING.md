# ULTRON AI — Device Pairing & Cryptographic Trust Architecture
## MUTUAL AUTHENTICATION · QR-CODE LIFECYCLE · OWNER ISOLATION

---

## 1. Executive Summary

Pairing an Android phone or Windows PC with the ULTRON Central Brain requires cryptographic mutual authentication. The system rejects network-trust assumptions (such as trusting any device on the same local Wi-Fi) and mandates explicit operator approval.

---

## 2. Cryptographic Lifecycle

```
[Operator (Web/CLI)]              [Central Backend]                   [New Companion Device]
         │                                │                                      │
         │ 1. Request Pairing             │                                      │
         │    (deviceName, platform)      │                                      │
         ├───────────────────────────────►│                                      │
         │                                │ 2. Generate 6-Digit Numeric Code     │
         │                                │    (crypto.randomInt, 5-min TTL)     │
         │ 3. Display QR Code / 6-Digits  │                                      │
         │◄───────────────────────────────┤                                      │
         │                                │                                      │
         │ 4. Operator Confirms/Approves  │                                      │
         ├───────────────────────────────►│                                      │
         │                                │                                      │
         │                                │ 5. Scan QR or Enter 6 Digits         │
         │                                │◄─────────────────────────────────────┤
         │                                │ 6. Validate Code & Owner Approval    │
         │                                │ 7. Mint Device Token (ultron_dev_*)  │
         │                                │ 8. Hash Token (SHA-256) on Disk      │
         │                                │ 9. Return Bearer Credential          │
         │                                ├─────────────────────────────────────►│
         │                                │                                      │ 10. Store in Keystore/DPAPI
```

---

## 3. Pairing Payload & QR Code Specification

When an operator requests pairing via `POST /api/jarvis/devices/pair/qr`, the backend generates a standard URI:

```
ultron://pair?code=849201&server=https%3A%2F%2Fultron-ai-core.onrender.com&platform=android&expiresAt=2026-11-03T14%3A50%3A00.000Z
```

### JSON Structure:
```json
{
  "success": true,
  "code": "849201",
  "expiresAt": "2026-11-03T14:50:00.000Z",
  "deviceName": "Galaxy S24 Ultra",
  "platform": "android",
  "qrPayload": "ultron://pair?code=849201&server=...",
  "pairingUrl": "https://ultron-ai-core.onrender.com/api/devices/pairings/claim"
}
```

---

## 4. Security Controls & Defensive Measures

1. **Strict 5-Minute Expiry**:
   Unclaimed pairing codes self-destruct 300 seconds after generation.
2. **Single-Use Claim Protection**:
   Once claimed, the pairing entry is immediately deleted from memory and database. Any subsequent claim attempt returns `INVALID_PAIRING_CODE` (HTTP 400).
3. **Brute-Force Rate Limiting**:
   The pairing claim endpoint enforces client IP rate limiting (maximum 8 attempts per minute per IP), responding with HTTP 429 and `Retry-After: 60`.
4. **Zero Plaintext Tokens on Disk**:
   The backend stores ONLY the SHA-256 digest of the token (`tokenHash`). Verification uses `crypto.timingSafeEqual` to eliminate timing side-channel attacks.
5. **Token Rotation & Instant Revocation**:
   Operators can revoke a lost device or rotate tokens at any time via `POST /api/jarvis/devices/:id/revoke` or `POST /api/jarvis/devices/:id/rotate-token`. Revoked devices are denied instantly across both REST and WebSocket channels.
