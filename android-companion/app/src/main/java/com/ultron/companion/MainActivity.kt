package com.ultron.companion

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.speech.SpeechRecognizer
import android.text.InputType
import android.view.Gravity
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

class MainActivity : Activity() {
    private lateinit var status: TextView
    private lateinit var endpointInput: EditText

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        buildLayout()
        if (intent?.action == ACTION_OPEN_ASSISTANT) {
            openAssistant()
            finish()
        }
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
        val endpointLabel = TextView(this).apply {
            text = "ULTRON server (HTTPS)"
            textSize = 15f
            setPadding(0, 12, 0, 6)
        }
        endpointInput = EditText(this).apply {
            singleLine = true
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            hint = "https://your-ultron-host"
            setText(AssistantEndpointStore.get(this@MainActivity))
        }
        val saveEndpoint = Button(this).apply {
            text = "Save server address"
            setOnClickListener {
                val saved = AssistantEndpointStore.save(this@MainActivity, endpointInput.text.toString())
                if (saved == null) {
                    status.text = "Rejected. Use a public HTTPS hostname only, without a path, port, credentials, query, or fragment."
                } else {
                    endpointInput.setText(saved)
                    status.text = "Server address saved. Both Open ULTRON and future wake alerts will use this address."
                }
            }
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
        layout.addView(endpointLabel)
        layout.addView(endpointInput)
        layout.addView(saveEndpoint)
        layout.addView(start)
        layout.addView(stop)
        layout.addView(open)
        setContentView(ScrollView(this).apply {
            isFillViewport = true
            addView(layout)
        })
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
        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(AssistantEndpointStore.get(this))))
    }

    companion object {
        private const val REQUEST_PERMISSIONS = 4701
        const val ACTION_OPEN_ASSISTANT = "com.ultron.companion.OPEN_ASSISTANT"
    }
}
