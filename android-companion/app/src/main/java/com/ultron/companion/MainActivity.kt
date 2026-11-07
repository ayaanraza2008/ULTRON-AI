package com.ultron.companion

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.text.InputType
import android.view.Gravity
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.Spinner
import android.widget.TextView
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.ultron.companion.service.UltronSyncWorker
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale
import java.util.concurrent.TimeUnit

class MainActivity : Activity() {
    private lateinit var status: TextView
    private lateinit var pairingInput: EditText
    private lateinit var pairingStatus: TextView
    private lateinit var languagePicker: Spinner
    private var commandRecognizer: SpeechRecognizer? = null
    private var textToSpeech: TextToSpeech? = null
    private var textToSpeechReady = false
    private var pendingVoiceReply: Pair<String, String>? = null
    private var pendingVoiceReplyResumeWake = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        buildLayout()
        textToSpeech = TextToSpeech(this) { result ->
            textToSpeechReady = result == TextToSpeech.SUCCESS
            if (textToSpeechReady) {
                textToSpeech?.setSpeechRate(0.96f)
                textToSpeech?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                    override fun onStart(utteranceId: String?) = Unit
                    override fun onDone(utteranceId: String?) {
                        runOnUiThread { resumeWakeWordAfterCommand() }
                    }
                    override fun onError(utteranceId: String?) {
                        runOnUiThread { resumeWakeWordAfterCommand() }
                    }
                })
                pendingVoiceReply?.let { (text, language) ->
                    val resumeWake = pendingVoiceReplyResumeWake
                    pendingVoiceReply = null
                    pendingVoiceReplyResumeWake = false
                    speakVoiceReply(text, language, resumeWake)
                }
            } else {
                resumeWakeWordAfterCommand()
            }
        }
        updatePairingStatus()
        if (DeviceTokenStore.isPaired(this)) {
            scheduleTelemetrySync()
        } else {
            cancelTelemetrySync()
        }
        if (intent.getBooleanExtra(EXTRA_START_VOICE_COMMAND, false)) {
            intent.removeExtra(EXTRA_START_VOICE_COMMAND)
            window.decorView.post { beginVoiceCommand() }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.getBooleanExtra(EXTRA_START_VOICE_COMMAND, false)) {
            intent.removeExtra(EXTRA_START_VOICE_COMMAND)
            window.decorView.post { beginVoiceCommand() }
        }
    }

    private fun buildLayout() {
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(28, 20, 28, 20)
        }
        val title = TextView(this).apply {
            text = "ULTRON Companion"
            textSize = 26f
            setPadding(0, 0, 0, 12)
        }
        status = TextView(this).apply {
            textSize = 15f
            text = "Wake word is off. Enable it for local on-device recognition."
            setPadding(0, 0, 0, 12)
        }
        pairingStatus = TextView(this).apply {
            textSize = 13f
            setPadding(0, 0, 0, 6)
        }
        pairingInput = EditText(this).apply {
            hint = "Six-digit ULTRON code or rotated device token"
            inputType = InputType.TYPE_CLASS_TEXT
            isSingleLine = true
            filters = arrayOf(android.text.InputFilter.LengthFilter(80))
        }
        val pair = Button(this).apply {
            text = "Pair / update device token"
            setOnClickListener { pairDevice() }
        }
        val speakLabel = TextView(this).apply {
            text = "Voice command (recording begins only after you tap Speak)"
            textSize = 12f
            setPadding(0, 12, 0, 4)
        }
        languagePicker = Spinner(this).apply {
            adapter = ArrayAdapter(
                this@MainActivity,
                android.R.layout.simple_spinner_dropdown_item,
                listOf("English (India)", "Hindi", "English (US)")
            )
        }
        val speak = Button(this).apply {
            text = "Speak command to ULTRON"
            setOnClickListener { beginVoiceCommand() }
        }
        val start = Button(this).apply {
            text = "Enable local wake word"
            setOnClickListener { enableWakeWord() }
        }
        val stop = Button(this).apply {
            text = "Stop listening"
            setOnClickListener {
                getSharedPreferences(WAKE_PREFERENCES, MODE_PRIVATE)
                    .edit().putBoolean(WAKE_ENABLED_KEY, false).apply()
                stopService(Intent(this@MainActivity, WakeWordService::class.java))
                status.text = "Wake-word listening is disabled. It will not restart after this command."
            }
        }
        val open = Button(this).apply {
            text = "Open ULTRON"
            setOnClickListener { openAssistant() }
        }
        val openCompose = Button(this).apply {
            text = "Open Compose Command Center"
            setOnClickListener {
                startActivity(android.content.Intent(this@MainActivity, com.ultron.companion.ui.UltronComposeActivity::class.java))
            }
        }

        layout.addView(title)
        layout.addView(status)
        layout.addView(pairingStatus)
        layout.addView(pairingInput)
        layout.addView(pair)
        layout.addView(speakLabel)
        layout.addView(languagePicker)
        layout.addView(speak)
        layout.addView(start)
        layout.addView(stop)
        layout.addView(open)
        layout.addView(openCompose)
        setContentView(layout)
    }

    private fun updatePairingStatus() {
        pairingStatus.text = if (DeviceTokenStore.isPaired(this)) {
            "DEVICE PAIRED · TOKEN ENCRYPTED WITH ANDROID KEYSTORE"
        } else {
            "DEVICE NOT PAIRED · WAKE WORD CAN STILL RUN LOCALLY"
        }
    }

    private fun scheduleTelemetrySync() {
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()
        val request = PeriodicWorkRequestBuilder<UltronSyncWorker>(15, TimeUnit.MINUTES)
            .setConstraints(constraints)
            .build()
        WorkManager.getInstance(applicationContext).enqueueUniquePeriodicWork(
            TELEMETRY_WORK_NAME,
            ExistingPeriodicWorkPolicy.KEEP,
            request
        )
    }

    private fun cancelTelemetrySync() {
        WorkManager.getInstance(applicationContext).cancelUniqueWork(TELEMETRY_WORK_NAME)
    }

    private fun pairDevice() {
        val entered = pairingInput.text?.toString()?.trim().orEmpty()
        if (entered.matches(Regex("^ultron_dev_[a-f0-9]{64}$", RegexOption.IGNORE_CASE))) {
            try {
                DeviceTokenStore.save(this, entered)
                scheduleTelemetrySync()
                pairingInput.setText("")
                updatePairingStatus()
                status.text = "Rotated device token protected with Android Keystore."
            } catch (_: Exception) {
                status.text = "Could not protect the new device token. The existing pairing was not changed."
            }
            return
        }
        if (!entered.matches(Regex("^\\d{6}$"))) {
            status.text = "Enter the six-digit code displayed in your ULTRON account, or paste a rotated device token."
            return
        }

        status.text = "Claiming the one-time pairing code…"
        Thread {
            try {
                val result = postJson(
                    "/api/devices/pairings/claim",
                    JSONObject().put("code", entered)
                )
                val token = result.optString("deviceToken")
                if (!token.matches(Regex("^ultron_dev_[a-f0-9]{64}$", RegexOption.IGNORE_CASE))) {
                    throw IllegalStateException("ULTRON returned an invalid pairing credential.")
                }
                DeviceTokenStore.save(this, token)
                scheduleTelemetrySync()
                runOnUiThread {
                    pairingInput.setText("")
                    updatePairingStatus()
                    status.text = "Paired securely. Device credential is encrypted using Android Keystore."
                }
            } catch (error: Exception) {
                runOnUiThread {
                    status.text = error.message ?: "Pairing failed. Check the code, migration and backend connection."
                }
            }
        }.start()
    }

    private fun beginVoiceCommand() {
        // Release the wake recognizer before capturing the actual command.
        // The user's explicit wake-word opt-in is retained for a later restart.
        stopService(Intent(this, WakeWordService::class.java))
        if (!DeviceTokenStore.isPaired(this)) {
            getSharedPreferences(WAKE_PREFERENCES, MODE_PRIVATE)
                .edit().putBoolean(WAKE_ENABLED_KEY, false).apply()
            status.text = "Pair this Android device first, then enable local wake word again."
            return
        }
        if (!SpeechRecognizer.isOnDeviceRecognitionAvailable(this)) {
            getSharedPreferences(WAKE_PREFERENCES, MODE_PRIVATE)
                .edit().putBoolean(WAKE_ENABLED_KEY, false).apply()
            status.text = "On-device speech recognition is unavailable. The command was not recorded or uploaded; wake word was disabled."
            return
        }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQUEST_SPEAK_PERMISSION)
            return
        }
        startOnDeviceCommandRecognition()
    }

    private fun startOnDeviceCommandRecognition() {
        stopCommandRecognition()
        try {
            val recognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(this)
            commandRecognizer = recognizer
            recognizer.setRecognitionListener(object : RecognitionListener {
                override fun onReadyForSpeech(params: Bundle?) {
                    runOnUiThread { status.text = "Listening once on this phone. Speak your ULTRON command now." }
                }
                override fun onBeginningOfSpeech() = Unit
                override fun onRmsChanged(rmsdB: Float) = Unit
                override fun onBufferReceived(buffer: ByteArray?) = Unit
                override fun onEndOfSpeech() {
                    runOnUiThread { status.text = "Speech captured locally. Processing the command…" }
                }
                override fun onEvent(eventType: Int, params: Bundle?) = Unit
                override fun onPartialResults(partialResults: Bundle?) = Unit
                override fun onResults(results: Bundle?) {
                    val command = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                        ?.firstOrNull()?.trim().orEmpty()
                    stopCommandRecognition()
                    if (command.isBlank()) {
                        runOnUiThread {
                            status.text = "No command was recognised. Tap Speak and try again."
                            resumeWakeWordAfterCommand()
                        }
                        return
                    }
                    dispatchVoiceCommand(command)
                }
                override fun onError(error: Int) {
                    stopCommandRecognition()
                    runOnUiThread {
                        status.text = "On-device speech recognition failed (code $error). No audio was uploaded."
                        resumeWakeWordAfterCommand()
                    }
                }
            })
            val language = selectedLanguage()
            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, language)
                putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
                putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
                putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
            }
            recognizer.startListening(intent)
        } catch (_: RuntimeException) {
            stopCommandRecognition()
            status.text = "Could not start on-device recognition. No command was sent."
        }
    }

    private fun selectedLanguage(): String = when (languagePicker.selectedItemPosition) {
        1 -> "hi-IN"
        2 -> "en-US"
        else -> "en-IN"
    }

    private fun speakVoiceReply(text: String, languageTag: String, resumeWake: Boolean = true) {
        val cleanText = text.trim().take(3000)
        if (cleanText.isBlank()) {
            if (resumeWake) resumeWakeWordAfterCommand()
            return
        }
        val engine = textToSpeech
        if (engine == null || !textToSpeechReady) {
            pendingVoiceReply = cleanText to languageTag
            pendingVoiceReplyResumeWake = resumeWake
            return
        }

        try {
            val requestedLocale = Locale.forLanguageTag(languageTag)
            val languageStatus = engine.setLanguage(requestedLocale)
            if (languageStatus == TextToSpeech.LANG_MISSING_DATA ||
                languageStatus == TextToSpeech.LANG_NOT_SUPPORTED
            ) {
                engine.setLanguage(Locale.getDefault())
            }
            engine.setSpeechRate(0.96f)
            val result = engine.speak(
                cleanText,
                TextToSpeech.QUEUE_FLUSH,
                null,
                "ultron-voice-reply-${System.currentTimeMillis()}"
            )
            if (result == TextToSpeech.ERROR && resumeWake) resumeWakeWordAfterCommand()
        } catch (_: RuntimeException) {
            // Keep the recognised response visible even when the device TTS engine fails.
            if (resumeWake) resumeWakeWordAfterCommand()
        }
    }

    private fun dispatchVoiceCommand(command: String) {
        val token = DeviceTokenStore.load(this)
        if (token.isNullOrBlank()) {
            status.text = "The device token is missing or could not be decrypted. Pair this device again."
            updatePairingStatus()
            resumeWakeWordAfterCommand()
            return
        }
        val language = selectedLanguage()
        status.text = "Sending the recognised text command to ULTRON…"
        Thread {
            try {
                val result = postJson(
                    "/api/jarvis/voice/process-command",
                    JSONObject()
                        .put("command", command.take(2000))
                        .put("language", language)
                        .put("source", "android-companion"),
                    token
                )
                val reply = result.optString("textResponse").take(1200)
                runOnUiThread {
                    status.text = if (reply.isBlank()) {
                        "ULTRON returned an empty response."
                    } else {
                        "ULTRON: $reply"
                    }
                    if (reply.isNotBlank()) {
                        speakVoiceReply(reply, language, resumeWake = true)
                    } else {
                        resumeWakeWordAfterCommand()
                    }
                }
            } catch (error: Exception) {
                runOnUiThread {
                    status.text = error.message ?: "ULTRON could not process this command. Check device pairing and connectivity."
                    resumeWakeWordAfterCommand()
                }
            }
        }.start()
    }

    private fun postJson(path: String, body: JSONObject, deviceToken: String? = null): JSONObject {
        val connection = (URL(BACKEND_URL + path).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = NETWORK_TIMEOUT_MS
            readTimeout = NETWORK_TIMEOUT_MS
            doOutput = true
            useCaches = false
            instanceFollowRedirects = false
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("Accept", "application/json")
            if (!deviceToken.isNullOrBlank()) setRequestProperty("x-device-token", deviceToken)
        }
        try {
            connection.outputStream.use { output ->
                output.write(body.toString().toByteArray(Charsets.UTF_8))
            }
            val statusCode = connection.responseCode
            val stream = if (statusCode in 200..299) connection.inputStream else connection.errorStream
            val raw = stream?.use { input ->
                val output = ByteArrayOutputStream()
                val buffer = ByteArray(4096)
                var total = 0
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    total += count
                    if (total > MAX_RESPONSE_BYTES) throw IllegalStateException("ULTRON response exceeded the safety limit.")
                    output.write(buffer, 0, count)
                }
                output.toString(Charsets.UTF_8.name())
            }.orEmpty()
            val result = if (raw.isBlank()) JSONObject() else JSONObject(raw)
            if (statusCode !in 200..299) {
                val message = result.optJSONObject("error")?.optString("message")
                throw IllegalStateException(message?.takeIf { it.isNotBlank() } ?: "ULTRON request failed (HTTP $statusCode).")
            }
            return result
        } finally {
            connection.disconnect()
        }
    }

    private fun stopCommandRecognition() {
        val recognizer = commandRecognizer
        commandRecognizer = null
        try { recognizer?.cancel() } catch (_: RuntimeException) { }
        try { recognizer?.destroy() } catch (_: RuntimeException) { }
    }

    private fun enableWakeWord() {
        if (!SpeechRecognizer.isOnDeviceRecognitionAvailable(this)) {
            status.text = "On-device speech recognition is unavailable on this phone. Listening remains off; remote recognition is not used as a fallback."
            return
        }
        val required = mutableListOf(Manifest.permission.RECORD_AUDIO)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            required.add(Manifest.permission.POST_NOTIFICATIONS)
        }
        val missing = required.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isNotEmpty()) {
            requestPermissions(missing.toTypedArray(), REQUEST_PERMISSIONS)
            return
        }
        startWakeWordService()
    }

    @Deprecated("Permission result callback required for API compatibility")
    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQUEST_SPEAK_PERMISSION) {
            if (grantResults.isNotEmpty() && grantResults.all { it == PackageManager.PERMISSION_GRANTED } &&
                SpeechRecognizer.isOnDeviceRecognitionAvailable(this)
            ) {
                startOnDeviceCommandRecognition()
            } else {
                getSharedPreferences(WAKE_PREFERENCES, MODE_PRIVATE)
                    .edit().putBoolean(WAKE_ENABLED_KEY, false).apply()
                status.text = "Microphone permission is required. No command was captured and wake-word listening was disabled."
            }
            return
        }
        if (requestCode != REQUEST_PERMISSIONS) return
        val allGranted = grantResults.isNotEmpty() && grantResults.all {
            it == PackageManager.PERMISSION_GRANTED
        }
        if (!allGranted) {
            getSharedPreferences(WAKE_PREFERENCES, MODE_PRIVATE)
                .edit().putBoolean(WAKE_ENABLED_KEY, false).apply()
            status.text = "Microphone and visible-notification permissions are required. Wake word remains off."
            return
        }
        if (SpeechRecognizer.isOnDeviceRecognitionAvailable(this)) {
            startWakeWordService()
        } else {
            getSharedPreferences(WAKE_PREFERENCES, MODE_PRIVATE)
                .edit().putBoolean(WAKE_ENABLED_KEY, false).apply()
            status.text = "On-device speech recognition is unavailable. Wake word remains off."
        }
    }

    private fun resumeWakeWordAfterCommand() {
        val preferences = getSharedPreferences(WAKE_PREFERENCES, MODE_PRIVATE)
        if (!preferences.getBoolean(WAKE_ENABLED_KEY, false)) return
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED ||
            !SpeechRecognizer.isOnDeviceRecognitionAvailable(this)
        ) {
            preferences.edit().putBoolean(WAKE_ENABLED_KEY, false).apply()
            status.text = "Wake-word listening was disabled because microphone permission or the offline speech model is unavailable."
            return
        }
        status.postDelayed({
            if (preferences.getBoolean(WAKE_ENABLED_KEY, false)) startWakeWordService()
        }, WAKE_RESUME_DELAY_MS)
    }

    private fun startWakeWordService() {
        try {
            startForegroundService(Intent(this, WakeWordService::class.java))
            getSharedPreferences(WAKE_PREFERENCES, MODE_PRIVATE)
                .edit().putBoolean(WAKE_ENABLED_KEY, true).apply()
            status.text = "Wake-word listening enabled. After each command, it will resume while this opt-in remains on. Use Stop listening to disable it."
        } catch (_: SecurityException) {
            status.text = "Android blocked microphone service startup. Re-check microphone/notification permissions."
        } catch (_: IllegalStateException) {
            status.text = "Android did not allow the microphone service to start. Open this app and try again."
        }
    }

    private fun openAssistant() {
        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(ASSISTANT_URL)))
    }

    override fun onDestroy() {
        stopCommandRecognition()
        textToSpeech?.stop()
        textToSpeech?.shutdown()
        textToSpeech = null
        textToSpeechReady = false
        pendingVoiceReply = null
        super.onDestroy()
    }

    companion object {
        const val EXTRA_START_VOICE_COMMAND = "com.ultron.companion.EXTRA_START_VOICE_COMMAND"
        private const val TELEMETRY_WORK_NAME = "ultron-device-telemetry"
        private const val REQUEST_PERMISSIONS = 4701
        private const val REQUEST_SPEAK_PERMISSION = 4702
        private const val WAKE_PREFERENCES = "ultron_wake_word_preferences"
        private const val WAKE_ENABLED_KEY = "wake_word_enabled"
        private const val WAKE_RESUME_DELAY_MS = 900L
        private const val NETWORK_TIMEOUT_MS = 12000
        private const val MAX_RESPONSE_BYTES = 256 * 1024
        private const val BACKEND_URL = "https://ultron-ai-core.onrender.com"
        private const val ASSISTANT_URL = "https://ultron-core-interface.onrender.com/"
    }
}
