package com.ultron.companion

import android.content.Context
import java.net.URI
import java.util.Locale

/**
 * Validates and stores the one HTTPS origin used by both the Android wake
 * notification and the manual Open ULTRON action.
 */
object AssistantEndpointPolicy {
    const val DEFAULT_ASSISTANT_URL = "https://ultron-ai-zvd7.onrender.com/"

    private val localSuffixes = listOf(
        ".localhost", ".local", ".internal", ".intranet", ".lan",
        ".home", ".test", ".invalid", ".example"
    )
    private val domainPattern = Regex(
        "^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$"
    )
    private val numericHostPattern = Regex("^[0-9.]+$")

    /**
     * Return a normalized HTTPS origin, or null for anything unsafe/unsupported.
     * No DNS lookup is performed while editing settings; actual navigation is
     * handed to the system browser, which performs its own normal TLS checks.
     */
    fun normalize(value: String?): String? {
        if (value.isNullOrBlank() || value.length > 2048) return null
        val parsed = try {
            URI(value.trim())
        } catch (_: Exception) {
            return null
        }

        if (!parsed.isAbsolute ||
            !parsed.scheme.equals("https", ignoreCase = true) ||
            parsed.rawUserInfo != null ||
            parsed.rawQuery != null ||
            parsed.rawFragment != null ||
            parsed.rawPath !in listOf("", "/") ||
            (parsed.port != -1 && parsed.port != 443)
        ) return null

        val host = parsed.host?.lowercase(Locale.ROOT)?.removeSuffix(".") ?: return null
        if (host.length > 253 ||
            !host.contains('.') ||
            host.contains(':') ||
            host.startsWith("[") ||
            numericHostPattern.matches(host) ||
            localSuffixes.any { host == it.removePrefix(".") || host.endsWith(it) } ||
            !domainPattern.matches(host)
        ) return null

        return "https://$host/"
    }
}

object AssistantEndpointStore {
    private const val PREFERENCES = "ultron_companion_settings"
    private const val KEY_ASSISTANT_URL = "assistant_url"

    fun get(context: Context): String {
        val saved = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
            .getString(KEY_ASSISTANT_URL, null)
        return AssistantEndpointPolicy.normalize(saved)
            ?: AssistantEndpointPolicy.DEFAULT_ASSISTANT_URL
    }

    fun save(context: Context, value: String): String? {
        val normalized = AssistantEndpointPolicy.normalize(value) ?: return null
        context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_ASSISTANT_URL, normalized)
            .apply()
        return normalized
    }
}
