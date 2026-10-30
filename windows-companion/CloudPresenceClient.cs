using System.ComponentModel;
using System.Net;
using System.Net.Sockets;
using System.Net.Http.Json;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Ultron.Companion;

public interface ICompanionCredentialStore
{
    void Save(string target, string value);
    string? Read(string target);
    void Delete(string target);
}

public interface ICompanionDeviceIdentityStore
{
    string GetOrCreateDeviceId();
}

public sealed class FileCompanionDeviceIdentityStore : ICompanionDeviceIdentityStore
{
    private readonly string _path;

    public FileCompanionDeviceIdentityStore(string? path = null)
    {
        _path = path ?? Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "ULTRON", "companion", "device-id");
    }

    public string GetOrCreateDeviceId()
    {
        var directory = Path.GetDirectoryName(_path)
            ?? throw new InvalidOperationException("The companion identity path is invalid.");
        Directory.CreateDirectory(directory);
        if (File.Exists(_path))
        {
            var existing = File.ReadAllText(_path, Encoding.ASCII).Trim();
            if (Guid.TryParse(existing, out var parsed)) return parsed.ToString("D");
            throw new InvalidOperationException("The saved device identity is invalid. Remove the local device-id file and pair again.");
        }

        var value = Guid.NewGuid().ToString("D");
        try
        {
            using var stream = new FileStream(_path, FileMode.CreateNew, FileAccess.Write, FileShare.None);
            using var writer = new StreamWriter(stream, Encoding.ASCII);
            writer.WriteLine(value);
            writer.Flush();
            stream.Flush(true);
        }
        catch (IOException) when (File.Exists(_path))
        {
            var raced = File.ReadAllText(_path, Encoding.ASCII).Trim();
            if (Guid.TryParse(raced, out var parsed)) return parsed.ToString("D");
            throw new InvalidOperationException("The saved device identity is invalid.");
        }

        return value;
    }
}

/// <summary>
/// Stores the small device credential record in the current Windows user's
/// Credential Manager. The raw bearer token is never written to a project file.
/// </summary>
public sealed class WindowsCredentialStore : ICompanionCredentialStore
{
    private const uint GenericCredential = 1;
    private const uint LocalMachinePersistence = 2;
    private const int ErrorNotFound = 1168;
    private const string CredentialTarget = "ULTRON:DesktopCompanion:v1";

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct NativeCredential
    {
        public uint Flags;
        public uint Type;
        public string TargetName;
        public string? Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist;
        public uint AttributeCount;
        public IntPtr Attributes;
        public string? TargetAlias;
        public string? UserName;
    }

    [DllImport("Advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredWrite(ref NativeCredential userCredential, uint flags);

    [DllImport("Advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredRead(string target, uint type, uint flags, out IntPtr credentialPtr);

    [DllImport("Advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredDelete(string target, uint type, uint flags);

    [DllImport("Advapi32.dll", SetLastError = false)]
    private static extern void CredFree(IntPtr buffer);

    public void Save(string target, string value)
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("Windows Credential Manager is required.");
        if (string.IsNullOrWhiteSpace(target) || target.Length > 256) throw new ArgumentException("Credential target is invalid.", nameof(target));
        var bytes = Encoding.UTF8.GetBytes(value);
        if (bytes.Length is 0 or > 512)
        {
            CryptographicOperations.ZeroMemory(bytes);
            throw new ArgumentException("Credential payload exceeds the Windows Credential Manager limit.", nameof(value));
        }

        var blob = Marshal.AllocHGlobal(bytes.Length);
        try
        {
            Marshal.Copy(bytes, 0, blob, bytes.Length);
            var credential = new NativeCredential
            {
                Flags = 0,
                Type = GenericCredential,
                TargetName = target,
                Comment = "ULTRON paired desktop companion credential",
                CredentialBlobSize = (uint)bytes.Length,
                CredentialBlob = blob,
                Persist = LocalMachinePersistence,
                AttributeCount = 0,
                Attributes = IntPtr.Zero,
                TargetAlias = null,
                UserName = Environment.UserName
            };
            if (!CredWrite(ref credential, 0))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Windows Credential Manager could not save the ULTRON device credential.");
        }
        finally
        {
            Marshal.Copy(new byte[bytes.Length], 0, blob, bytes.Length);
            Marshal.FreeHGlobal(blob);
            CryptographicOperations.ZeroMemory(bytes);
        }
    }

    public string? Read(string target)
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("Windows Credential Manager is required.");
        if (!CredRead(target, GenericCredential, 0, out var pointer))
        {
            var error = Marshal.GetLastWin32Error();
            if (error == ErrorNotFound) return null;
            throw new Win32Exception(error, "Windows Credential Manager could not read the ULTRON device credential.");
        }

        try
        {
            var credential = Marshal.PtrToStructure<NativeCredential>(pointer);
            if (credential.CredentialBlobSize is 0 or > 512 || credential.CredentialBlob == IntPtr.Zero)
                throw new InvalidOperationException("The saved ULTRON device credential is invalid.");
            var bytes = new byte[credential.CredentialBlobSize];
            try
            {
                Marshal.Copy(credential.CredentialBlob, bytes, 0, bytes.Length);
                return Encoding.UTF8.GetString(bytes);
            }
            finally
            {
                CryptographicOperations.ZeroMemory(bytes);
            }
        }
        finally
        {
            CredFree(pointer);
        }
    }

    public void Delete(string target)
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("Windows Credential Manager is required.");
        if (!CredDelete(target, GenericCredential, 0))
        {
            var error = Marshal.GetLastWin32Error();
            if (error != ErrorNotFound) throw new Win32Exception(error, "Windows Credential Manager could not remove the ULTRON device credential.");
        }
    }

    public static string DefaultTarget => CredentialTarget;
}

public sealed record CloudCompanionPairing(string DeviceId, string DeviceName, string ServerOrigin);

public sealed record RemoteDesktopCommand(string Id, string ActionType, string Target, DateTimeOffset ExpiresAt);

/// <summary>
/// Outbound-only Windows companion client. Remote requests are fixed allowlisted
/// shortcuts and are never executed until a local approval callback accepts them.
/// </summary>
public sealed class CloudPresenceClient : IDisposable
{
    private const string CredentialTarget = "ULTRON:DesktopCompanion:v1";
    private const int MaxResponseBytes = 16 * 1024;
    private static readonly Regex PairingCodePattern = new("^[A-Za-z0-9_-]{32}$", RegexOptions.Compiled | RegexOptions.CultureInvariant);
    private static readonly Regex DeviceTokenPattern = new("^[A-Za-z0-9_-]{43}$", RegexOptions.Compiled | RegexOptions.CultureInvariant);
    private readonly HttpClient _http;
    private readonly ICompanionCredentialStore _credentialStore;
    private readonly ICompanionDeviceIdentityStore _identityStore;
    private readonly bool _ownsHttp;
    private readonly TimeSpan _heartbeatInterval;

    public CloudPresenceClient(
        HttpClient? httpClient = null,
        ICompanionCredentialStore? credentialStore = null,
        ICompanionDeviceIdentityStore? identityStore = null,
        TimeSpan? heartbeatInterval = null)
    {
        _ownsHttp = httpClient is null;
        _http = httpClient ?? new HttpClient(new SocketsHttpHandler
        {
            AllowAutoRedirect = false,
            UseCookies = false,
            PooledConnectionLifetime = TimeSpan.FromMinutes(2),
            ConnectCallback = ConnectPublicPinnedAsync
        })
        {
            Timeout = TimeSpan.FromSeconds(10)
        };
        _credentialStore = credentialStore ?? new WindowsCredentialStore();
        _identityStore = identityStore ?? new FileCompanionDeviceIdentityStore();
        _heartbeatInterval = heartbeatInterval ?? TimeSpan.FromSeconds(30);
        if (_heartbeatInterval < TimeSpan.FromSeconds(1) || _heartbeatInterval > TimeSpan.FromMinutes(5))
            throw new ArgumentOutOfRangeException(nameof(heartbeatInterval));
    }

    /// <summary>
    /// Resolve DNS once for each new socket and pin the connection to one of
    /// those validated public addresses. Mixed public/private answers fail closed.
    /// TLS certificate validation remains bound to the original HTTPS hostname.
    /// </summary>
    private static async ValueTask<Stream> ConnectPublicPinnedAsync(
        SocketsHttpConnectionContext context,
        CancellationToken cancellationToken)
    {
        var addresses = await Dns.GetHostAddressesAsync(context.DnsEndPoint.Host, cancellationToken);
        if (addresses.Length == 0 || addresses.Any(address => !IsPublicGlobalAddress(address)))
            throw new HttpRequestException("The ULTRON host resolved to a private, local, reserved or non-global address. Connection blocked.");

        Exception? lastError = null;
        foreach (var address in addresses)
        {
            var socket = new Socket(address.AddressFamily, SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };
            try
            {
                await socket.ConnectAsync(new IPEndPoint(address, context.DnsEndPoint.Port), cancellationToken);
                return new NetworkStream(socket, ownsSocket: true);
            }
            catch (Exception error) when (error is SocketException or OperationCanceledException)
            {
                socket.Dispose();
                if (error is OperationCanceledException) throw;
                lastError = error;
            }
        }
        throw new HttpRequestException("Could not connect to a validated ULTRON host address.", lastError);
    }

    public static bool IsPublicGlobalAddress(IPAddress address)
    {
        ArgumentNullException.ThrowIfNull(address);
        if (address.IsIPv4MappedToIPv6) address = address.MapToIPv4();

        if (address.AddressFamily == AddressFamily.InterNetwork)
        {
            var blocked = new (byte[] Network, int Prefix)[]
            {
                (new byte[] { 0, 0, 0, 0 }, 8),
                (new byte[] { 10, 0, 0, 0 }, 8),
                (new byte[] { 100, 64, 0, 0 }, 10),
                (new byte[] { 127, 0, 0, 0 }, 8),
                (new byte[] { 169, 254, 0, 0 }, 16),
                (new byte[] { 172, 16, 0, 0 }, 12),
                (new byte[] { 192, 0, 0, 0 }, 24),
                (new byte[] { 192, 0, 2, 0 }, 24),
                (new byte[] { 192, 88, 99, 0 }, 24),
                (new byte[] { 192, 168, 0, 0 }, 16),
                (new byte[] { 198, 18, 0, 0 }, 15),
                (new byte[] { 198, 51, 100, 0 }, 24),
                (new byte[] { 203, 0, 113, 0 }, 24),
                (new byte[] { 224, 0, 0, 0 }, 4),
                (new byte[] { 240, 0, 0, 0 }, 4)
            };
            return !blocked.Any(range => InPrefix(address.GetAddressBytes(), range.Network, range.Prefix));
        }

        if (address.AddressFamily != AddressFamily.InterNetworkV6) return false;
        var bytes = address.GetAddressBytes();
        if (!InPrefix(bytes, new byte[] { 0x20, 0x00 }, 3)) return false;
        if (InPrefix(bytes, new byte[] { 0x20, 0x01, 0x0d, 0xb8 }, 32) ||
            InPrefix(bytes, new byte[] { 0x20, 0x01, 0x00, 0x00 }, 23) ||
            InPrefix(bytes, new byte[] { 0x20, 0x02 }, 16) ||
            InPrefix(bytes, new byte[] { 0x3f, 0xff, 0x00 }, 20))
            return false;
        return true;
    }

    private static bool InPrefix(byte[] address, byte[] network, int prefixLength)
    {
        // Prefix data must contain every byte that will be compared. Invalid or
        // truncated ranges fail closed instead of throwing during DNS validation.
        if (prefixLength < 0 || prefixLength > address.Length * 8 || prefixLength > network.Length * 8)
            return false;
        var fullBytes = prefixLength / 8;
        var remainingBits = prefixLength % 8;
        for (var index = 0; index < fullBytes; index++)
            if (address[index] != network[index]) return false;
        if (remainingBits == 0) return true;
        var mask = (byte)(0xff << (8 - remainingBits));
        return (address[fullBytes] & mask) == (network[fullBytes] & mask);
    }

    public bool HasPairing
    {
        get
        {
            try { return LoadCredentials() is not null; }
            catch { return false; }
        }
    }

    public async Task<CloudCompanionPairing> PairAsync(string serverUrl, string pairingCode, CancellationToken cancellationToken = default)
    {
        if (!AssistantUrlPolicy.TryValidate(serverUrl, out var validatedUrl))
            throw new ArgumentException("Set ULTRON_ASSISTANT_URL to the public HTTPS ULTRON address before pairing.", nameof(serverUrl));
        if (!PairingCodePattern.IsMatch((pairingCode ?? string.Empty).Trim()))
            throw new ArgumentException("Enter the 32-character one-time pairing code shown by ULTRON.", nameof(pairingCode));

        var uri = new Uri(validatedUrl);
        var origin = uri.GetLeftPart(UriPartial.Authority);
        var deviceId = _identityStore.GetOrCreateDeviceId();
        if (!Guid.TryParse(deviceId, out var parsedDeviceId))
            throw new InvalidOperationException("The local companion device identity is invalid.");
        deviceId = parsedDeviceId.ToString("D");
        var deviceName = (Environment.MachineName ?? "Windows PC").Trim();
        if (deviceName.Length is 0 or > 120) deviceName = "Windows PC";

        using var request = new HttpRequestMessage(HttpMethod.Post, origin + "/api/desktop-companion/pair")
        {
            Content = JsonContent.Create(new { pairingCode = pairingCode.Trim(), deviceId, deviceName })
        };
        using var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        var raw = await ReadLimitedAsync(response.Content, MaxResponseBytes, cancellationToken);
        if (!response.IsSuccessStatusCode)
            throw new InvalidOperationException($"ULTRON rejected the pairing request (HTTP {(int)response.StatusCode}). Generate a new code and try again.");

        using var document = JsonDocument.Parse(raw);
        var root = document.RootElement;
        var returnedToken = root.TryGetProperty("deviceToken", out var tokenValue) ? tokenValue.GetString() : null;
        var returnedDeviceId = root.TryGetProperty("deviceId", out var idValue) ? idValue.GetString() : null;
        var platform = root.TryGetProperty("platform", out var platformValue) ? platformValue.GetString() : null;
        var returnedName = root.TryGetProperty("deviceName", out var nameValue) ? nameValue.GetString() : null;
        if (returnedDeviceId != deviceId || platform != "windows" || returnedToken is null || !DeviceTokenPattern.IsMatch(returnedToken))
            throw new InvalidOperationException("ULTRON returned an invalid device identity. The credential was not saved.");

        var saved = new StoredCredentials(origin, deviceId, returnedToken);
        _credentialStore.Save(CredentialTarget, JsonSerializer.Serialize(saved));
        return new CloudCompanionPairing(deviceId, (returnedName ?? deviceName).Trim(), origin);
    }

    public void ForgetPairing() => _credentialStore.Delete(CredentialTarget);

    public async Task RunHeartbeatLoopAsync(Action<string> status, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(status);
        var credentials = LoadCredentials()
            ?? throw new InvalidOperationException("Pair this Windows PC with ULTRON before starting cloud presence.");

        var retrySeconds = 5;
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                using var request = new HttpRequestMessage(HttpMethod.Post, credentials.ServerOrigin + "/api/desktop-companion/heartbeat")
                {
                    Content = JsonContent.Create(new { deviceId = credentials.DeviceId })
                };
                request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", credentials.DeviceToken);
                using var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
                if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden or HttpStatusCode.Gone)
                {
                    status("ULTRON device pairing was revoked or expired. Pair this PC again.");
                    return;
                }
                if (!response.IsSuccessStatusCode)
                    throw new HttpRequestException($"Heartbeat returned HTTP {(int)response.StatusCode}.");

                var raw = await ReadLimitedAsync(response.Content, MaxResponseBytes, cancellationToken);
                using var document = JsonDocument.Parse(raw);
                if (!document.RootElement.TryGetProperty("status", out var state) || state.GetString() != "online")
                    throw new InvalidOperationException("ULTRON did not confirm this device heartbeat.");

                status("ULTRON cloud presence: ONLINE");
                retrySeconds = 5;
                await Task.Delay(_heartbeatInterval, cancellationToken);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception error)
            {
                status($"ULTRON cloud presence unavailable ({error.GetType().Name}). Retrying in {retrySeconds}s.");
                try { await Task.Delay(TimeSpan.FromSeconds(retrySeconds), cancellationToken); }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { return; }
                retrySeconds = Math.Min(60, retrySeconds * 2);
            }
        }
    }

    public async Task RunRemoteActionPollingLoopAsync(
        Func<RemoteDesktopCommand, CancellationToken, Task<bool>> approve,
        Func<RemoteDesktopCommand, CancellationToken, Task<string>> execute,
        Action<string> status,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(approve);
        ArgumentNullException.ThrowIfNull(execute);
        ArgumentNullException.ThrowIfNull(status);
        var credentials = LoadCredentials()
            ?? throw new InvalidOperationException("Pair this Windows PC with ULTRON before enabling local action approvals.");

        status("ULTRON local action approvals are enabled. Every request requires approval on this PC.");
        var retrySeconds = 5;
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                var command = await ClaimNextCommandAsync(credentials, cancellationToken);
                if (command is null)
                {
                    retrySeconds = 5;
                    await Task.Delay(TimeSpan.FromSeconds(5), cancellationToken);
                    continue;
                }

                if (command.ExpiresAt <= DateTimeOffset.UtcNow)
                {
                    status("An expired ULTRON action request was ignored.");
                    continue;
                }

                status("ULTRON is asking for approval on this PC: " + DescribeCommand(command) + ".");
                var approved = await approve(command, cancellationToken);
                if (!approved)
                {
                    await CompleteCommandAsync(credentials, command, "rejected", "USER_REJECTED", cancellationToken);
                    status("ULTRON action declined on this PC.");
                    continue;
                }

                cancellationToken.ThrowIfCancellationRequested();
                if (command.ExpiresAt <= DateTimeOffset.UtcNow ||
                    !await AuthorizeCommandAsync(credentials, command, cancellationToken))
                {
                    status("ULTRON action expired or is no longer authorized. Nothing was executed.");
                    continue;
                }

                try
                {
                    var executionMessage = await execute(command, cancellationToken);
                    await CompleteCommandAsync(credentials, command, "completed", "ACTION_COMPLETED", cancellationToken);
                    status("ULTRON action approved and started: " + executionMessage);
                }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                {
                    return;
                }
                catch (Exception error)
                {
                    try
                    {
                        await CompleteCommandAsync(credentials, command, "failed", "ACTION_FAILED", cancellationToken);
                    }
                    catch
                    {
                        // Never retry the action merely because its result could not be recorded.
                    }
                    status("Approved ULTRON action could not be started (" + error.GetType().Name + ").");
                }
                retrySeconds = 5;
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                return;
            }
            catch (PermissionException error)
            {
                status("ULTRON remote action access was revoked. Re-pair this PC to enable it again. " + error.Message);
                return;
            }
            catch (Exception error)
            {
                status("ULTRON action queue unavailable (" + error.GetType().Name + "). Retrying in " + retrySeconds + "s.");
                try { await Task.Delay(TimeSpan.FromSeconds(retrySeconds), cancellationToken); }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { return; }
                retrySeconds = Math.Min(60, retrySeconds * 2);
            }
        }
    }

    private async Task<RemoteDesktopCommand?> ClaimNextCommandAsync(
        StoredCredentials credentials,
        CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            credentials.ServerOrigin + "/api/desktop-companion/commands/next")
        {
            Content = JsonContent.Create(new { deviceId = credentials.DeviceId })
        };
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", credentials.DeviceToken);
        using var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden or HttpStatusCode.Gone)
            throw new PermissionException("The paired-device token is no longer accepted.");
        if (!response.IsSuccessStatusCode)
            throw new HttpRequestException("ULTRON returned HTTP " + (int)response.StatusCode + " while checking the action queue.");

        var raw = await ReadLimitedAsync(response.Content, MaxResponseBytes, cancellationToken);
        using var document = JsonDocument.Parse(raw);
        if (!document.RootElement.TryGetProperty("command", out var value) ||
            value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
            return null;
        if (value.ValueKind != JsonValueKind.Object ||
            !value.TryGetProperty("id", out var idValue) || idValue.ValueKind != JsonValueKind.String ||
            !value.TryGetProperty("actionType", out var actionValue) || actionValue.ValueKind != JsonValueKind.String ||
            !value.TryGetProperty("target", out var targetValue) || targetValue.ValueKind != JsonValueKind.String ||
            !value.TryGetProperty("expiresAt", out var expiryValue) || expiryValue.ValueKind != JsonValueKind.String)
            throw new InvalidOperationException("ULTRON returned an incomplete desktop action request.");

        var id = idValue.GetString() ?? string.Empty;
        var actionType = actionValue.GetString() ?? string.Empty;
        var target = targetValue.GetString() ?? string.Empty;
        var expiryText = expiryValue.GetString() ?? string.Empty;
        if (!Guid.TryParse(id, out var parsedId) ||
            !IsAllowlistedRemoteAction(actionType, target) ||
            !DateTimeOffset.TryParse(expiryText, System.Globalization.CultureInfo.InvariantCulture,
                System.Globalization.DateTimeStyles.AssumeUniversal, out var expiresAt) ||
            expiresAt <= DateTimeOffset.UtcNow ||
            expiresAt > DateTimeOffset.UtcNow.AddSeconds(90))
            throw new InvalidOperationException("ULTRON returned an invalid or expired desktop action request.");

        return new RemoteDesktopCommand(parsedId.ToString("D"), actionType, target, expiresAt);
    }

    private async Task<bool> AuthorizeCommandAsync(
        StoredCredentials credentials,
        RemoteDesktopCommand command,
        CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            credentials.ServerOrigin + "/api/desktop-companion/commands/" +
                Uri.EscapeDataString(command.Id) + "/authorize")
        {
            Content = JsonContent.Create(new { deviceId = credentials.DeviceId })
        };
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", credentials.DeviceToken);
        using var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden or HttpStatusCode.Gone)
            throw new PermissionException("The paired-device token is no longer accepted.");
        if (response.StatusCode == HttpStatusCode.Conflict)
        {
            await ReadLimitedAsync(response.Content, MaxResponseBytes, cancellationToken);
            return false;
        }
        if (!response.IsSuccessStatusCode)
            throw new HttpRequestException("ULTRON could not authorize the desktop action (HTTP " + (int)response.StatusCode + ").");

        var raw = await ReadLimitedAsync(response.Content, MaxResponseBytes, cancellationToken);
        using var document = JsonDocument.Parse(raw);
        return document.RootElement.TryGetProperty("authorized", out var authorized) &&
            authorized.ValueKind == JsonValueKind.True &&
            document.RootElement.TryGetProperty("commandId", out var commandId) &&
            commandId.ValueKind == JsonValueKind.String &&
            string.Equals(commandId.GetString(), command.Id, StringComparison.OrdinalIgnoreCase);
    }

    private async Task CompleteCommandAsync(
        StoredCredentials credentials,
        RemoteDesktopCommand command,
        string status,
        string resultCode,
        CancellationToken cancellationToken)
    {
        var allowed = (status, resultCode) switch
        {
            ("completed", "ACTION_COMPLETED") => true,
            ("rejected", "USER_REJECTED") => true,
            ("failed", "ACTION_FAILED") => true,
            _ => false
        };
        if (!allowed) throw new ArgumentException("The desktop action result is not allowlisted.");

        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            credentials.ServerOrigin + "/api/desktop-companion/commands/" +
                Uri.EscapeDataString(command.Id) + "/result")
        {
            Content = JsonContent.Create(new { deviceId = credentials.DeviceId, status, resultCode })
        };
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", credentials.DeviceToken);
        using var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden or HttpStatusCode.Gone)
            throw new PermissionException("The paired-device token is no longer accepted.");
        if (!response.IsSuccessStatusCode)
            throw new HttpRequestException("ULTRON did not accept the desktop action result (HTTP " + (int)response.StatusCode + ").");
        await ReadLimitedAsync(response.Content, MaxResponseBytes, cancellationToken);
    }

    public static bool IsAllowlistedRemoteAction(string actionType, string target)
    {
        return actionType switch
        {
            "launch_application" => target is "notepad" or "explorer" or "calculator",
            "open_known_folder" => target is "desktop" or "documents" or "downloads",
            _ => false
        };
    }

    public static string DescribeCommand(RemoteDesktopCommand command)
    {
        if (!IsAllowlistedRemoteAction(command.ActionType, command.Target))
            return "an unsupported action";
        var names = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["notepad"] = "Notepad",
            ["explorer"] = "File Explorer",
            ["calculator"] = "Calculator",
            ["desktop"] = "Desktop folder",
            ["documents"] = "Documents folder",
            ["downloads"] = "Downloads folder"
        };
        return command.ActionType == "launch_application"
            ? "open " + names[command.Target]
            : "open the " + names[command.Target];
    }

    private sealed class PermissionException(string message) : Exception(message) { }

    private StoredCredentials? LoadCredentials()
    {
        var raw = _credentialStore.Read(CredentialTarget);
        if (string.IsNullOrWhiteSpace(raw)) return null;
        StoredCredentials? credentials;
        try { credentials = JsonSerializer.Deserialize<StoredCredentials>(raw); }
        catch (JsonException) { return null; }
        if (credentials is null || !DeviceTokenPattern.IsMatch(credentials.DeviceToken ?? string.Empty) ||
            !Guid.TryParse(credentials.DeviceId, out var id) ||
            !AssistantUrlPolicy.TryValidate(credentials.ServerOrigin, out var validated) ||
            new Uri(validated).GetLeftPart(UriPartial.Authority) != credentials.ServerOrigin)
            return null;
        return credentials with { DeviceId = id.ToString("D") };
    }

    private static async Task<string> ReadLimitedAsync(HttpContent content, int maxBytes, CancellationToken cancellationToken)
    {
        if (content.Headers.ContentLength is long declared && declared > maxBytes)
            throw new InvalidOperationException("ULTRON returned an oversized companion response.");
        await using var stream = await content.ReadAsStreamAsync(cancellationToken);
        using var buffer = new MemoryStream();
        var chunk = new byte[4096];
        while (true)
        {
            var read = await stream.ReadAsync(chunk, cancellationToken);
            if (read == 0) break;
            if (buffer.Length + read > maxBytes)
                throw new InvalidOperationException("ULTRON returned an oversized companion response.");
            buffer.Write(chunk, 0, read);
        }
        return Encoding.UTF8.GetString(buffer.ToArray());
    }

    public void Dispose()
    {
        if (_ownsHttp) _http.Dispose();
    }

    private sealed record StoredCredentials(string ServerOrigin, string DeviceId, string DeviceToken);
}
