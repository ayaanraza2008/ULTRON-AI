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
    private readonly HttpClient _http = new(new SocketsHttpHandler
    {
        AllowAutoRedirect = false,
        // Avoid an unpinned system proxy path: this client carries the bridge bearer secret.
        UseProxy = false,
        ConnectTimeout = TimeSpan.FromSeconds(4),
        PooledConnectionLifetime = TimeSpan.FromMinutes(1),
        ConnectCallback = ConnectPinnedAsync
    })
    {
        Timeout = TimeSpan.FromSeconds(10)
    };
    private bool _disposed;

    private static bool IsExplicitLoopbackHost(string host)
    {
        var normalized = host.Trim().Trim('[', ']').TrimEnd('.').ToLowerInvariant();
        return normalized == "localhost" ||
            (IPAddress.TryParse(normalized, out var address) && IPAddress.IsLoopback(address));
    }

    private static bool AreAllowedResolvedAddresses(string host, IPAddress[] addresses)
    {
        if (addresses.Length == 0) return false;
        var allowLoopback = IsExplicitLoopbackHost(host);
        // Reject mixed answer sets: no private/reserved address may be available
        // for a second connection attempt after a public address fails.
        return addresses.All(address => allowLoopback
            ? IPAddress.IsLoopback(address)
            : IsPublicAddress(address));
    }

    private static async ValueTask<Stream> ConnectPinnedAsync(
        SocketsHttpConnectionContext context,
        CancellationToken cancellationToken)
    {
        var host = context.DnsEndPoint.Host.Trim().Trim('[', ']').TrimEnd('.');
        IPAddress[] addresses;
        try
        {
            addresses = IPAddress.TryParse(host, out var literal)
                ? new[] { literal }
                : await Dns.GetHostAddressesAsync(host, cancellationToken);
        }
        catch (OperationCanceledException) { throw; }
        catch
        {
            throw new HttpRequestException("Could not safely resolve the Windows bridge API host.");
        }

        if (!AreAllowedResolvedAddresses(host, addresses))
        {
            throw new HttpRequestException("The Windows bridge API host resolved to a disallowed address.");
        }

        Exception? lastError = null;
        foreach (var address in addresses)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var socket = new Socket(address.AddressFamily, SocketType.Stream, ProtocolType.Tcp)
            {
                NoDelay = true
            };
            try
            {
                // Connect directly to the address just validated. SocketsHttpHandler
                // performs TLS afterwards using the original request hostname for SNI
                // and certificate verification.
                await socket.ConnectAsync(new IPEndPoint(address, context.DnsEndPoint.Port), cancellationToken);
                return new NetworkStream(socket, ownsSocket: true);
            }
            catch (OperationCanceledException)
            {
                socket.Dispose();
                throw;
            }
            catch (Exception error)
            {
                socket.Dispose();
                lastError = error;
            }
        }

        throw new HttpRequestException("Could not connect to the validated Windows bridge API address.", lastError);
    }

    public static bool HasValidConfiguration(string baseUrl, string token)
    {
        if (string.IsNullOrWhiteSpace(token) || token.Trim().Length < 32 || token.Any(char.IsWhiteSpace))
            return false;
        if (!Uri.TryCreate(baseUrl, UriKind.Absolute, out var uri))
            return false;
        if (uri.UserInfo.Length != 0 || uri.Query.Length != 0 || uri.Fragment.Length != 0 ||
            uri.AbsolutePath != "/" || (uri.Scheme == Uri.UriSchemeHttps && uri.Port != 443))
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
                var poll = await PollOnceAsync(baseUrl.TrimEnd('/'), token, ReportOnce, cancellationToken);
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

    private async Task<(bool DidWork, string Status)> PollOnceAsync(string baseUrl, string token, Action<string> reportStatus, CancellationToken cancellationToken)
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
        if (!action.TryGetProperty("attempts", out var attemptValue) ||
            attemptValue.ValueKind != JsonValueKind.Number ||
            !attemptValue.TryGetInt32(out var attemptNumber) ||
            attemptNumber < 1 || attemptNumber > 3)
            return (false, "The desktop action queue returned an invalid claim attempt; no PC action was run.");

        reportStatus(DescribeApprovedAction(actionType, action));
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
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            result = new { ok = false, summary = "The local bridge was stopped before the approved action completed.", platform = "windows" };
            state = "failed";
            errorCode = "ACTION_FAILED";
            // Do not leave the claim running only because the local Stop toggle was used.
            await AcknowledgeAsync(baseUrl, token, id, attemptNumber, state, result, errorCode, CancellationToken.None);
            return (true, "The in-progress action was marked failed after the bridge stopped.");
        }
        catch (Exception)
        {
            result = new { ok = false, summary = "The approved action could not be completed.", platform = "windows" };
            state = "failed";
            errorCode = actionType == "launch_app" ? "APP_LAUNCH_FAILED" : "ACTION_FAILED";
        }

        await AcknowledgeAsync(baseUrl, token, id, attemptNumber, state, result, errorCode, CancellationToken.None);
        return (true, "An approved PC action was processed. Waiting for the next approved action.");
    }

    private static string DescribeApprovedAction(string actionType, JsonElement action)
    {
        try
        {
            var payload = action.TryGetProperty("payload", out var raw) && raw.ValueKind == JsonValueKind.Object ? raw : default;
            return actionType switch
            {
                "launch_app" => "Executing owner-approved PC action: launching " + ReadString(payload, "app", 30) + ".",
                "open_url" => "Executing owner-approved PC action: opening public website " +
                    new Uri(ReadString(payload, "url", 1200)).Host + " in the default browser.",
                "system_info" => "Executing owner-approved PC action: reading limited Windows system information.",
                _ => "Executing an owner-approved PC action from the restricted allowlist."
            };
        }
        catch
        {
            return "Executing an owner-approved PC action; checking the local allowlist.";
        }
    }

    private async Task<object> ExecuteAllowedActionAsync(string actionType, JsonElement action, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
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
                cancellationToken.ThrowIfCancellationRequested();
                Process.Start(new ProcessStartInfo(executable) { UseShellExecute = true });
                return new { ok = true, summary = "The approved application was launched.", platform = "windows", app };
            }
            case "open_url":
            {
                var value = ReadString(payload, "url", 1200);
                var uri = await ValidatePublicHttpsUriAsync(value, cancellationToken);
                cancellationToken.ThrowIfCancellationRequested();
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
        string baseUrl, string token, string actionId, int attempts, string state, object result, string? errorCode, CancellationToken cancellationToken)
    {
        var payload = JsonSerializer.Serialize(new { actionId, attempts, state, result, errorCode });
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
            uri.Port != 443 || !IsPublicHost(uri.Host))
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

    internal static int RunNetworkAddressPolicySelfTest()
    {
        var cases = new (string Address, bool Expected)[]
        {
            ("8.8.8.8", true),
            ("2606:4700:4700::1111", true),
            ("2001:4860:4860::8888", true),
            ("127.0.0.1", false),
            ("10.0.0.1", false),
            ("169.254.169.254", false),
            ("::1", false),
            ("fd00::1", false),
            ("fe80::1", false),
            ("::ffff:127.0.0.1", false),
            ("2001:1::1", false),
            ("2001:1ff::1", false),
            ("2001:db8::1", false),
            ("2002:7f00:1::1", false),
            ("3fff::1", false),
            ("ff02::1", false)
        };

        foreach (var item in cases)
        {
            if (!IPAddress.TryParse(item.Address, out var address) ||
                IsPublicAddress(address) != item.Expected)
                return 1;
        }

        var publicAddress = IPAddress.Parse("93.184.216.34");
        var privateAddress = IPAddress.Parse("127.0.0.1");
        if (!AreAllowedResolvedAddresses("api.example.com", new[] { publicAddress }) ||
            AreAllowedResolvedAddresses("api.example.com", new[] { publicAddress, privateAddress }) ||
            AreAllowedResolvedAddresses("localhost", new[] { privateAddress, publicAddress }) ||
            !AreAllowedResolvedAddresses("localhost", new[] { privateAddress, IPAddress.IPv6Loopback }))
            return 1;
        return 0;
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
            // Public global-unicast IPv6 only. The companion resolves a hostname and
            // rejects the entire result set if any returned address is non-public.
            // Mapped IPv4 was normalized above; now reject local/transition/documentation
            // blocks rather than trusting that a syntactically valid IPv6 literal is public.
            var first = (bytes[0] << 8) | bytes[1];
            if (first < 0x2000 || first > 0x3FFF)
                return false;
            if (first == 0x3FFF || first == 0x2002) // Documentation and 6to4 transition.
                return false;
            if (first == 0x2001)
            {
                var second = (bytes[2] << 8) | bytes[3];
                // Reject the complete 2001:0000::/23 IETF protocol-assignment block,
                // including entries beyond the individually named benchmark/ORCHID ranges.
                if (second <= 0x01FF || second == 0x0DB8)
                    return false;
            }
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
