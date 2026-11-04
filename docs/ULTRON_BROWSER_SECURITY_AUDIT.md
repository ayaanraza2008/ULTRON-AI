# ULTRON AI — Browser Security & SSRF Audit Report

**Date:** November 4, 2026  
**Auditor:** Antigravity Advanced Agentic Coding System  
**Audit Branch:** `audit/ultron-combined-integration-verification`  
**Module Audited:** `integrations/browser-automation-helper.js`  
**Related Tool:** `browser_url_normalizer` in `core/tool-registry.js`  

---

## 1. Adversarial Probing & SSRF Bypasses Uncovered

During the adversarial audit, `browserAutomationHelper.validateUrlSafety` was subjected to negative vectors designed to bypass basic IP and hostname filters.

### Critical Vulnerabilities Uncovered in Baseline Commit `5c2c3613`

```
Probe: http://[::1]
Result: ALLOWED (CRITICAL SSRF BYPASS)
Root Cause: Node.js WHATWG URL parser leaves enclosing brackets on parsed.hostname (e.g. "[::1]").
            The regex /^::1$/ failed to match because "[" and "]" were present!

Probe: http://0.0.0.0:8000
Result: ALLOWED (SSRF BYPASS)
Root Cause: 0.0.0.0 is unassigned in IPv4, but Windows and Linux network stacks treat it as 127.0.0.1 (loopback).

Probe: http://[::ffff:127.0.0.1]
Result: ALLOWED (CRITICAL SSRF BYPASS)
Root Cause: Node.js URL parser normalizes IPv4-mapped IPv6 into hex notation: "[::ffff:7f00:1]".
            This completely bypassed the /^127\./ IPv4 regex!

Probe: http://[::ffff:169.254.169.254]
Result: ALLOWED (CLOUD METADATA LEAK)
Root Cause: Normalized to "[::ffff:a9fe:a9fe]", bypassing link-local metadata protection.

Probe: http://[::ffff:10.0.0.1]
Result: ALLOWED (INTERNAL NETWORK LEAK)
Root Cause: Normalized to "[::ffff:a00:1]", bypassing private 10.0.0.0/8 network filter.
```

---

## 2. Hardening & Multi-Layer Anti-SSRF Defense

To eliminate these bypasses completely, `BrowserAutomationHelper` was re-engineered with multi-stage sanitization:

### 1. Bracket Stripping
```javascript
let hostname = parsed.hostname.toLowerCase();
if (hostname.startsWith("[") && hostname.endsWith("]")) {
  hostname = hostname.slice(1, -1);
}
```

### 2. IPv4-Mapped IPv6 Hex Decoding
Decodes hex words `xxxx:yyyy` in `::ffff:xxxx:yyyy` back into canonical dotted-quad IPv4:
```javascript
let checkIpv4 = hostname;
if (hostname.startsWith("::ffff:")) {
  const rest = hostname.slice(7);
  if (rest.includes(".")) {
    checkIpv4 = rest;
  } else if (rest.includes(":")) {
    const parts = rest.split(":");
    if (parts.length === 2) {
      const high = parseInt(parts[0], 16);
      const low = parseInt(parts[1], 16);
      if (Number.isFinite(high) && Number.isFinite(low)) {
        const b1 = (high >> 8) & 0xff;
        const b2 = high & 0xff;
        const b3 = (low >> 8) & 0xff;
        const b4 = low & 0xff;
        checkIpv4 = `${b1}.${b2}.${b3}.${b4}`;
      }
    }
  }
}
```

### 3. Canonical Subnet Matching
- **127.0.0.0/8 & Localhost:** Blocks `127.*`, `localhost`, `*.localhost`, `localhost.localdomain`.
- **0.0.0.0/8 & Bare Zero:** Blocks `0.0.0.0`, `0`, `0x0`, `0000`.
- **Private Subnets:** Blocks `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`.
- **Cloud Metadata / Link-Local:** Blocks `169.254.0.0/16` (AWS / GCP / Azure metadata endpoint `169.254.169.254`).
- **Carrier-Grade NAT & Benchmarking:** Blocks `100.64.0.0/10` and `198.18.0.0/15`.
- **IPv6 Private & Link-Local:** Blocks `::1`, `::`, `fc00::/7`, `fd00::/8`, `fe80::/10`.
- **Alternative Encodings:** Dword (`2130706433`), Hex (`0x7f000001`), Octal (`0177.0.0.1`) are normalized by Node's URL parser into canonical decimal quad and immediately caught by the IPv4 subnet filters.

---

## 3. Resolution of the Localhost / SSRF Contradiction

### The Conflict
Production environments must strictly forbid LLM agents and web tools from accessing loopback and private networks. However, integration test harnesses run ephemeral mock HTTP servers on `127.0.0.1:0`.

### The Explicit, Test-Only Gate
Production never gains unrestricted loopback access. Loopback is permitted if and only if **BOTH** conditions are satisfied:
1. `options.allowLoopbackInTest` or `this.allowLoopbackInTest` is explicitly `true`.
2. The runtime environment is strictly a test environment (`process.env.NODE_ENV === "test"` or `process.env.ULTRON_TEST_ALLOW_LOCALHOST === "true"`).

In all other environments, requests to `localhost`, `127.0.0.1`, `[::1]`, or `0.0.0.0` are unconditionally rejected.

---

## 4. Scope Clarification: Browser Automation vs. URL Normalizer

The integration report named this module `browser-automation-helper.js`.
The audit clarifies the exact scope:
- **What is Implemented:** User query URL normalization (bare words to `.com`, multi-word queries to DuckDuckGo search), strict Anti-SSRF URL validation, and host browser profile directory discovery (Chrome, Edge, Brave `User Data` directories).
- **What is Not Implemented in this Module:** This module does not launch Chromium, connect via CDP, or execute Playwright automation scripts. That functionality is handled separately by the Browser Use integration.

---

## 5. Adversarial Vector Audit Matrix

| Vector Tested | Attack Category | Baseline Result | Hardened Result | Verdict |
| :--- | :--- | :--- | :--- | :--- |
| `http://localhost:8080` | DNS Loopback | Blocked | Blocked | **PASS** |
| `http://127.0.0.1:3000` | IPv4 Loopback | Blocked | Blocked | **PASS** |
| `http://127.0.0.2` | 127/8 Subnet | Blocked | Blocked | **PASS** |
| `http://0.0.0.0:8000` | Unassigned IP | **ALLOWED (Bypass)** | **BLOCKED** | **RESOLVED** |
| `http://[::1]` | IPv6 Loopback | **ALLOWED (Bypass)** | **BLOCKED** | **RESOLVED** |
| `http://[::]` | IPv6 Unspecified | **ALLOWED (Bypass)** | **BLOCKED** | **RESOLVED** |
| `http://[::ffff:127.0.0.1]`| IPv4-mapped Loopback | **ALLOWED (Bypass)** | **BLOCKED** | **RESOLVED** |
| `http://[::ffff:169.254.169.254]`| IPv4-mapped Metadata | **ALLOWED (Bypass)** | **BLOCKED** | **RESOLVED** |
| `http://[::ffff:10.0.0.1]` | IPv4-mapped Private | **ALLOWED (Bypass)** | **BLOCKED** | **RESOLVED** |
| `http://169.254.169.254/latest`| Cloud Metadata | Blocked | Blocked | **PASS** |
| `http://2130706433` | Dword IP | Blocked | Blocked | **PASS** |
| `http://0x7f000001` | Hex IP | Blocked | Blocked | **PASS** |
| `http://192.168.1.1` | Private C | Blocked | Blocked | **PASS** |
| `http://10.0.0.1` | Private A | Blocked | Blocked | **PASS** |
| `http://172.16.0.1` | Private B | Blocked | Blocked | **PASS** |
| `file:///etc/passwd` | Non-HTTP Scheme | Blocked | Blocked | **PASS** |
| `javascript:alert(1)` | URI Scheme Attack | Blocked | Blocked | **PASS** |
| `https://google.com` | Public HTTPS Domain | Allowed | Allowed | **PASS** |
