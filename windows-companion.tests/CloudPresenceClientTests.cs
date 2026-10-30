using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
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
        RemoteActionAllowlistIsStrict();
        await RemoteActionPollingRequiresLocalApprovalAndDoesNotExecuteWhenDeclined();
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

    private static void RemoteActionAllowlistIsStrict()
    {
        foreach (var action in new[]
        {
            ("launch_application", "notepad"),
            ("launch_application", "explorer"),
            ("launch_application", "calculator"),
            ("open_known_folder", "desktop"),
            ("open_known_folder", "documents"),
            ("open_known_folder", "downloads")
        })
        {
            Assert(CloudPresenceClient.IsAllowlistedRemoteAction(action.Item1, action.Item2),
                $"Expected fixed remote action to be allowed: {action.Item1}/{action.Item2}");
        }

        foreach (var action in new[]
        {
            ("run_command", "powershell"),
            ("launch_application", "cmd"),
            ("launch_application", "custom.exe"),
            ("open_known_folder", "C:\\"),
            ("open_known_folder", ".."),
            ("", "notepad")
        })
        {
            Assert(!CloudPresenceClient.IsAllowlistedRemoteAction(action.Item1, action.Item2),
                $"Expected unsupported remote action to be rejected: {action.Item1}/{action.Item2}");
        }
    }

    private static async Task RemoteActionPollingRequiresLocalApprovalAndDoesNotExecuteWhenDeclined()
    {
        var store = new FakeCredentialStore();
        store.Save("ULTRON:DesktopCompanion:v1",
            $"""{"ServerOrigin":"{{Origin}}","DeviceId":"{{DeviceId}}","DeviceToken":"{{DeviceToken}}"}""");
        string? nextAuthorization = null;
        string? resultAuthorization = null;
        string? nextBody = null;
        string? resultBody = null;
        var executeCalls = 0;
        var commandId = "88888888-8888-4888-8888-888888888888";
        var httpHandler = new StubHttpHandler(async (request, cancellationToken) =>
        {
            if (request.RequestUri?.AbsolutePath == "/api/desktop-companion/commands/next")
            {
                nextAuthorization = request.Headers.Authorization?.ToString();
                nextBody = await request.Content!.ReadAsStringAsync(cancellationToken);
                var command = new
                {
                    command = new
                    {
                        id = commandId,
                        actionType = "launch_application",
                        target = "notepad",
                        expiresAt = DateTimeOffset.UtcNow.AddSeconds(45).ToString("O")
                    },
                    pollIntervalSeconds = 5
                };
                return JsonResponse(HttpStatusCode.OK, JsonSerializer.Serialize(command));
            }

            if (request.RequestUri?.AbsolutePath == "/api/desktop-companion/commands/" + commandId + "/result")
            {
                resultAuthorization = request.Headers.Authorization?.ToString();
                resultBody = await request.Content!.ReadAsStringAsync(cancellationToken);
                return JsonResponse(HttpStatusCode.OK, """{"recorded":true}""");
            }

            throw new InvalidOperationException("Unexpected remote-action request: " + request.RequestUri);
        });
        using var http = new HttpClient(httpHandler);
        using var client = new CloudPresenceClient(http, store, new FakeIdentityStore(DeviceId));
        using var cancellation = new CancellationTokenSource();
        var approvalCalls = 0;
        await client.RunRemoteActionPollingLoopAsync(
            (command, _) =>
            {
                approvalCalls++;
                Assert(command.Id == commandId, "The approval callback must receive the claimed command ID.");
                Assert(command.ActionType == "launch_application" && command.Target == "notepad",
                    "The approval callback must receive the fixed, parsed action.");
                Assert(CloudPresenceClient.DescribeCommand(command) == "open Notepad",
                    "The user-visible description must be derived from the fixed allowlist.");
                return Task.FromResult(false);
            },
            (_, _) =>
            {
                executeCalls++;
                throw new InvalidOperationException("The executor must never run after a No response.");
            },
            message =>
            {
                if (message.Contains("declined", StringComparison.OrdinalIgnoreCase))
                    cancellation.Cancel();
            },
            cancellation.Token);

        Assert(approvalCalls == 1, "Exactly one local approval prompt should be shown for the claimed request.");
        Assert(executeCalls == 0, "A declined request must never invoke the local executor.");
        Assert(nextAuthorization == "Bearer " + DeviceToken, "Command polling must use the paired device bearer token.");
        Assert(nextBody is not null && nextBody.Contains(DeviceId, StringComparison.Ordinal),
            "Command polling must be scoped to this device identity.");
        Assert(resultAuthorization == "Bearer " + DeviceToken, "Command results must use the same paired token.");
        Assert(resultBody is not null && resultBody.Contains("\"status\":\"rejected\"", StringComparison.Ordinal) &&
            resultBody.Contains("\"resultCode\":\"USER_REJECTED\"", StringComparison.Ordinal),
            "A local No response must be recorded as a rejection.");
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
