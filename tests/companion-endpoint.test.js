import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const currentUltronInterface = "https://ultron-core-interface.onrender.com/";
const retiredInterface = "https://ultron-ai-zvd7.onrender.com/";

test("Windows companion opens the current ULTRON Core interface", async () => {
  const source = await readFile(new URL("../windows-companion/Program.cs", import.meta.url), "utf8");
  assert.ok(source.includes(currentUltronInterface));
  assert.ok(!source.includes(retiredInterface));
});

test("Android activity and wake notification open the current ULTRON Core interface", async () => {
  const main = await readFile(new URL("../android-companion/app/src/main/java/com/ultron/companion/MainActivity.kt", import.meta.url), "utf8");
  const service = await readFile(new URL("../android-companion/app/src/main/java/com/ultron/companion/WakeWordService.kt", import.meta.url), "utf8");
  assert.ok(main.includes(currentUltronInterface));
  assert.ok(service.includes(currentUltronInterface));
  assert.ok(!main.includes(retiredInterface));
  assert.ok(!service.includes(retiredInterface));
});

test("Windows wake companion requires microphone consent and performs local wake detection only", async () => {
  const source = await readFile(new URL("../windows-companion/Program.cs", import.meta.url), "utf8");
  assert.ok(source.includes("MessageBoxButtons.YesNo"));
  assert.ok(source.includes("previouslyConsented: true"));
  assert.ok(source.includes("SpeechRecognitionEngine.InstalledRecognizers()"));
  assert.ok(source.includes("SetInputToDefaultAudioDevice()"));
  assert.ok(source.includes("RecognizeAsync(RecognizeMode.Multiple)"));
  assert.ok(source.includes("does not upload microphone audio to the ULTRON server"));
  assert.ok(source.includes("WriteAutoStartRegistration(true)"));
  assert.ok(source.includes("WriteAutoStartRegistration(false)"));
  assert.ok(source.includes("Pause listening"));
  assert.ok(source.includes("Exit"));
  assert.equal((source.match(/Process\.Start\(/g) || []).length, 1);
  assert.ok(source.includes("Process.Start(new ProcessStartInfo(AssistantUrl) { UseShellExecute = true });"));
  assert.ok(source.includes("/api/jarvis/voice/process-command"));
  assert.doesNotMatch(source, /ClientWebSocket|TcpClient|UdpClient|Socket/);
});

test("Android wake companion uses on-device speech with explicit microphone and visible Stop controls", async () => {
  const activity = await readFile(new URL("../android-companion/app/src/main/java/com/ultron/companion/MainActivity.kt", import.meta.url), "utf8");
  const service = await readFile(new URL("../android-companion/app/src/main/java/com/ultron/companion/WakeWordService.kt", import.meta.url), "utf8");
  const manifest = await readFile(new URL("../android-companion/app/src/main/AndroidManifest.xml", import.meta.url), "utf8");
  const tokenStore = await readFile(new URL("../android-companion/app/src/main/java/com/ultron/companion/DeviceTokenStore.kt", import.meta.url), "utf8");

  assert.ok(activity.includes("SpeechRecognizer.isOnDeviceRecognitionAvailable(this)"));
  assert.ok(activity.includes("Manifest.permission.RECORD_AUDIO"));
  assert.ok(activity.includes("setOnClickListener { enableWakeWord() }"));
  assert.ok(activity.includes("startForegroundService(Intent(this, WakeWordService::class.java))"));
  assert.ok(service.includes("SpeechRecognizer.createOnDeviceSpeechRecognizer(this)"));
  assert.ok(service.includes("RecognizerIntent.EXTRA_PREFER_OFFLINE, true"));
  assert.ok(service.includes("startForeground("));
  assert.ok(service.includes("setOngoing(true)"));
  assert.ok(service.includes('Notification.Action.Builder(null, "Stop listening", stopIntent)'));
  assert.ok(service.includes("stopForeground(STOP_FOREGROUND_REMOVE)"));
  assert.ok(manifest.includes('android:name=".WakeWordService"'));
  assert.ok(manifest.includes('android:exported="false"'));
  assert.ok(manifest.includes('android:allowBackup="false"'));
  assert.ok(manifest.includes('android:usesCleartextTraffic="false"'));
  assert.ok(manifest.includes("android.permission.RECORD_AUDIO"));
  assert.ok(manifest.includes("android.permission.POST_NOTIFICATIONS"));
  assert.ok(manifest.includes("android.permission.INTERNET"));
  assert.ok(manifest.includes('android:usesCleartextTraffic="false"'));
  assert.ok(activity.includes("/api/devices/pairings/claim"));
  assert.ok(activity.includes("/api/jarvis/voice/process-command"));
  assert.ok(activity.includes("SpeechRecognizer.createOnDeviceSpeechRecognizer(this)"));
  assert.ok(activity.includes("RecognizerIntent.EXTRA_PREFER_OFFLINE"));
  assert.ok(activity.includes("setRequestProperty(\"x-device-token\", deviceToken)"));
  assert.ok(activity.includes('setOnClickListener { beginVoiceCommand() }'));
  assert.ok(tokenStore.includes('"AndroidKeyStore"'));
  assert.ok(tokenStore.includes("AES/GCM/NoPadding"));
  assert.ok(tokenStore.includes("KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT"));
  assert.ok(tokenStore.includes("GCMParameterSpec"));
  assert.doesNotMatch(service, /HttpURLConnection|OkHttpClient|WebSocket|Retrofit/);
  assert.doesNotMatch(service, /HttpURLConnection|OkHttpClient|WebSocket|Retrofit/);
});


test("Windows companion captures the user's next spoken command instead of sending a hardcoded status prompt", async () => {
  const source = await readFile(new URL("../windows-companion/Program.cs", import.meta.url), "utf8");
  assert.ok(source.includes("new DictationGrammar()"));
  assert.ok(source.includes("CaptureNextCommandAsync()"));
  assert.ok(source.includes("await DispatchVoiceCommandAsync(commandText, language)"));
  assert.ok(source.includes("ULTRON_BACKEND_URL"));
  assert.ok(source.includes("https://ultron-ai-core.onrender.com"));
  assert.ok(source.includes("ULTRON_DEVICE_TOKEN"));
  assert.ok(source.includes("x-device-token"));
  assert.ok(source.includes("Command capture cancelled"));
  assert.doesNotMatch(source, /DispatchVoiceCommandAsync\("Ultron, status report"/);
});

test("Windows companion supports one-time device pairing and DPAPI-protected token storage", async () => {
  const source = await readFile(new URL("../windows-companion/Program.cs", import.meta.url), "utf8");
  const project = await readFile(new URL("../windows-companion/Ultron.Companion.csproj", import.meta.url), "utf8");
  assert.ok(source.includes("/api/devices/pairings/claim"));
  assert.ok(source.includes("private async Task PairDeviceAsync()"));
  assert.ok(source.includes("ProtectedData.Protect"));
  assert.ok(source.includes("ProtectedData.Unprotect"));
  assert.ok(source.includes("DataProtectionScope.CurrentUser"));
  assert.ok(source.includes("LoadDeviceToken()"));
  assert.ok(source.includes("SaveDeviceIdentity(deviceId, token)"));
  assert.ok(source.includes("private static void SaveDeviceIdentity"));
  assert.ok(source.includes("private static (string? DeviceId, string? Token) LoadDeviceIdentity()"));
  assert.ok(source.includes("DataProtectionScope.CurrentUser"));
  assert.ok(source.includes("ultron_dev_[a-f0-9]{64}"));
  assert.ok(project.includes("System.Security.Cryptography.ProtectedData"));
  assert.ok(!source.includes("File.WriteAllText(DeviceTokenPath()"));
  assert.ok(source.includes("Allow allowlisted remote commands from paired devices"));
  assert.ok(source.includes("PollPendingCommandsAsync"));
  const executor = await readFile(new URL("../windows-companion/RemoteCommandExecutor.cs", import.meta.url), "utf8");
  assert.ok(executor.includes("HMACSHA256"));
  assert.ok(executor.includes("FixedTimeEquals"));
  assert.ok(executor.includes("Documents"));
  assert.ok(executor.includes("SCREEN_CAPTURE_DISABLED_FOR_PRIVACY"));
  assert.ok(executor.includes("APP_NOT_ALLOWLISTED"));
});

test("Android companion only captures a command after an explicit Speak button action", async () => {
  const main = await readFile(new URL("../android-companion/app/src/main/java/com/ultron/companion/MainActivity.kt", import.meta.url), "utf8");
  const service = await readFile(new URL("../android-companion/app/src/main/java/com/ultron/companion/WakeWordService.kt", import.meta.url), "utf8");
  assert.ok(main.includes('setOnClickListener { beginVoiceCommand() }'));
  assert.ok(main.includes("private fun beginVoiceCommand()"));
  assert.ok(main.includes("private fun dispatchVoiceCommand(command: String)"));
  assert.ok(main.includes("DeviceTokenStore.load(this)"));
  assert.ok(main.includes("DeviceTokenStore.save(this, token)"));
  assert.ok(main.includes('putExtra("source", "android-companion")') === false);
  assert.ok(main.includes('.put("source", "android-companion")'));
  assert.ok(service.includes("SpeechRecognizer.createOnDeviceSpeechRecognizer(this)"));
  assert.ok(service.includes("getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)"));
  assert.ok(!service.includes("/api/jarvis/voice/process-command"));
});
