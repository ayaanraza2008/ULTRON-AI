package com.ultron.companion.network

import android.content.Context
import com.ultron.companion.DeviceTokenStore
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class UltronApiClient(private val context: Context) {
    companion object {
        const val DEFAULT_REMOTE_URL = "https://ultron-ai-core.onrender.com"
        private const val TIMEOUT_MS = 12000
    }

    var customBaseUrl: String? = null

    fun getBaseUrl(): String {
        return customBaseUrl?.trimEnd('/') ?: DEFAULT_REMOTE_URL
    }

    /**
     * Device bearer credentials must only travel to an explicitly configured HTTPS
     * API origin. Redirects are disabled below so a server cannot bounce credentials
     * to a different host.
     */
    private fun apiBaseUrl(): URL {
        val base = URL(getBaseUrl())
        require(base.protocol.equals("https", ignoreCase = true)) {
            "ULTRON API must use HTTPS."
        }
        require(base.host.isNotBlank() && base.userInfo == null &&
            base.query == null && base.ref == null &&
            (base.path.isNullOrEmpty() || base.path == "/")
        ) { "ULTRON API base URL is invalid." }
        return base
    }

    private fun openConnection(endpoint: String, method: String = "GET"): HttpURLConnection {
        require(endpoint.startsWith("/") && !endpoint.startsWith("//") &&
            !endpoint.contains('\\r') && !endpoint.contains('\\n')
        ) { "ULTRON API endpoint is invalid." }

        val base = apiBaseUrl()
        val target = URL(base, endpoint)
        require(target.protocol == base.protocol && target.host.equals(base.host, ignoreCase = true) &&
            target.port == base.port
        ) { "ULTRON API endpoint changed origin." }

        val connection = (target.openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = TIMEOUT_MS
            readTimeout = TIMEOUT_MS
            instanceFollowRedirects = false
            setRequestProperty("Accept", "application/json")
        }

        val token = DeviceTokenStore.load(context)
        if (!token.isNullOrBlank()) {
            connection.setRequestProperty("x-device-token", token)
            connection.setRequestProperty("Authorization", "Bearer $token")
        }

        return connection
    }

    private fun executeJson(connection: HttpURLConnection, body: JSONObject? = null): JSONObject {
        try {
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.outputStream.use { os ->
                    os.write(body.toString().toByteArray(Charsets.UTF_8))
                }
            }

            val code = connection.responseCode
            require(code !in 300..399) {
                "ULTRON API returned a redirect. Credentials were not forwarded."
            }
            val isSuccess = code in 200..299
            val stream = if (isSuccess) connection.inputStream else connection.errorStream
                ?: throw IllegalStateException("HTTP $code without response body.")

            val text = stream.bufferedReader(Charsets.UTF_8).use { it.readText() }
            if (text.isBlank()) return JSONObject()

            val json = JSONObject(text)
            if (!isSuccess) {
                val err = json.optJSONObject("error")
                val msg = err?.optString("message") ?: json.optString("message", "HTTP $code failed.")
                throw IllegalStateException(msg)
            }
            return json
        } finally {
            connection.disconnect()
        }
    }

    /**
     * Claims a 6-digit pairing code from QR scan or manual entry.
     */
    fun claimPairingCode(code: String): Pair<String, String> {
        require(code.matches(Regex("^[0-9]{6}$"))) { "Pairing code must contain exactly 6 digits." }
        val conn = openConnection("/api/devices/pairings/claim", "POST")
        val payload = JSONObject().put("code", code)
        val res = executeJson(conn, payload)
        val token = res.getString("deviceToken")
        val deviceId = res.optString("deviceId", "android-phone")
        DeviceTokenStore.save(context, token)
        return Pair(deviceId, token)
    }

    /**
     * Fetches current Windows PC status from central brain.
     */
    fun fetchWindowsPcStatus(): JSONObject {
        val conn = openConnection("/api/devices/me", "GET")
        val res = executeJson(conn)
        val devices = res.optJSONArray("devices") ?: JSONArray()
        for (i in 0 until devices.length()) {
            val dev = devices.getJSONObject(i)
            val platform = dev.optString("platform").lowercase()
            if (platform == "windows" || platform == "windows_pc") {
                return dev
            }
        }
        return JSONObject().put("online", false).put("name", "Windows PC (Not Paired)")
    }

    /**
     * Routes a remote command to the paired Windows PC.
     */
    fun routeCommandToWindows(action: String, payload: JSONObject = JSONObject()): JSONObject {
        val conn = openConnection("/api/jarvis/devices/route-command", "POST")
        val body = JSONObject().apply {
            put("targetPlatform", "windows")
            put("action", action)
            put("payload", payload)
            put("idempotencyKey", "and-${System.currentTimeMillis()}-${(1000..9999).random()}")
        }
        return executeJson(conn, body)
    }

    /**
     * Dispatches voice command to central ULTRON brain.
     */
    fun processVoiceCommand(command: String, language: String = "hinglish"): JSONObject {
        val conn = openConnection("/api/jarvis/voice/process-command", "POST")
        val body = JSONObject().apply {
            put("command", command)
            put("language", language)
            put("source", "android-companion")
        }
        return executeJson(conn, body)
    }

    /**
     * Fetches shared cross-device task history.
     */
    fun fetchSharedTasks(): JSONArray {
        val conn = openConnection("/api/jarvis/devices/tasks", "GET")
        val res = executeJson(conn)
        return res.optJSONArray("tasks") ?: JSONArray()
    }

    /**
     * Updates Android phone telemetry (battery, charging state).
     */
    fun sendTelemetry(batteryPercent: Int, isCharging: Boolean): Boolean {
        if (DeviceTokenStore.load(context).isNullOrBlank() || batteryPercent !in 0..100) return false
        val conn = openConnection("/api/devices/me/heartbeat", "POST")
        val body = JSONObject().apply {
            put("batteryPercent", batteryPercent)
            put("isCharging", isCharging)
        }
        return try {
            val res = executeJson(conn, body)
            res.optBoolean("success", true)
        } catch (_: Exception) {
            false
        }
    }

    /**
     * Discovers same-Wi-Fi local ULTRON instances.
     * This unauthenticated discovery probe intentionally never attaches device credentials.
     */
    fun probeLocalDiscovery(ipAddress: String, port: Int = 10000): JSONObject? {
        return try {
            require(port in 1..65535)
            require(ipAddress.matches(Regex("^[0-9a-fA-F:.]+$")))
            val url = URL("http://$ipAddress:$port/api/discovery/local")
            val conn = (url.openConnection() as HttpURLConnection).apply {
                connectTimeout = 1500
                readTimeout = 1500
                instanceFollowRedirects = false
            }
            try {
                if (conn.responseCode == 200) {
                    val text = conn.inputStream.bufferedReader().use { it.readText() }
                    JSONObject(text)
                } else null
            } finally {
                conn.disconnect()
            }
        } catch (_: Exception) {
            null
        }
    }
}
