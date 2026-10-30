namespace Ultron.Companion;

public static class AssistantUrlPolicy
{
    private static readonly string[] BlockedSuffixes =
    {
        ".localhost", ".local", ".localdomain", ".internal", ".intranet",
        ".lan", ".home", ".test", ".invalid", ".example"
    };

    public static bool TryValidate(string? value, out string validated)
    {
        validated = string.Empty;
        if (string.IsNullOrWhiteSpace(value) || value.Length > 2048 ||
            !Uri.TryCreate(value.Trim(), UriKind.Absolute, out var uri))
            return false;

        var host = uri.IdnHost.TrimEnd('.').ToLowerInvariant();
        if (uri.Scheme != Uri.UriSchemeHttps ||
            uri.HostNameType != UriHostNameType.Dns ||
            string.IsNullOrWhiteSpace(host) ||
            !host.Contains('.') ||
            host == "localhost" ||
            BlockedSuffixes.Any(suffix => host.EndsWith(suffix, StringComparison.Ordinal)) ||
            !string.IsNullOrEmpty(uri.UserInfo) ||
            !string.IsNullOrEmpty(uri.Query) ||
            !string.IsNullOrEmpty(uri.Fragment) ||
            !uri.IsDefaultPort)
            return false;

        validated = uri.AbsoluteUri;
        return true;
    }
}
