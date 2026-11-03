# ULTRON AI — Native Android Companion Architecture & Operations
## ANDROID MOBILE NODE · JETPACK COMPOSE CYBER HUD · ON-DEVICE SPEECH

---

## 1. Executive Summary

The **ULTRON Android Companion** is a native Kotlin and Jetpack Compose mobile application designed to turn Android smartphones into an authoritative command center and voice companion for the central ULTRON brain. It provides on-device multilingual voice recognition, remote Windows PC monitoring and control, camera-based pairing, and background task telemetry.

---

## 2. Technical Stack & Dependencies

- **Language**: Kotlin 2.0.21
- **UI Framework**: Android Jetpack Compose with Material 3
- **Minimum SDK**: Android 12 (API 31)
- **Target SDK**: Android 15 (API 35)
- **Security Storage**: Android Keystore AES-256-GCM Non-Exportable Cryptographic Keys
- **Background Scheduler**: Android Jetpack `WorkManager` (CoroutineWorker)
- **Camera Subsystem**: AndroidX CameraX (Camera2 API)
- **Speech Subsystem**: `android.speech.SpeechRecognizer` with on-device offline recognition support

---

## 3. Core Functional Modules

### 3.1 ULTRON Voice System
- **Multilingual Support**: Supports Indian English (`en-IN`), US English (`en-US`), Hindi (`hi-IN`), and Romanized Hinglish.
- **Microphone Consent & User Control**: Audio recording begins ONLY after an explicit user tap on the "Speak" action button. Background wake-word listening is a distinct, user-consented opt-in foreground service.
- **Living Energy Core Mobile Visualizer (`ui/components/LivingEnergyCore.kt`)**: Reactive multi-ring Arc Reactor visualizer drawn via Jetpack Compose `Canvas`, animating through `STANDBY`, `LISTENING`, `THINKING`, `SPEAKING`, and `EXECUTING` states.

### 3.2 ULTRON Chat System
- **Shared Memory & Conversation Access**: Direct synchronization with central conversation history (`/api/conversations`). Both phone and PC share the identical context.
- **Streaming Responses**: Text responses stream in real-time with latency under 500ms.
- **Task Timeline**: Visual display of active autonomous agent tasks and execution progress.

### 3.3 Windows PC Remote Control Deck (`ui/UltronComposeActivity.kt`)
- **Real-Time PC Vitals Card**:
  - Live Connection Status (Online glowing green vs Offline warning red).
  - Host Processor: AMD Ryzen 7 5700U with Radeon Graphics.
  - RAM Load Gauge: Tracks 8 GB DDR4 headroom.
  - Active Foreground Window: Reports active IDE, browser, or game on the PC.
- **Authorized Action Grid**:
  - 🌐 Launch Google Chrome
  - 🧭 Launch Microsoft Edge
  - 💻 Launch Visual Studio Code Workspace
  - 📝 Launch Notepad
  - 🧮 Launch Calculator
  - ⚡ Launch Windows Terminal
  - 🔒 Lock Windows Workstation Session
  - 🔊 System Audio Volume (Up / Down / Mute)
  - 📸 Screen Capture Trigger

### 3.4 Security & Credential Isolation (`DeviceTokenStore.kt`)
- Tokens are stored in private app SharedPreferences encrypted with a 256-bit AES-GCM key generated inside the **Android Keystore provider**.
- Keys are non-exportable from hardware-backed security modules (StrongBox / TEE).
- In the event of device backup or app extraction, tokens cannot be decrypted on other devices (`allowBackup="false"`).

---

## 4. Background Services & WorkManager Architecture

1. **`WakeWordService.kt`**:
   Runs as an explicit Android Foreground Service (`foregroundServiceType="microphone"`) with an ongoing notification containing an immediate "Stop listening" action.
2. **`UltronSyncWorker.kt`**:
   Registered with `WorkManager` to periodically check battery level, charging status, and sync device vitals with the central backend every 15 minutes without keeping CPU wake locks active.
3. **`UltronNotificationHelper.kt`**:
   Configured with high-importance notification channels (`CHANNEL_COMMANDS`) to surface instant alerts when long-running PC background tasks or security scans finish.
