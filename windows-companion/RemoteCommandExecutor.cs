using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Windows.Forms;

namespace Ultron.Companion;

internal static class RemoteCommandExecutor
{
    private const int MaxSharedFileBytes = 64 * 1024;
    private static readonly Dictionary<string, (string Executable, string ProcessName)> ApprovedApps =
        new(StringComparer.OrdinalIgnoreCase)
        {
            ["notepad"] = ("notepad.exe", "notepad"),
            ["calculator"] = ("calc.exe", "CalculatorApp"),
            ["calc"] = ("calc.exe", "CalculatorApp"),
            ["explorer"] = ("explorer.exe", "explorer"),
            ["chrome"] = ("chrome.exe", "chrome"),
            ["msedge"] = ("msedge.exe", "msedge"),
            ["edge"] = ("msedge.exe", "msedge"),
            ["code"] = ("Code.exe", "Code"),
            ["vscode"] = ("Code.exe", "Code"),
            ["spotify"] = ("Spotify.exe", "Spotify")
        };

    public static bool VerifySignature(string deviceToken, JsonElement command)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(deviceToken) ||
                !TryString(command, "signature", out var suppliedSignature) ||
                !TryString(command, "id", out var id) ||
                !TryString(command, "deviceId", out var deviceId) ||
                !TryString(command, "action", out var action) ||
                !command.TryGetProperty("payload", out var payload) ||
                !command.TryGetProperty("createdAt", out var createdAtElement) ||
                !createdAtElement.TryGetInt64(out var createdAt) ||
                !command.TryGetProperty("expiresAt", out var expiresAtElement) ||
                !expiresAtElement.TryGetInt64(out var expiresAt))
            {
                return false;
            }

            using var buffer = new MemoryStream();
            using (var writer = new Utf8JsonWriter(buffer, new JsonWriterOptions
            {
                Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
                Indented = false
            }))
            {
                // Property order matches the Node DeviceHub rawPayload object.
                writer.WriteStartObject();
                writer.WriteString("id", id);
                writer.WriteString("deviceId", deviceId);
                writer.WriteString("action", action);
                writer.WritePropertyName("payload");
                payload.WriteTo(writer);
                writer.WriteNumber("createdAt", createdAt);
                writer.WriteNumber("expiresAt", expiresAt);
                writer.WriteEndObject();
            }

            using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(deviceToken));
            var expected = hmac.ComputeHash(buffer.ToArray());
            var supplied = Convert.FromHexString(suppliedSignature);
            return supplied.Length == expected.Length &&
                   CryptographicOperations.FixedTimeEquals(expected, supplied);
        }
        catch
        {
            return false;
        }
    }

    public static object Execute(JsonElement command, NotifyIcon tray)
    {
        try
        {
            if (!command.TryGetProperty("expiresAt", out var expiresElement) ||
                !expiresElement.TryGetInt64(out var expiresAt) ||
                DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() > expiresAt)
            {
                return Failure("COMMAND_EXPIRED", "The command expired before execution.");
            }

            if (!TryString(command, "action", out var action) ||
                !command.TryGetProperty("payload", out var payload) ||
                payload.ValueKind != JsonValueKind.Object)
            {
                return Failure("INVALID_COMMAND", "The command payload is invalid.");
            }

            return action.ToLowerInvariant() switch
            {
                "launch_app" => LaunchApp(payload),
                "close_app" => CloseApp(payload),
                "lock_workstation" => LockWorkstation(),
                "set_volume" => SetVolume(payload),
                "get_system_vitals" => GetSystemVitals(),
                "media_playback" => MediaPlayback(payload),
                "notify" => Notify(payload, tray),
                "sandboxed_file_list" => ListSharedFiles(payload),
                "sandboxed_file_read" => ReadSharedFile(payload),
                "screen_capture" => Failure("SCREEN_CAPTURE_DISABLED_FOR_PRIVACY", "Remote screen capture is disabled. Enable a separate, visible local consent flow before using it."),
                "unlock_workstation" => Failure("UNLOCK_NOT_SUPPORTED", "ULTRON cannot bypass Windows sign-in, PIN, or biometric security."),
                "wake_device" => Failure("WAKE_NOT_SUPPORTED", "A running companion cannot wake a computer that is powered off or suspended."),
                _ => Failure("ACTION_NOT_SUPPORTED", "This action is not supported by the Windows companion.")
            };
        }
        catch (Exception ex)
        {
            return Failure("COMMAND_EXECUTION_FAILED", ex.GetType().Name);
        }
    }

    private static object LaunchApp(JsonElement payload)
    {
        var app = FirstString(payload, "app", "appKey", "name");
        if (!ApprovedApps.TryGetValue(app, out var target))
            return Failure("APP_NOT_ALLOWLISTED", "The requested application is not on the Windows companion allowlist.");

        var process = Process.Start(new ProcessStartInfo
        {
            FileName = target.Executable,
            UseShellExecute = true
        });
        return process is null
            ? Failure("APP_LAUNCH_FAILED", "Windows did not start the requested application.")
            : new { success = true, output = "Launched " + app };
    }

    private static object CloseApp(JsonElement payload)
    {
        var app = FirstString(payload, "app", "appKey", "name");
        if (!ApprovedApps.TryGetValue(app, out var target))
            return Failure("APP_NOT_ALLOWLISTED", "The requested application is not on the Windows companion allowlist.");

        var processes = Process.GetProcessesByName(target.ProcessName);
        var closed = 0;
        foreach (var process in processes)
        {
            using (process)
            {
                try
                {
                    if (process.CloseMainWindow() && process.WaitForExit(1500))
                        closed++;
                }
                catch { }
            }
        }
        return new { success = true, output = "Gracefully closed " + closed + " instance(s) of " + app };
    }

    private static object LockWorkstation()
    {
        return NativeMethods.LockWorkStation()
            ? new { success = true, output = "Windows workstation lock requested." }
            : Failure("LOCK_FAILED", "Windows rejected the workstation lock request.");
    }

    private static object SetVolume(JsonElement payload)
    {
        if (!TryNumber(payload, out var requested, "percent", "volume", "level"))
            return Failure("INVALID_VOLUME", "Provide a volume value from 0 to 100.");

        var percent = Math.Clamp((int)Math.Round(requested), 0, 100);
        var channel = (uint)Math.Round(percent * 65535.0 / 100.0);
        var packed = channel | (channel << 16);
        var result = NativeMethods.waveOutSetVolume(IntPtr.Zero, packed);
        return result == 0
            ? new { success = true, output = "System volume set to " + percent + "%", percent }
            : Failure("VOLUME_UPDATE_FAILED", "Windows could not update the system volume.");
    }

    private static object GetSystemVitals()
    {
        var memory = GC.GetGCMemoryInfo();
        var process = Process.GetCurrentProcess();
        return new
        {
            success = true,
            machine = Environment.MachineName,
            operatingSystem = Environment.OSVersion.VersionString,
            processorCount = Environment.ProcessorCount,
            totalAvailableMemoryBytes = memory.TotalAvailableMemoryBytes,
            processWorkingSetBytes = process.WorkingSet64,
            uptimeSeconds = (long)(DateTime.UtcNow - process.StartTime.ToUniversalTime()).TotalSeconds
        };
    }

    private static object MediaPlayback(JsonElement payload)
    {
        var control = FirstString(payload, "control", "mediaAction", "action").ToLowerInvariant();
        var key = control switch
        {
            "play" or "pause" or "play_pause" or "toggle" or "" => 0xB3,
            "next" or "next_track" => 0xB0,
            "previous" or "previous_track" => 0xB1,
            "stop" => 0xB2,
            _ => 0
        };
        if (key == 0)
            return Failure("INVALID_MEDIA_ACTION", "Use play, pause, next, previous, or stop.");
        NativeMethods.keybd_event((byte)key, 0, 0, UIntPtr.Zero);
        NativeMethods.keybd_event((byte)key, 0, 0x0002, UIntPtr.Zero);
        return new { success = true, output = "Media control sent: " + control };
    }

    private static object Notify(JsonElement payload, NotifyIcon tray)
    {
        var title = FirstString(payload, "title");
        var body = FirstString(payload, "body", "message");
        tray.BalloonTipTitle = string.IsNullOrWhiteSpace(title) ? "ULTRON" : title[..Math.Min(title.Length, 63)];
        tray.BalloonTipText = string.IsNullOrWhiteSpace(body) ? "A ULTRON notification arrived." : body[..Math.Min(body.Length, 240)];
        tray.BalloonTipIcon = ToolTipIcon.Info;
        tray.ShowBalloonTip(5000);
        return new { success = true, output = "Notification shown in the Windows tray." };
    }

    private static object ListSharedFiles(JsonElement payload)
    {
        var directory = ResolveSharedPath(FirstString(payload, "path", "directory"));
        Directory.CreateDirectory(directory);
        var entries = Directory.EnumerateFileSystemEntries(directory)
            .Take(100)
            .Select(path => new
            {
                name = Path.GetFileName(path),
                isDirectory = Directory.Exists(path),
                sizeBytes = File.Exists(path) ? new FileInfo(path).Length : (long?)null
            })
            .ToArray();
        return new { success = true, root = "Documents/ULTRON Shared", entries };
    }

    private static object ReadSharedFile(JsonElement payload)
    {
        var relativePath = FirstString(payload, "path", "file");
        var file = ResolveSharedPath(relativePath);
        var extension = Path.GetExtension(file);
        if (!new[] { ".txt", ".md", ".json", ".log", ".csv" }.Contains(extension, StringComparer.OrdinalIgnoreCase))
            return Failure("FILE_TYPE_NOT_ALLOWED", "Only text, Markdown, JSON, log, and CSV files can be read.");
        var info = new FileInfo(file);
        if (!info.Exists)
            return Failure("FILE_NOT_FOUND", "The requested file does not exist in the ULTRON Shared folder.");
        if (info.Length > MaxSharedFileBytes)
            return Failure("FILE_TOO_LARGE", "The file exceeds the 64 KB read limit.");
        return new { success = true, path = Path.GetFileName(file), content = File.ReadAllText(file), sizeBytes = info.Length };
    }

    private static string ResolveSharedPath(string relativePath)
    {
        if (Path.IsPathRooted(relativePath))
            throw new InvalidOperationException("Absolute paths are not allowed.");

        var root = Path.GetFullPath(Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
            "ULTRON Shared"));
        Directory.CreateDirectory(root);
        var full = Path.GetFullPath(Path.Combine(root, relativePath ?? ""));
        var prefix = root.EndsWith(Path.DirectorySeparatorChar) ? root : root + Path.DirectorySeparatorChar;
        if (!full.Equals(root, StringComparison.OrdinalIgnoreCase) &&
            !full.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("The requested path is outside the ULTRON Shared folder.");
        return full;
    }

    private static bool TryString(JsonElement value, string name, out string text)
    {
        text = "";
        if (!value.TryGetProperty(name, out var element) || element.ValueKind != JsonValueKind.String)
            return false;
        text = element.GetString() ?? "";
        return true;
    }

    private static string FirstString(JsonElement value, params string[] names)
    {
        foreach (var name in names)
            if (TryString(value, name, out var text))
                return text.Trim();
        return "";
    }

    private static bool TryNumber(JsonElement value, out double result, params string[] names)
    {
        foreach (var name in names)
        {
            if (value.TryGetProperty(name, out var element) && element.TryGetDouble(out result))
                return double.IsFinite(result);
        }
        result = 0;
        return false;
    }

    private static object Failure(string code, string message) =>
        new { error = code, success = false, output = message };
}
