using Microsoft.Win32;

namespace Ultron.Companion;

/// <summary>
/// Stores the selected public ULTRON origin in the current Windows user's
/// registry profile. The endpoint is configuration, not a credential.
/// </summary>
public static class AssistantUrlStore
{
    private const string SettingsPath = @"Software\ULTRON\Companion";
    private const string UrlValueName = "AssistantUrl";
    public const string DefaultAssistantUrl = "https://ultron-ai-zvd7.onrender.com/";

    public static string Resolve(out bool invalidEnvironmentOverride)
    {
        invalidEnvironmentOverride = false;
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(SettingsPath, writable: false);
            var saved = key?.GetValue(UrlValueName) as string;
            if (AssistantUrlPolicy.TryValidate(saved, out var validatedSaved))
                return validatedSaved;
        }
        catch
        {
            // Registry read failure falls back to the environment/default; do not
            // prevent opening the wake-word companion.
        }

        var configured = Environment.GetEnvironmentVariable("ULTRON_ASSISTANT_URL");
        if (string.IsNullOrWhiteSpace(configured)) return DefaultAssistantUrl;
        if (AssistantUrlPolicy.TryValidate(configured, out var validatedEnvironment))
            return validatedEnvironment;

        invalidEnvironmentOverride = true;
        return DefaultAssistantUrl;
    }

    public static bool TrySave(string? value, out string validated, out string error)
    {
        validated = string.Empty;
        error = string.Empty;
        if (!AssistantUrlPolicy.TryValidate(value, out validated))
        {
            error = "Enter only a public HTTPS origin, such as https://your-ultron-host.example. Paths, credentials, query strings, fragments, custom ports, IP literals and local-network hostnames are not accepted.";
            return false;
        }

        try
        {
            using var key = Registry.CurrentUser.CreateSubKey(SettingsPath, writable: true);
            if (key is null)
            {
                error = "Windows could not open the current-user ULTRON settings registry key.";
                return false;
            }
            key.SetValue(UrlValueName, validated, RegistryValueKind.String);
            return true;
        }
        catch (Exception exception)
        {
            error = "Could not save the ULTRON server setting: " + exception.GetType().Name;
            return false;
        }
    }
}
