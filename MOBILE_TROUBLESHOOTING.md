# ULTRON AI — Mobile Control Subsystem Troubleshooting Guide

---

## 1. Common Diagnostics & Solutions

### A. Device Not Discovered (`NO_DEVICES_CONNECTED`)
**Symptoms:**  
- Status shows `0 DEVICES CONNECTED` / `STANDBY`.
- Calling `/api/mobile/action` returns `NO_DEVICES_CONNECTED`.

**Remediation:**
1. Check physical cable: Ensure you are using a data-capable USB cable (some charging cables do not wire data pins).
2. Check USB Debugging: Ensure **Developer Options → USB Debugging** is toggled **ON** on your Android device.
3. Test with host ADB:
   ```powershell
   adb devices
   ```
4. If device is still not listed, reinstall the Google USB Driver or your device OEM driver.

---

### B. Device State is `UNAUTHORIZED`
**Symptoms:**  
- `adb devices` shows `<device_id> unauthorized`.
- Touch actions and screenshots fail with permission errors.

**Remediation:**
1. Unlock your phone's screen.
2. An RSA fingerprint dialog will appear: tap **"Always allow from this computer"** and tap **Allow**.
3. If the prompt does not appear, revoke authorizations on the phone via **Developer Options → Revoke USB debugging authorizations**, then reconnect the USB cable.

---

### C. Port Conflicts or ADB Daemon Crashes
**Symptoms:**  
- Errors such as `cannot bind 'tcp:5037': Address already in use`.
- `adb server version doesn't match this client; killing...`

**Remediation:**
1. Terminate all conflicting ADB instances on Windows:
   ```powershell
   taskkill /F /IM adb.exe
   ```
2. Restart the ADB daemon cleanly:
   ```powershell
   adb start-server
   ```

---

### D. Upstream Go Daemon Timeout (`mobilecli daemon did not start listening within 5s`)
**Symptoms:**  
- Running `@mobilenext/mobile-mcp` via npx prints daemon timeout warnings on Windows.

**Remediation:**
- **Already Handled Autonomously by ULTRON:**  
  ULTRON enforces `MOBILEMCP_LEGACY_ROBOT=1` in `mobile/mobile-mcp-client.js`. This bypasses the unmanaged Go daemon named pipe and directs Mobile MCP to use `AndroidRobot` directly via `adb.exe`.
- In addition, ULTRON's `AdbBridge` acts as an automatic zero-dependency fallback, guaranteeing instant command execution without timeouts.

---

### E. Single-Use Token Rejection (`INVALID_CONFIRMATION_TOKEN`)
**Symptoms:**  
- Authorizing an action returns `403 INVALID_CONFIRMATION_TOKEN`.

**Root Cause:**
- Single-use tokens have a strict 60-second TTL and anti-replay protection. If 60 seconds have elapsed or if the token was already consumed once, the engine rejects it.

**Remediation:**
- Re-trigger the sensitive action in the HUD to obtain a fresh token and authorize within 60 seconds.
