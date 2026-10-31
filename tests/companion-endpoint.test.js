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
  assert.doesNotMatch(source, /HttpClient|HttpWebRequest|WebClient|ClientWebSocket|TcpClient/);
});

test("Android wake companion uses on-device speech with explicit microphone and visible Stop controls", async () => {
  const activity = await readFile(new URL("../android-companion/app/src/main/java/com/ultron/companion/MainActivity.kt", import.meta.url), "utf8");
  const service = await readFile(new URL("../android-companion/app/src/main/java/com/ultron/companion/WakeWordService.kt", import.meta.url), "utf8");
  const manifest = await readFile(new URL("../android-companion/app/src/main/AndroidManifest.xml", import.meta.url), "utf8");

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
  assert.doesNotMatch(manifest, /android\.permission\.INTERNET/);
  assert.doesNotMatch(service, /HttpURLConnection|OkHttpClient|WebSocket|Retrofit/);
});
