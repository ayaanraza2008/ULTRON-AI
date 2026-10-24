package com.ultron.companion

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer

class WakeWordService : Service() {
    private val handler = Handler(Looper.getMainLooper())
    private var recognizer: SpeechRecognizer? = null
    private var running = false
    private var restartQueued = false
    private var languageIndex = 0
    private var lastWakeElapsed = 0L

    private val languages = listOf("en-IN", "en-US", "en-GB")
    private val wakePattern = Regex("(?i)(^|[^A-Za-z0-9])ultron([^A-Za-z0-9]|$)")

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopWakeWordService()
            return START_NOT_STICKY
        }

        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            stopSelf()
            return START_NOT_STICKY
        }

        if (running) return START_NOT_STICKY

        startForeground(
            LISTENING_NOTIFICATION_ID,
            buildListeningNotification("Starting local speech recognition…"),
            ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
        )

        if (!SpeechRecognizer.isOnDeviceRecognitionAvailable(this)) {
            updateListeningNotification("On-device speech recognition unavailable. Listening stopped.")
            stopWakeWordService()
            return START_NOT_STICKY
        }

        running = true
        try {
            recognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(this)
            recognizer?.setRecognitionListener(listener)
            scheduleRecognition(300)
        } catch (_: RuntimeException) {
            updateListeningNotification("Could not start local recognition. Listening stopped.")
            stopWakeWordService()
            return START_NOT_STICKY
        }
        // Request best-effort system restart if Android reclaims this process.
        // User Stop explicitly calls stopSelf(), so intentional shutdown remains non-sticky.
        // This does not restart after force-stop or device reboot.
        return START_STICKY
    }

    private val listener = object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) {
            updateListeningNotification("Listening locally for “Ultron”. Tap Stop to disable.")
        }

        override fun onBeginningOfSpeech() = Unit
        override fun onRmsChanged(rmsdB: Float) = Unit
        override fun onBufferReceived(buffer: ByteArray?) = Unit
        override fun onEndOfSpeech() = Unit
        override fun onEvent(eventType: Int, params: Bundle?) = Unit

        override fun onPartialResults(partialResults: Bundle?) {
            inspectRecognition(partialResults)
        }

        override fun onResults(results: Bundle?) {
            inspectRecognition(results)
            scheduleRecognition(350)
        }

        override fun onError(error: Int) {
            if (!running) return
            if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) {
                updateListeningNotification("Microphone permission revoked. Listening stopped.")
                stopWakeWordService()
                return
            }
            if (error == SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED ||
                error == SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE
            ) {
                languageIndex++
                if (languageIndex >= languages.size) {
                    updateListeningNotification("No compatible offline English model found. Listening stopped.")
                    stopWakeWordService()
                    return
                }
                updateListeningNotification("Trying installed offline language: " + languages[languageIndex])
            }
            // No-match/timeouts are normal for an idle wake-word listener. Back off rather
            // than spinning if Android's recognition service is temporarily busy.
            scheduleRecognition(if (error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY) 1500 else 700)
        }
    }

    private fun inspectRecognition(bundle: Bundle?) {
        val phrases = bundle?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION) ?: return
        if (phrases.any { wakePattern.containsMatchIn(it) }) notifyWakeWord()
    }

    private fun scheduleRecognition(delayMillis: Long) {
        if (!running || restartQueued) return
        restartQueued = true
        handler.postDelayed({
            restartQueued = false
            if (!running) return@postDelayed
            try {
                val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE, languages[languageIndex])
                    putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5)
                    putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                    putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
                }
                recognizer?.startListening(intent)
            } catch (_: RuntimeException) {
                scheduleRecognition(1500)
            }
        }, delayMillis)
    }

    private fun notifyWakeWord() {
        val now = SystemClock.elapsedRealtime()
        if (now - lastWakeElapsed < WAKE_COOLDOWN_MS) return
        lastWakeElapsed = now

        val openIntent = PendingIntent.getActivity(
            this,
            OPEN_REQUEST_CODE,
            Intent(Intent.ACTION_VIEW, Uri.parse(ASSISTANT_URL)),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val notification = Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle("ULTRON detected")
            .setContentText("Tap to open the ULTRON assistant.")
            .setContentIntent(openIntent)
            .setAutoCancel(true)
            .setCategory(Notification.CATEGORY_REMINDER)
            .setPriority(Notification.PRIORITY_HIGH)
            .build()

        getSystemService(NotificationManager::class.java).notify(WAKE_NOTIFICATION_ID, notification)
        updateListeningNotification("“Ultron” detected. Tap the ULTRON alert to open the assistant.")
    }

    private fun buildListeningNotification(text: String): Notification {
        val stopIntent = PendingIntent.getService(
            this,
            STOP_REQUEST_CODE,
            Intent(this, WakeWordService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val openIntent = PendingIntent.getActivity(
            this,
            OPEN_REQUEST_CODE,
            Intent(Intent.ACTION_VIEW, Uri.parse(ASSISTANT_URL)),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle("ULTRON wake word")
            .setContentText(text)
            .setContentIntent(openIntent)
            .setOngoing(true)
            .setCategory(Notification.CATEGORY_SERVICE)
            .addAction(Notification.Action.Builder(null, "Stop listening", stopIntent).build())
            .build()
    }

    private fun updateListeningNotification(text: String) {
        getSystemService(NotificationManager::class.java)
            .notify(LISTENING_NOTIFICATION_ID, buildListeningNotification(text))
    }

    private fun createNotificationChannel() {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "ULTRON wake word", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Visible status and Stop control while local wake-word listening is active."
            }
        )
    }

    private fun stopWakeWordService() {
        running = false
        restartQueued = false
        handler.removeCallbacksAndMessages(null)
        try { recognizer?.cancel() } catch (_: RuntimeException) { }
        try { recognizer?.destroy() } catch (_: RuntimeException) { }
        recognizer = null
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        running = false
        handler.removeCallbacksAndMessages(null)
        try { recognizer?.cancel() } catch (_: RuntimeException) { }
        try { recognizer?.destroy() } catch (_: RuntimeException) { }
        recognizer = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        private const val ACTION_STOP = "com.ultron.companion.STOP_WAKE_WORD"
        private const val CHANNEL_ID = "ultron_wake_word"
        private const val LISTENING_NOTIFICATION_ID = 3101
        private const val WAKE_NOTIFICATION_ID = 3102
        private const val STOP_REQUEST_CODE = 3103
        private const val OPEN_REQUEST_CODE = 3104
        private const val WAKE_COOLDOWN_MS = 8_000L
        private const val ASSISTANT_URL = "https://ultron-ai-zvd7.onrender.com/"
    }
}
