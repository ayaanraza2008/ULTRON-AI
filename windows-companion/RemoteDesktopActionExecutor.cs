using System.Diagnostics;

namespace Ultron.Companion;

/// <summary>
/// Executes only six fixed Windows shortcuts. No user-controlled executable,
/// command line, shell text or filesystem path is accepted.
/// </summary>
public static class RemoteDesktopActionExecutor
{
    public static ProcessStartInfo CreateStartInfo(RemoteDesktopCommand command)
    {
        ArgumentNullException.ThrowIfNull(command);
        if (!CloudPresenceClient.IsAllowlistedRemoteAction(command.ActionType, command.Target))
            throw new ArgumentException("The requested Windows action is not allowlisted.", nameof(command));

        if (command.ActionType == "launch_application")
        {
            var executable = command.Target switch
            {
                "notepad" => "notepad.exe",
                "explorer" => "explorer.exe",
                "calculator" => "calc.exe",
                _ => throw new ArgumentException("The requested Windows application is not allowlisted.", nameof(command))
            };
            return new ProcessStartInfo(executable) { UseShellExecute = true };
        }

        var folder = command.Target switch
        {
            "desktop" => Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
            "documents" => Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
            "downloads" => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads"),
            _ => throw new ArgumentException("The requested Windows folder is not allowlisted.", nameof(command))
        };
        if (string.IsNullOrWhiteSpace(folder) || !Directory.Exists(folder))
            throw new DirectoryNotFoundException("The selected standard Windows folder is not available.");
        return new ProcessStartInfo(folder) { UseShellExecute = true };
    }

    public static string Execute(RemoteDesktopCommand command)
    {
        var startInfo = CreateStartInfo(command);
        using var process = Process.Start(startInfo)
            ?? throw new InvalidOperationException("Windows did not start the requested application or folder.");
        return "Windows accepted the process-start request; application readiness has not been verified.";
    }
}
