package com.ultron.companion

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.speech.SpeechRecognizer
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

class MainActivity : Activity() {
    private lateinit var status: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        buildLayout()
    }

    private fun buildLayout() {
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(36, 32, 36, 32)
        }
        val title = TextView(this).apply {
            text = "ULTRON Companion"
            textSize = 26f
            setPadding(0, 0, 0, 20)
        }
        status = TextView(this).apply {
            textSize = 16f
            text = "Wake word is off. Enable it to start local on-device recognition."
            setPadding(0, 0, 0, 24)
        }
        val start = Button(this).apply {
            text = "Enable wake word"
            setOnClickListener { enableWakeWord() }
        }
        val stop = Button(this).apply {
            text = "Stop listening"
            setOnClickListener {
                stopService(Intent(this@MainActivity, WakeWordService::class.java))
                status.text = "Stop requested. Check that the listening notification disappears."
            }
        }
        val open = Button(this).apply {
            text = "Open ULTRON"
            setOnClickListener { openAssistant() }
        }
        layout.addView(title)
        layout.addView(status)
        layout.addView(start)
        layout.addView(stop)
        layout.addView(open)
        setContentView(layout)
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
        if (requestCode != REQUEST_PERMISSIONS) return
        val allGranted = grantResults.isNotEmpty() && grantResults.all {
            it == PackageManager.PERMISSION_GRANTED
        }
        if (!allGranted) {
            status.text = "Microphone and visible-notification permissions are required. Wake word remains off."
            return
        }
        if (SpeechRecognizer.isOnDeviceRecognitionAvailable(this)) {
            startWakeWordService()
        } else {
            status.text = "On-device speech recognition is unavailable. Wake word remains off."
        }
    }

    private fun startWakeWordService() {
        try {
            startForegroundService(Intent(this, WakeWordService::class.java))
            status.text = "Wake-word service requested. Keep its ongoing notification visible; tap the ULTRON alert when the word is detected."
        } catch (_: SecurityException) {
            status.text = "Android blocked microphone service startup. Keep this app visible and re-check microphone/notification permissions."
        } catch (_: IllegalStateException) {
            status.text = "Android did not allow the microphone service to start. Open this app and try again."
        }
    }

    private fun openAssistant() {
        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(ASSISTANT_URL)))
    }

    companion object {
        private const val REQUEST_PERMISSIONS = 4701
        private const val ASSISTANT_URL = "https://ultron-ai-zvd7.onrender.com/"
    }
}
