using Ultron.Companion;

static void Assert(bool condition, string message)
{
    if (!condition) throw new InvalidOperationException(message);
}

var valid = new[]
{
    "https://example.com/",
    "https://example.com/ultron/",
    " https://ultron.example.net/app "
};

foreach (var input in valid)
{
    Assert(AssistantUrlPolicy.TryValidate(input, out var result),
        $"Expected a valid public HTTPS destination: {input}");
    Assert(result.StartsWith("https://", StringComparison.Ordinal),
        $"Validated URL must remain HTTPS: {input}");
}

var invalid = new[]
{
    "",
    "not a URL",
    "http://example.com/",
    "file:///C:/Windows",
    "https://localhost/",
    "https://LOCALHOST/",
    "https://127.0.0.1/",
    "https://[::1]/",
    "https://router.local/",
    "https://service.internal/",
    "https://printer.lan/",
    "https://device.test/",
    "https://host.example/",
    "https://single-label/",
    "https://user:password@example.com/",
    "https://example.com/?token=secret",
    "https://example.com/#fragment",
    "https://example.com:8443/",
    "https://example.com:443/?token=secret"
};

foreach (var input in invalid)
{
    Assert(!AssistantUrlPolicy.TryValidate(input, out _),
        $"Expected an unsafe or unsupported destination to be rejected: {input}");
}

Assert(!AssistantUrlPolicy.TryValidate("https://" + new string('a', 2050) + ".example.com/", out _),
    "Overlong URL must be rejected");

Console.WriteLine($"Windows companion URL policy: {valid.Length} valid and {invalid.Length + 1} invalid cases passed.");

await CloudPresenceClientTests.RunAsync();
Console.WriteLine("Windows companion cloud-pairing and heartbeat protocol: 6 cases passed.");
