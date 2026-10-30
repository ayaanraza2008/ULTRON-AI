package com.ultron.companion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertNotNull
import org.junit.Test

class AssistantEndpointPolicyTest {
    @Test
    fun acceptsAndNormalizesPublicHttpsOrigins() {
        assertEquals(
            "https://example.com/",
            AssistantEndpointPolicy.normalize("https://example.com")
        )
        assertEquals(
            "https://ultron.example.net/",
            AssistantEndpointPolicy.normalize(" HTTPS://ULTRON.EXAMPLE.NET/ ")
        )
        assertEquals(
            "https://example.com/",
            AssistantEndpointPolicy.normalize("https://example.com:443/")
        )
    }

    @Test
    fun rejectsInsecureLocalAndIpLiteralDestinations() {
        val invalid = listOf(
            "",
            "   ",
            "not a URL",
            "http://example.com/",
            "file:///etc/passwd",
            "https://localhost/",
            "https://LOCALHOST/",
            "https://127.0.0.1/",
            "https://192.168.1.10/",
            "https://169.254.169.254/",
            "https://[::1]/",
            "https://[fd00::1]/",
            "https://router.local/",
            "https://service.internal/",
            "https://device.lan/",
            "https://printer.home/",
            "https://host.test/",
            "https://host.invalid/",
            "https://host.example/"
        )

        invalid.forEach { value ->
            assertNull("Expected destination to be rejected: $value", AssistantEndpointPolicy.normalize(value))
        }
    }

    @Test
    fun rejectsCredentialsPathsQueriesFragmentsAndNonDefaultPorts() {
        val invalid = listOf(
            "https://user:password@example.com/",
            "https://example.com/private",
            "https://example.com/?token=secret",
            "https://example.com/#fragment",
            "https://example.com:8443/",
            "https://example.com:444/"
        )

        invalid.forEach { value ->
            assertNull("Expected destination to be rejected: $value", AssistantEndpointPolicy.normalize(value))
        }
    }

    @Test
    fun rejectsMalformedAndOverlongHostnames() {
        assertNull(AssistantEndpointPolicy.normalize(null))
        assertNull(AssistantEndpointPolicy.normalize("https://single-label/"))
        assertNull(AssistantEndpointPolicy.normalize("https://-invalid.example/"))
        assertNull(AssistantEndpointPolicy.normalize("https://" + "a".repeat(260) + ".example/"))
        assertNull(AssistantEndpointPolicy.normalize("x".repeat(2049)))
    }

    @Test
    fun defaultDestinationIsAValidHttpsOrigin() {
        assertNotNull(AssistantEndpointPolicy.normalize(AssistantEndpointPolicy.DEFAULT_ASSISTANT_URL))
        assertEquals(
            AssistantEndpointPolicy.DEFAULT_ASSISTANT_URL,
            AssistantEndpointPolicy.normalize(AssistantEndpointPolicy.DEFAULT_ASSISTANT_URL)
        )
    }
}
