using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

namespace Ultron.Companion;

/// <summary>
/// A polling Windows companion for ULTRON's owner-approved, allow-listed desktop action queue.
/// It never accepts shell text, executable paths, arbitrary process arguments, or local file paths.
/// </summary>
internal sealed class DesktopActionBridge : IDisposable
{
    private const int MaxResponseBytes = 64 * 1024;
    private readonly HttpClient _http = new(new HttpClientHandler { AllowAutoRedirect = false })
    {
        Timeout = TimeSpan.FromSeconds(10)
    };
    private bool _disposed;

    public static bool HasValidConfiguration(string baseUrl, string token)
    {
        if (string.IsNullOrWhiteSpace(token) || token.Trim().Length < 32 || token.Any(char.IsWhiteSpace))
            return false;
        if (!Uri.TryCreate(baseUrl, UriKind.Absolute, out var uri))
            return false;
        if (uri.UserInfo.Length != 0 || uri.Query.Length != 0 || uri.Fragment.Length != 0 ||
            uri.AbsolutePath != "/" || !string.IsNullOrEmpty(uri.Port.ToString()) && uri.Port != 443 && uri.Scheme == Uri.UriSchemeHttps)
            return false;

        var loopbackHttp = uri.Scheme == Uri.UriSchemeHttp && uri.IsLoopback;
        return loopbackHttp || (uri.Scheme == Uri.UriSchemeHttps && IsPublicHost(uri.Host));
    }

    public async Task RunAsync(string baseUrl, string token, Action<string> reportStatus, CancellationToken cancellationToken)
    {
        var lastStatus = "";
        void ReportOnce(string message)
        {
            if (message == lastStatus) return;
            lastStatus = message;
            reportStatus(message);
        }

        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                var poll = await PollOnceAsync(baseUrl.TrimEnd('/'), token, cancellationToken);
                ReportOnce(poll.Status);
                await Task.Delay(TimeSpan.FromSeconds(5), cancellationToken);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception)
            {
                ReportOnce("PC action bridge is temporarily unavailable. It will retry without running any unapproved action.");
                try { await Task.Delay(TimeSpan.FromSeconds(8), cancellationToken); }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { break; }
            }
        }
    }

    private async Task<(bool DidWork, string Status)> PollOnceAsync(string baseUrl, string token, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, baseUrl + "/api/desktop/bridge/next")
        {
            Content = new StringContent("{}", Encoding.UTF8, "application/json")
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

        using var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        if (response.StatusCode == HttpStatusCode.Unauthorized || response.StatusCode == HttpStatusCode.Forbidden)
        {
            await CancelBodyAsync(response);
            return (false, "PC action bridge authentication failed. Check the server/local bridge token.");
        }
        if (!response.IsSuccessStatusCode)
        {
            var status = response.StatusCode == HttpStatusCode.TooManyRequests
                ? "PC action bridge is rate-limited; retrying safely."
                : "PC action queue is not available yet. No action was executed.";
            await CancelBodyAsync(response);
            return (false, status);
        }

        using var document = JsonDocument.Parse(await ReadLimitedAsync(response.Content, MaxResponseBytes, cancellationToken));
        if (!document.RootElement.TryGetProperty("action", out var action) || action.ValueKind != JsonValueKind.Object)
            return (false, "PC action bridge connected; waiting for owner-approved actions.");

        var id = ReadString(action, "id", 60);
        var actionType = ReadString(action, "actionType", 40);
        if (!Guid.TryParse(id, out _))
            return (false, "The desktop action queue returned an invalid item; no PC action was run.");

        object result;
        string state;
        string? errorCode = null;
        try
        {
            result = await ExecuteAllowedActionAsync(actionType, action, cancellationToken);
            state = "completed";
        }
        catch (UnsafeDesktopActionException)
        {
            result = new { ok = false, summary = "The local safety allowlist rejected this action.", platform = "windows" };
            state = "failed";
            errorCode = "UNSAFE_URL";
        }
        catch (NotSupportedException)
        {
            result = new { ok = false, summary = "The action type or parameters are not supported by this Windows companion.", platform = "windows" };
            state = "failed";
            errorCode = "ACTION_NOT_SUPPORTED";
        }
        catch (Exception)
        {
            result = new { ok = false, summary = "The approved action could not be completed.", platform = "windows" };
            state = "failed";
            errorCode = actionType == "launch_app" ? "APP_LAUNCH_FAILED" : "ACTION_FAILED";
        }

        await AcknowledgeAsync(baseUrl, token, id, state, result, errorCode, cancellationToken);
        return (true, "An approved PC action was processed. Waiting for the next approved action.");
    }

    private async Task<object> ExecuteAllowedActionAsync(string actionType, JsonElement action, CancellationToken cancellationToken)
    {
        var payload = action.TryGetProperty("payload", out var rawPayload) && rawPayload.ValueKind == JsonValueKind.Object
            ? rawPayload
            : throw new NotSupportedException("Missing action payload.");

        switch (actionType)
        {
            case "launch_app":
            {
                var app = ReadString(payload, "app", 30);
                var executable = app switch
                {
                    "notepad" => "notepad.exe",
                    "calculator" => "calc.exe",
                    "explorer" => "explorer.exe",
                    _ => throw new NotSupportedException("Application is not allow-listed.")
                };
                Process.Start(new ProcessStartInfo(executable) { UseShellExecute = true });
                return new { ok = true, summary = "The approved application was launched.", platform = "windows", app };
            }
            case "open_url":
            {
                var value = ReadString(payload, "url", 1200);
                var uri = await ValidatePublicHttpsUriAsync(value, cancellationToken);
                Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
                return new { ok = true, summary = "The approved HTTPS destination was opened in the default browser.", platform = "windows", host = uri.Host.ToLowerInvariant() };
            }
            case "system_info":
                if (payload.EnumerateObject().Any())
                    throw new NotSupportedException("System-info does not accept parameters.");
                return new
                {
                    ok = true,
                    summary = "Limited Windows runtime information was collected.",
                    platform = "windows",
                    osVersion = Environment.OSVersion.VersionString,
                    architecture = RuntimeInformation.OSArchitecture.ToString(),
                    processorCount = Math.Clamp(Environment.ProcessorCount, 1, 1024)
                };
            default:
                throw new NotSupportedException("Action type is not allow-listed.");
        }
    }

    private async Task AcknowledgeAsync(
        string baseUrl, string token, string actionId, string state, object result, string? errorCode, CancellationToken cancellationToken)
    {
        var payload = JsonSerializer.Serialize(new { actionId, state, result, errorCode });
        using var request = new HttpRequestMessage(HttpMethod.Post, baseUrl.TrimEnd('/') + "/api/desktop/bridge/ack")
        {
            Content = new StringContent(payload, Encoding.UTF8, "application/json")
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        using var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        if (!response.IsSuccessStatusCode)
            throw new HttpRequestException("The action acknowledgement was not accepted by the ULTRON server.");
        await CancelBodyAsync(response);
    }

    private static async Task<Uri> ValidatePublicHttpsUriAsync(string value, CancellationToken cancellationToken)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps ||
            !string.IsNullOrEmpty(uri.UserInfo) || !string.IsNullOrEmpty(uri.Fragment) ||
            !string.IsNullOrEmpty(uri.Port.ToString()) && uri.Port != 443 && !uri.IsDefaultPort ||
            !IsPublicHost(uri.Host))
            throw new UnsafeDesktopActionException();

        if (IPAddress.TryParse(uri.Host, out var literal))
        {
            if (!IsPublicAddress(literal)) throw new UnsafeDesktopActionException();
            return uri;
        }

        using var lookupCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        lookupCts.CancelAfter(TimeSpan.FromSeconds(4));
        IPAddress[] addresses;
        try { addresses = await Dns.GetHostAddressesAsync(uri.DnsSafeHost, lookupCts.Token); }
        catch { throw new UnsafeDesktopActionException(); }
        if (addresses.Length == 0 || addresses.Any(address => !IsPublicAddress(address)))
            throw new UnsafeDesktopActionException();
        return uri;
    }

    private static bool IsPublicHost(string host)
    {
        var name = host.TrimEnd('.').ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(name) ||
            name == "localhost" || name.EndsWith(".localhost", StringComparison.Ordinal) ||
            name.EndsWith(".local", StringComparison.Ordinal) || name.EndsWith(".internal", StringComparison.Ordinal) ||
            name.EndsWith(".lan", StringComparison.Ordinal) || name.EndsWith(".home", StringComparison.Ordinal) ||
            name.EndsWith(".test", StringComparison.Ordinal) || name.EndsWith(".invalid", StringComparison.Ordinal) ||
            name.EndsWith(".example", StringComparison.Ordinal) || name == "metadata.google.internal")
            return false;
        return !IPAddress.TryParse(name, out var address) || IsPublicAddress(address);
    }

    private static bool IsPublicAddress(IPAddress address)
    {
        if (IPAddress.IsLoopback(address) || address.Equals(IPAddress.Any) || address.Equals(IPAddress.IPv6Any) ||
            address.Equals(IPAddress.IPv6None) || address.IsIPv6LinkLocal || address.IsIPv6SiteLocal ||
            address.IsIPv6Multicast)
            return false;

        if (address.IsIPv4MappedToIPv6) address = address.MapToIPv4();
        var bytes = address.GetAddressBytes();
        if (address.AddressFamily == AddressFamily.InterNetwork)
        {
            var a = bytes[0];
            var b = bytes[1];
            var c = bytes[2];
            if (a == 0 || a == 10 || a == 127 || a >= 224 ||
                (a == 100 && b >= 64 && b <= 127) ||
                (a == 169 && b == 254) ||
                (a == 172 && b >= 16 && b <= 31) ||
                (a == 192 && (b == 0 || b == 168)) ||
                (a == 192 && b == 88 && c == 99) ||
                (a == 198 && (b == 18 || b == 19)) ||
                (a == 198 && b == 51 && c == 100) ||
                (a == 203 && b == 0 && c == 113) ||
                (a == 255 && b == 255 && c == 255))
                return false;
            return true;
        }

        if (address.AddressFamily == AddressFamily.InterNetworkV6)
        {
            // Reject IPv6 unique-local (fc00::/7) and unspecified/loopback/link-local
            // ranges; an IPv4-mapped address was already normalized above.
            if ((bytes[0] & 0xFE) == 0xFC || (bytes[0] == 0xFE && (bytes[1] & 0xC0) == 0x80))
                return false;
            return true;
        }
        return false;
    }

    private static string ReadString(JsonElement element, string name, int max)
    {
        if (!element.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.String)
            throw new NotSupportedException("Required action field is missing.");
        var result = (value.GetString() ?? "").Trim();
        if (result.Length == 0 || result.Length > max)
            throw new NotSupportedException("Required action field is invalid.");
        return result;
    }

    private static async Task<string> ReadLimitedAsync(HttpContent content, int maxBytes, CancellationToken cancellationToken)
    {
        if (content.Headers.ContentLength is long declared && declared > maxBytes)
            throw new InvalidDataException("ULTRON response exceeds the allowed size.");
        await using var stream = await content.ReadAsStreamAsync(cancellationToken);
        using var buffer = new MemoryStream();
        var chunk = new byte[4096];
        while (true)
        {
            var count = await stream.ReadAsync(chunk.AsMemory(0, chunk.Length), cancellationToken);
            if (count == 0) break;
            if (buffer.Length + count > maxBytes)
                throw new InvalidDataException("ULTRON response exceeds the allowed size.");
            buffer.Write(chunk, 0, count);
        }
        return Encoding.UTF8.GetString(buffer.ToArray());
    }

    private static async Task CancelBodyAsync(HttpResponseMessage response)
    {
        try
        {
            if (response.Content is not null)
            {
                await using var stream = await response.Content.ReadAsStreamAsync();
            }
        }
        catch { /* Ignore cleanup failures on already bounded responses. */ }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _http.Dispose();
    }

    private sealed class UnsafeDesktopActionException : Exception { }
}
