package com.ultron.companion

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.nio.ByteBuffer
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Stores the per-device bearer token encrypted with an Android Keystore AES key.
 * The key is non-exportable and scoped to this Android app installation.
 */
internal object DeviceTokenStore {
    private const val PREFERENCES = "ultron_device_secure"
    private const val TOKEN_KEY = "device_token_v1"
    private const val KEY_ALIAS = "com.ultron.companion.device-token.v1"
    private const val TRANSFORMATION = "AES/GCM/NoPadding"
    private const val IV_LENGTH = 12
    private const val TAG_BITS = 128
    private const val MAX_TOKEN_LENGTH = 256

    @Synchronized
    private fun encryptionKey(): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val existing = keyStore.getKey(KEY_ALIAS, null) as? SecretKey
        if (existing != null) return existing

        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build()
        )
        return generator.generateKey()
    }

    fun save(context: Context, token: String) {
        require(token.matches(Regex("^ultron_dev_[a-f0-9]{64}$", RegexOption.IGNORE_CASE))) {
            "The ULTRON device token has an invalid format."
        }
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, encryptionKey())
        val clearBytes = token.toByteArray(Charsets.UTF_8)
        try {
            val encrypted = cipher.doFinal(clearBytes)
            val iv = cipher.iv
            require(iv.size == IV_LENGTH) { "Unexpected Android Keystore IV length." }
            val packed = ByteBuffer.allocate(1 + iv.size + encrypted.size)
                .put(iv.size.toByte())
                .put(iv)
                .put(encrypted)
                .array()
            val encoded = Base64.encodeToString(packed, Base64.NO_WRAP)
            context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
                .edit()
                .putString(TOKEN_KEY, encoded)
                .commit()
            if (!context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).contains(TOKEN_KEY)) {
                throw IllegalStateException("Could not save the protected device token.")
            }
        } finally {
            clearBytes.fill(0)
        }
    }

    fun load(context: Context): String? {
        val encoded = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
            .getString(TOKEN_KEY, null) ?: return null
        return try {
            val packed = Base64.decode(encoded, Base64.NO_WRAP)
            if (packed.size <= 1 + IV_LENGTH + 16) return null
            val buffer = ByteBuffer.wrap(packed)
            val ivLength = buffer.get().toInt() and 0xff
            if (ivLength != IV_LENGTH || buffer.remaining() <= ivLength + 16) return null
            val iv = ByteArray(ivLength)
            buffer.get(iv)
            val encrypted = ByteArray(buffer.remaining())
            buffer.get(encrypted)
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, encryptionKey(), GCMParameterSpec(TAG_BITS, iv))
            val clear = cipher.doFinal(encrypted)
            try {
                String(clear, Charsets.UTF_8).takeIf {
                    it.length <= MAX_TOKEN_LENGTH &&
                        it.matches(Regex("^ultron_dev_[a-f0-9]{64}$", RegexOption.IGNORE_CASE))
                }
            } finally {
                clear.fill(0)
            }
        } catch (_: Exception) {
            null
        }
    }

    fun clear(context: Context) {
        context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
            .edit()
            .remove(TOKEN_KEY)
            .commit()
    }

    fun isPaired(context: Context): Boolean = load(context) != null
}
