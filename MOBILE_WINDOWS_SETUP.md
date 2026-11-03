# ULTRON AI — Windows 11 Android Setup & Mobile MCP Guide

**Host Architecture:** Windows 11 Home (AMD Ryzen 7 5700U, 8 GB RAM)  
**Host ADB Location:** `C:\Users\Ali Raza Zaidi\AppData\Local\Android\Sdk\platform-tools\adb.exe`  
**ADB Version:** 1.0.41 (Revision 35.0.2)  

---

## 1. Preparing the Android Device

### Step 1: Enable Developer Options
1. Open **Settings** on your Android phone.
2. Navigate to **About Phone** (or **System → About Phone**).
3. Tap **Build Number** 7 times consecutively until the notification *"You are now a developer!"* appears.

### Step 2: Enable USB Debugging
1. In Settings, open **System → Developer Options**.
2. Toggle **USB Debugging** to **ON**.
3. (Recommended for full automation) Toggle **Disable adb authorization timeout** to **ON**.
4. (Xiaomi / MIUI / HyperOS only) Enable both **USB debugging (Security settings)** and **Install via USB**.

---

## 2. Connecting via USB

1. Connect your Android phone to the Windows PC using a high-quality USB-C data cable.
2. On your phone screen, when prompted with:
   > *"Allow USB debugging? The computer's RSA key fingerprint is: ... "*
3. Check the box **"Always allow from this computer"** and tap **Allow**.
4. Verify connection in PowerShell:
   ```powershell
   adb devices -l
   ```
   **Expected Output:**
   ```
   List of devices attached
   R5CR30XYZAB    device product:husky model:Pixel_8_Pro device:husky transport_id:1
   ```
   *Note: If the state shows `unauthorized`, unlock your phone screen and accept the RSA prompt.*

---

## 3. Connecting Wirelessly (Wireless ADB)

Android 11+ supports native Wireless Debugging without needing a physical cable:

### Step 1: Pair Device (One-Time Setup)
1. Ensure both your Windows PC and Android phone are on the **same Wi-Fi network**.
2. On the phone, go to **Developer Options → Wireless Debugging** and toggle it **ON**.
3. Tap **"Pair device with pairing code"**. A dialog will appear with:
   - Wi-Fi pairing code (e.g. `123456`)
   - IP address & Port (e.g. `192.168.1.105:38475`)
4. In Windows PowerShell:
   ```powershell
   adb pair 192.168.1.105:38475
   # When prompted, enter the 6-digit code: 123456
   ```

### Step 2: Connect
1. Look at the main **Wireless Debugging** screen for the device's main connection port (e.g. `192.168.1.105:41235`).
2. Run:
   ```powershell
   adb connect 192.168.1.105:41235
   # Output: connected to 192.168.1.105:41235
   ```
3. ULTRON will immediately detect the device as connection type `wifi`.

---

## 4. Troubleshooting Common Windows Driver Issues

| Issue | Root Cause | Solution |
| :--- | :--- | :--- |
| `adb devices` shows nothing | Windows missing Google USB driver | Install Google USB Driver via Android SDK Manager or install the device OEM driver (Samsung Smart Switch / Google USB Driver) |
| Device shows `unauthorized` | Phone screen locked or RSA key not approved | Unlock phone screen, reconnect USB cable, and tap "Always allow" |
| `adb server version doesn't match this client` | Multiple ADB versions on host (e.g., emulator vs platform-tools) | Terminate background adb instances with `taskkill /F /IM adb.exe` and let ULTRON's managed `AdbBridge` start the daemon |
| Device shows `offline` | ADB daemon protocol desynchronization | Run `adb kill-server` followed by `adb start-server` |
