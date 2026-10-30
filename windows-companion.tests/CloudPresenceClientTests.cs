using System.Net;
using System.Net.Sockets;
using System.Text;
using Ultron.Companion;

namespace Ultron.Companion.Tests;

internal sealed class FakeCredentialStore : ICompanionCredentialStore
{
    private readonly Dictionary<string, string> _values = new(StringComparer.Ordinal);
    public void Save(string target, string value) => _values[target] = value;
    public string? Read(string target) => _values.TryGetValue(target, out var value) ? value : null;
    public void Delete(string target) => _values.Remove(target);
}

internal sealed class FakeIdentityStore(string id) : ICompanionDeviceIdentityStore
{
    public string GetOrCreateDeviceId() => id;
}

internal sealed class StubHttpHandler(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> handler) : HttpMessageHandler
{
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        => handler(request, cancellationToken);
}

internal static class CloudPresenceClientTests
{
    private const string DeviceId = "22222222-2222-4222-8222-222222222222";
    private const string DeviceToken = "A123456789012345678901234567890123456789012";
    private const string PairingCode = "B1234567890123456789012345678901";
    private const string Origin = "https://ultron.example.com";

    private static void Assert(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
    }

    private static HttpResponseMessage JsonResponse(HttpStatusCode status, string json)
        => new(status) { Content = new StringContent(json, Encoding.UTF8, "application/json") };

    public static async Task RunAsync()
    {
        PublicAddressPolicyRejectsLocalAndReservedNetworks();
        await PairingUsesOneTimeCodeAndSavesOnlyValidatedDeviceCredentials();
        await PairingRejectsInvalidCodeBeforeNetworkAccess();
        await PairingDoesNotSaveUnexpectedServerIdentity();
        await RevokedHeartbeatStopsThePresenceLoop();
        await HeartbeatUsesTheSavedBearerToken();
        await RevokedOrExpiredCommandNeverExecutesAfterApproval();
        await AuthorizedCommandExecutesOnceAndRecordsItsResult();
        FixedWindowsExecutorRejectsAnythingOutsideTheAllowlist();
    }

    private static void PublicAddressPolicyRejectsLocalAndReservedNetworks()
    {
        var publicAddresses = new[]
        {
            "1.1.1.1",
            "8.8.8.8",
            "2606:4700:4700::1111",
            "2001:4860:4860::8888"
        };
        foreach (var value in publicAddresses)
            Assert(CloudPresenceClient.IsPublicGlobalAddress(IPAddress.Parse(value)),
                $"Expected a public global address to pass: {value}");

        var blockedAddresses = new[]
        {
            "0.0.0.0", "10.1.2.3", "100.64.0.1", "127.0.0.1",
            "169.254.169.254", "172.16.0.1", "192.0.2.1",
            "192.168.1.1", "198.18.0.1", "198.51.100.5",
            "203.0.113.9", "224.0.0.1", "240.0.0.1",
            "::1", "fc00::1", "fe80::1", "2001:db8::1",
            "2001::1", "2002::1", "3fff::1",
            "::ffff:127.0.0.1"
        };
        foreach (var value in blockedAddresses)
            Assert(!CloudPresenceClient.IsPublicGlobalAddress(IPAddress.Parse(value)),
                $"Expected a local, reserved or documentation address to be blocked: {value}");
    }

    private static async Task PairingUsesOneTimeCodeAndSavesOnlyValidatedDeviceCredentials()
    {
        var store = new FakeCredentialStore();
        HttpRequestMessage? captured = null;
        var capturedBody = string.Empty;
        using var http = new HttpClient(new StubHttpHandler(async (request, cancellationToken) =>
        {
            captured = request;
            capturedBody = await request.Content!.ReadAsStringAsync(cancellationToken);
            return JsonResponse(HttpStatusCode.Created,
                $$"""{"deviceId":"{{DeviceId}}","deviceName":"TEST-PC","platform":"windows","deviceToken":"{{DeviceToken}}"}""");
        }));
        using var client = new CloudPresenceClient(http, store, new FakeIdentityStore(DeviceId));

        var result = await client.PairAsync(Origin + "/", PairingCode);
        Assert(result.DeviceId == DeviceId, "Pairing must retain the stable local device ID.");
        Assert(result.ServerOrigin == Origin, "The client must store only the server origin.");
        Assert(result.DeviceName == "TEST-PC", "The server's bounded device display name should be returned.");
        Assert(captured?.Method == HttpMethod.Post, "Pairing must use POST.");
        Assert(captured?.RequestUri?.ToString() == Origin + "/api/desktop-companion/pair", "Pairing must use the fixed ULTRON endpoint.");
        Assert(capturedBody.Contains(PairingCode, StringComparison.Ordinal), "The one-time code must be sent in the request body.");
        Assert(capturedBody.Contains(DeviceId, StringComparison.Ordinal), "The stable device ID must be sent.");
        Assert(!capturedBody.Contains(DeviceToken, StringComparison.Ordinal), "The server token must never be sent back in the pairing request.");
        Assert(client.HasPairing, "A validated pairing must be saved.");
    }

    private static async Task PairingRejectsInvalidCodeBeforeNetworkAccess()
    {
        var calls = 0;
        using var http = new HttpClient(new StubHttpHandler((_, _) =>
        {
            calls++;
            return Task.FromResult(JsonResponse(HttpStatusCode.Created, "{}"));
        }));
        using var client = new CloudPresenceClient(http, new FakeCredentialStore(), new FakeIdentityStore(DeviceId));
        var rejected = false;
        try { await client.PairAsync(Origin, "bad-code"); }
        catch (ArgumentException) { rejected = true; }
        Assert(rejected, "Invalid pairing codes must be rejected.");
        Assert(calls == 0, "Invalid pairing codes must not be sent to the network.");
    }

    private static async Task PairingDoesNotSaveUnexpectedServerIdentity()
    {
        var store = new FakeCredentialStore();
        using var http = new HttpClient(new StubHttpHandler((_, _) =>
            Task.FromResult(JsonResponse(HttpStatusCode.Created,
                $$"""{"deviceId":"33333333-3333-4333-8333-333333333333","deviceName":"OTHER-PC","platform":"windows","deviceToken":"{{DeviceToken}}"}"""))));
        using var client = new CloudPresenceClient(http, store, new FakeIdentityStore(DeviceId));
        var rejected = false;
        try { await client.PairAsync(Origin, PairingCode); }
        catch (InvalidOperationException) { rejected = true; }
        Assert(rejected, "A mismatched device identity must be rejected.");
        Assert(!client.HasPairing, "An untrusted pairing response must not create stored credentials.");
    }

    private static async Task RevokedHeartbeatStopsThePresenceLoop()
    {
        var store = new FakeCredentialStore();
        store.Save("ULTRON:DesktopCompanion:v1",
            $$"""{"ServerOrigin":"{{Origin}}","DeviceId":"{{DeviceId}}","DeviceToken":"{{DeviceToken}}"}""");
        using var http = new HttpClient(new StubHttpHandler((_, _) =>
            Task.FromResult(JsonResponse(HttpStatusCode.Unauthorized, """{"error":{"code":"DEVICE_TOKEN_REVOKED_OR_UNKNOWN"}}"""))));
        using var client = new CloudPresenceClient(http, store, new FakeIdentityStore(DeviceId));
        var message = string.Empty;
        using var cts = new CancellationTokenSource();
        await client.RunHeartbeatLoopAsync(value => message = value, cts.Token);
        Assert(message.Contains("revoked", StringComparison.OrdinalIgnoreCase), "A revoked device must stop with a clear status.");
    }

    private static async Task RevokedOrExpiredCommandNeverExecutesAfterApproval()
    {
        var store = new FakeCredentialStore();
        store.Save("ULTRON:DesktopCompanion:v1",
            $"""{"ServerOrigin":"{{Origin}}","DeviceId":"{{DeviceId}}","DeviceToken":"{{DeviceToken}}"}""");
        var calls = new List<string>();
        var commandId = "55555555-5555-4555-8555-555555555555";
        using var http = new HttpClient(new StubHttpHandler((request, _) =>
        {
            var path = request.RequestUri!.AbsolutePath;
            calls.Add(path);
            if (path.EndsWith("/commands/next", StringComparison.Ordinal))
            {
                var expiry = DateTimeOffset.UtcNow.AddSeconds(45).ToString("O");
                return Task.FromResult(JsonResponse(HttpStatusCode.OK,
                    $"""{"command":{"id":"{{commandId}}","actionType":"launch_application","target":"notepad","expiresAt":"{{expiry}}"}}"""));
            }
            if (path.EndsWith("/commands/" + commandId + "/authorize", StringComparison.Ordinal))
                return Task.FromResult(JsonResponse(HttpStatusCode.Conflict, """{"error":{"code":"DESKTOP_ACTION_NO_LONGER_AUTHORIZED"}}"""));
            throw new InvalidOperationException("Unexpected request " + path);
        }));
        using var client = new CloudPresenceClient(http, store, new FakeIdentityStore(DeviceId));
        using var cts = new CancellationTokenSource();
        var executionCount = 0;
        var status = string.Empty;
        await client.RunRemoteActionPollingLoopAsync(
            (_, _) => Task.FromResult(true),
            (_, _) => { executionCount++; return Task.FromResult("started"); },
            message =>
            {
                status = message;
                if (message.Contains("Nothing was executed", StringComparison.Ordinal)) cts.Cancel();
            },
            cts.Token);
        Assert(executionCount == 0, "A stale or revoked command must never reach the local executor.");
        Assert(calls.Contains("/api/desktop-companion/commands/" + commandId + "/authorize"),
            "The client must revalidate the exact command after local approval.");
        Assert(!calls.Any(path => path.EndsWith("/result", StringComparison.Ordinal)),
            "A stale command must not report a successful local execution.");
        Assert(status.Contains("Nothing was executed", StringComparison.Ordinal),
            "The companion must report that stale commands were blocked.");
    }

    private static async Task AuthorizedCommandExecutesOnceAndRecordsItsResult()
    {
        var store = new FakeCredentialStore();
        store.Save("ULTRON:DesktopCompanion:v1",
            $"""{"ServerOrigin":"{{Origin}}","DeviceId":"{{DeviceId}}","DeviceToken":"{{DeviceToken}}"}""");
        var calls = new List<string>();
        var commandId = "66666666-6666-4666-8666-666666666666";
        using var http = new HttpClient(new StubHttpHandler((request, _) =>
        {
            var path = request.RequestUri!.AbsolutePath;
            calls.Add(path);
            if (path.EndsWith("/commands/next", StringComparison.Ordinal))
            {
                var expiry = DateTimeOffset.UtcNow.AddSeconds(45).ToString("O");
                return Task.FromResult(JsonResponse(HttpStatusCode.OK,
                    $"""{"command":{"id":"{{commandId}}","actionType":"launch_application","target":"calculator","expiresAt":"{{expiry}}"}}"""));
            }
            if (path.EndsWith("/commands/" + commandId + "/authorize", StringComparison.Ordinal))
                return Task.FromResult(JsonResponse(HttpStatusCode.OK,
                    $"""{"authorized":true,"commandId":"{{commandId}}"}"""));
            if (path.EndsWith("/commands/" + commandId + "/result", StringComparison.Ordinal))
                return Task.FromResult(JsonResponse(HttpStatusCode.OK, """{"recorded":true}"""));
            throw new InvalidOperationException("Unexpected request " + path);
        }));
        using var client = new CloudPresenceClient(http, store, new FakeIdentityStore(DeviceId));
        using var cts = new CancellationTokenSource();
        var executionCount = 0;
        var status = string.Empty;
        await client.RunRemoteActionPollingLoopAsync(
            (command, _) => Task.FromResult(command.Id == commandId),
            (command, _) =>
            {
                executionCount++;
                Assert(command.Target == "calculator", "The executor must receive the exact allowlisted target.");
                return Task.FromResult("calculator start requested");
            },
            message =>
            {
                status = message;
                if (message.Contains("action approved and started", StringComparison.Ordinal)) cts.Cancel();
            },
            cts.Token);
        Assert(executionCount == 1, "An authorized and locally approved command must execute once.");
        var authorizeIndex = calls.IndexOf("/api/desktop-companion/commands/" + commandId + "/authorize");
        var resultIndex = calls.IndexOf("/api/desktop-companion/commands/" + commandId + "/result");
        Assert(authorizeIndex >= 0 && resultIndex > authorizeIndex,
            "Authorization must be checked before the result is recorded.");
        Assert(status.Contains("action approved and started", StringComparison.Ordinal),
            "The companion must report the actual fixed action start.");
    }

    private static void FixedWindowsExecutorRejectsAnythingOutsideTheAllowlist()
    {
        var startInfo = RemoteDesktopActionExecutor.CreateStartInfo(
            new RemoteDesktopCommand("77777777-7777-4777-8777-777777777777",
                "launch_application", "calculator", DateTimeOffset.UtcNow.AddMinutes(1)));
        Assert(startInfo.FileName == "calc.exe", "Calculator must map to the fixed calc.exe application.");
        Assert(startInfo.UseShellExecute, "Fixed app launch must use shell execution without a shell command string.");
        Assert(string.IsNullOrEmpty(startInfo.Arguments), "Fixed app launch must not accept caller-provided arguments.");

        var rejected = false;
        try
        {
            RemoteDesktopActionExecutor.CreateStartInfo(
                new RemoteDesktopCommand("77777777-7777-4777-8777-777777777777",
                    "launch_application", "powershell.exe", DateTimeOffset.UtcNow.AddMinutes(1)));
        }
        catch (ArgumentException)
        {
            rejected = true;
        }
        Assert(rejected, "The Windows executor must reject shell or arbitrary executable targets.");
    }

    private static async Task HeartbeatUsesTheSavedBearerToken()
    {
        var store = new FakeCredentialStore();
        store.Save("ULTRON:DesktopCompanion:v1",
            $$"""{"ServerOrigin":"{{Origin}}","DeviceId":"{{DeviceId}}","DeviceToken":"{{DeviceToken}}"}""");
        HttpRequestMessage? captured = null;
        using var http = new HttpClient(new StubHttpHandler((request, _) =>
        {
            captured = request;
            return Task.FromResult(JsonResponse(HttpStatusCode.OK, """{"status":"online"}"""));
        }));
        using var client = new CloudPresenceClient(http, store, new FakeIdentityStore(DeviceId), TimeSpan.FromSeconds(1));
        using var cts = new CancellationTokenSource();
        var message = string.Empty;
        await client.RunHeartbeatLoopAsync(value =>
        {
            message = value;
            cts.Cancel();
        }, cts.Token);
        Assert(captured?.RequestUri?.ToString() == Origin + "/api/desktop-companion/heartbeat", "Heartbeat must use the fixed route.");
        Assert(captured?.Headers.Authorization?.Scheme == "Bearer", "Heartbeat must use bearer authentication.");
        Assert(captured?.Headers.Authorization?.Parameter == DeviceToken, "Heartbeat must use the stored device token.");
        Assert(message.Contains("ONLINE", StringComparison.Ordinal), "A successful heartbeat must update device status.");
    }
}
