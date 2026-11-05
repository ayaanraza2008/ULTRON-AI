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

    fun getBaseUrl(): String = customBaseUrl?.trimEnd('/') ?: DEFAULT_REMOTE_URL

    private fun apiBaseUrl(): URL {
        val base = URL(getBaseUrl())
        require(base.protocol.equals("https", ignoreCase = true)) { "ULTRON API must use HTTPS." }
        require(base.host.isNotBlank() && base.userInfo == null && base.query == null &&
            base.ref == null && (base.path.isNullOrEmpty() || base.path == "/")
        ) { "ULTRON API base URL is invalid." }
        return base
    }

    private fun openConnection(endpoint: String, method: String = "GET"): HttpURLConnection {
        require(endpoint.startsWith("/") && !endpoint.startsWith("//") &&
            !endpoint.contains('\r') && !endpoint.contains('\n')
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
            require(code !in 300..399) { "ULTRON API returned a redirect. Credentials were not forwarded." }
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

    fun claimPairingCode(code: String): Pair<String, String> {
        require(code.matches(Regex("^[0-9]{6}$"))) { "Pairing code must contain exactly 6 digits." }
        val conn = openConnection("/api/devices/pairings/claim", "POST")
        val res = executeJson(conn, JSONObject().put("code", code))
        val token = res.getString("deviceToken")
        val deviceId = res.optString("deviceId", "android-phone")
        DeviceTokenStore.save(context, token)
        return Pair(deviceId, token)
    }

    fun fetchWindowsPcStatus(): JSONObject {
        val res = executeJson(openConnection("/api/devices/me", "GET"))
        val devices = res.optJSONArray("devices") ?: JSONArray()
        for (i in 0 until devices.length()) {
            val dev = devices.getJSONObject(i)
            val platform = dev.optString("platform").lowercase()
            if (platform == "windows" || platform == "windows_pc") return dev
        }
        return JSONObject().put("online", false).put("name", "Windows PC (Not Paired)")
    }

    fun routeCommandToWindows(action: String, payload: JSONObject = JSONObject()): JSONObject {
        val body = JSONObject().apply {
            put("targetPlatform", "windows")
            put("action", action)
            put("payload", payload)
            put("idempotencyKey", "and-${System.currentTimeMillis()}-${(1000..9999).random()}")
        }
        return executeJson(openConnection("/api/jarvis/devices/route-command", "POST"), body)
    }

    fun processVoiceCommand(command: String, language: String = "hinglish"): JSONObject {
        val body = JSONObject().apply {
            put("command", command)
            put("language", language)
            put("source", "android-companion")
        }
        return executeJson(openConnection("/api/jarvis/voice/process-command", "POST"), body)
    }

    fun fetchSharedTasks(): JSONArray {
        val res = executeJson(openConnection("/api/jarvis/devices/tasks", "GET"))
        return res.optJSONArray("tasks") ?: JSONArray()
    }

    /**
     * Pulls queued owner-scoped ecosystem state for this paired device.
     * Each event is committed to private local preferences before it is ACKed,
     * so a transient local storage failure leaves the server queue intact.
     */
    fun syncPendingStateEvents(): Boolean {
        return try {
            val response = executeJson(openConnection("/api/jarvis/devices/my/state/events", "GET"))
            val events = response.optJSONArray("events") ?: JSONArray()
            val prefs = context.getSharedPreferences("ultron_shared_state_v1", Context.MODE_PRIVATE)

            for (index in 0 until events.length()) {
                val event = events.optJSONObject(index) ?: return false
                val deliveryId = event.optString("deliveryId").takeIf {
                    it.matches(Regex("^[A-Za-z0-9_-]{1,128}$"))
                } ?: return false
                val stateKey = event.optString("stateKey").takeIf { it.isNotBlank() } ?: return false
                val version = event.optLong("version", -1L)
                if (version < 1L) return false

                val preferenceKey = "state:$stateKey"
                val currentText = prefs.getString(preferenceKey, null)
                val currentVersion = try {
                    if (currentText.isNullOrBlank()) 0L else JSONObject(currentText).optLong("version", 0L)
                } catch (_: Exception) {
                    -1L
                }
                if (currentVersion < 0L) return false

                // Idempotent: older/duplicate events do not overwrite newer local state.
                if (version > currentVersion) {
                    val stateRecord = JSONObject().apply {
                        put("version", version)
                        put("payload", event.opt("payload") ?: JSONObject.NULL)
                        put("timestamp", event.optString("timestamp"))
                    }
                    val committed = prefs.edit().putString(preferenceKey, stateRecord.toString()).commit()
                    if (!committed) return false
                }

                val ackBody = JSONObject()
                val ack = executeJson(
                    openConnection("/api/jarvis/devices/my/state/events/$deliveryId/ack", "POST"),
                    ackBody
                )
                if (!ack.optBoolean("acknowledged", false)) return false
            }
            true
        } catch (_: Exception) {
            false
        }
    }

    fun sendTelemetry(batteryPercent: Int, isCharging: Boolean): Boolean {
        if (DeviceTokenStore.load(context).isNullOrBlank() || batteryPercent !in 0..100) return false
        val body = JSONObject().apply {
            put("batteryPercent", batteryPercent)
            put("isCharging", isCharging)
        }
        return try {
            executeJson(openConnection("/api/devices/me/heartbeat", "POST"), body)
                .optBoolean("success", true)
        } catch (_: Exception) {
            false
        }
    }

    /**
     * Local discovery is unauthenticated by design and never attaches device credentials.
     */
    fun probeLocalDiscovery(ipAddress: String, port: Int = 10000): JSONObject? {
        return try {
            require(port in 1..65535)
            require(ipAddress.matches(Regex("^[0-9a-fA-F:.]+$")))
            val conn = (URL("http://$ipAddress:$port/api/discovery/local")
                .openConnection() as HttpURLConnection).apply {
                connectTimeout = 1500
                readTimeout = 1500
                instanceFollowRedirects = false
            }
            try {
                if (conn.responseCode == 200) {
                    JSONObject(conn.inputStream.bufferedReader().use { it.readText() })
                } else null
            } finally {
                conn.disconnect()
            }
        } catch (_: Exception) {
            null
        }
    }
}
