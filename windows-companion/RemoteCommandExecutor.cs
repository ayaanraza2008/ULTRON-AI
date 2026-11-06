using System.Diagnostics;
using System.Collections.Concurrent;
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
    private static readonly object LaunchAppLock = new();
    private static readonly ConcurrentDictionary<string, Process> TrackedProcesses = new(StringComparer.Ordinal);
    private static readonly ConcurrentDictionary<string, object> CompletedTaskResults = new(StringComparer.Ordinal);
    private static readonly ConcurrentQueue<string> CompletedTaskOrder = new();
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

    public static bool VerifySignature(string deviceToken, JsonElement command, string expectedDeviceId)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(deviceToken) ||
                !TryString(command, "signature", out var suppliedSignature) ||
                !TryString(command, "id", out var id) ||
                !TryString(command, "deviceId", out var deviceId) ||
                !string.Equals(deviceId, expectedDeviceId, StringComparison.Ordinal) ||
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
                "launch_app" => LaunchApp(payload, FirstString(command, "id")),
                "close_app" => CloseApp(payload),
                "open_folder" => ListSharedFiles(payload),
                "find_file" => FindSharedFile(payload),
                "inspect_task" => InspectTrackedTasks(),
                "stop_task" => StopTrackedTask(payload),
                "get_task_output" => GetTaskOutput(payload),
                "emergency_stop" => EmergencyStop(),
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

    private static object LaunchApp(JsonElement payload, string commandId)
    {
        var app = FirstString(payload, "app", "appKey", "name");
        if (!ApprovedApps.TryGetValue(app, out var target))
            return Failure("APP_NOT_ALLOWLISTED", "The requested application is not on the Windows companion allowlist.");

        var taskId = string.IsNullOrWhiteSpace(commandId) ? Guid.NewGuid().ToString("N") : commandId;
        if (taskId.Length > 128)
            return Failure("INVALID_TASK_ID", "The command task ID is invalid.");

        // Reserve/check the idempotency key before launching. A retry must never
        // start a second process and then discard only its Process handle.
        lock (LaunchAppLock)
        {
            if (TrackedProcesses.TryGetValue(taskId, out var existing))
            {
                var alreadyExited = false;
                try { alreadyExited = existing.HasExited; } catch { alreadyExited = true; }
                if (alreadyExited && TrackedProcesses.TryRemove(taskId, out var finished))
                {
                    var previousProcessId = SafeProcessId(finished);
                    RememberTaskResult(taskId, new
                    {
                        success = true,
                        taskId,
                        status = "completed",
                        output = new { processId = previousProcessId, app },
                        completedAt = DateTimeOffset.UtcNow.ToString("O")
                    });
                    finished.Dispose();
                }

                if (CompletedTaskResults.TryGetValue(taskId, out var completedResult))
                    return completedResult;

                return new
                {
                    success = true,
                    duplicateSuppressed = true,
                    taskId,
                    status = "running",
                    processId = SafeProcessId(existing)
                };
            }

            if (CompletedTaskResults.TryGetValue(taskId, out var previousResult))
                return previousResult;

            var process = Process.Start(new ProcessStartInfo
            {
                FileName = target.Executable,
                UseShellExecute = true
            });
            if (process is null)
                return Failure("APP_LAUNCH_FAILED", "Windows did not start the requested application.");

            var processId = process.Id;
            if (!TrackedProcesses.TryAdd(taskId, process))
            {
                try { process.Dispose(); } catch { }
                return Failure("TASK_ID_CONFLICT", "The task ID was concurrently claimed; no duplicate app was launched.");
            }

            process.EnableRaisingEvents = true;
            process.Exited += (_, _) =>
            {
                lock (LaunchAppLock)
                {
                    if (TrackedProcesses.TryRemove(taskId, out var exited))
                    {
                        RememberTaskResult(taskId, new
                        {
                            success = true,
                            taskId,
                            status = "completed",
                            output = new { processId, app },
                            completedAt = DateTimeOffset.UtcNow.ToString("O")
                        });
                        exited.Dispose();
                    }
                }
            };

            if (process.HasExited && TrackedProcesses.TryRemove(taskId, out var completed))
            {
                RememberTaskResult(taskId, new
                {
                    success = true,
                    taskId,
                    status = "completed",
                    output = new { processId, app },
                    completedAt = DateTimeOffset.UtcNow.ToString("O")
                });
                completed.Dispose();
            }

            return new { success = true, output = "Launched " + app, taskId, processId };
        }
    }

    private static void RememberTaskResult(string taskId, object result)
    {
        CompletedTaskResults[taskId] = result;
        CompletedTaskOrder.Enqueue(taskId);
        while (CompletedTaskOrder.Count > 100 && CompletedTaskOrder.TryDequeue(out var oldest))
            CompletedTaskResults.TryRemove(oldest, out _);
    }

    private static object GetTaskOutput(JsonElement payload)
    {
        var taskId = FirstString(payload, "taskId", "id");
        if (string.IsNullOrWhiteSpace(taskId) || taskId.Length > 128)
            return Failure("TASK_ID_REQUIRED", "Provide the ULTRON task ID to inspect.");

        if (TrackedProcesses.TryGetValue(taskId, out var process))
        {
            var isRunning = false;
            try { isRunning = !process.HasExited; } catch { }
            if (isRunning)
            {
                return new
                {
                    success = true,
                    taskId,
                    status = "running",
                    output = new { processId = SafeProcessId(process), processName = SafeProcessName(process) }
                };
            }
        }

        return CompletedTaskResults.TryGetValue(taskId, out var completed)
            ? completed
            : Failure("TASK_NOT_FOUND", "No active or recently completed task was launched by this companion.");
    }

    private static object InspectTrackedTasks()
    {
        var tasks = TrackedProcesses.Select(pair => new
        {
            taskId = pair.Key,
            processId = SafeProcessId(pair.Value),
            processName = SafeProcessName(pair.Value)
        }).ToArray();
        return new { success = true, count = tasks.Length, tasks };
    }

    private static object StopTrackedTask(JsonElement payload)
    {
        var taskId = FirstString(payload, "taskId", "id");
        if (string.IsNullOrWhiteSpace(taskId))
            return Failure("TASK_ID_REQUIRED", "Provide the ULTRON command task ID to stop.");
        if (!TrackedProcesses.TryRemove(taskId, out var process))
            return CompletedTaskResults.TryGetValue(taskId, out var previous)
                ? previous
                : Failure("TASK_NOT_FOUND", "The requested task is not a process launched by this companion.");

        var processId = SafeProcessId(process);
        try
        {
            if (!process.HasExited)
            {
                try { process.CloseMainWindow(); } catch { }
                if (!process.WaitForExit(1500))
                    process.Kill(entireProcessTree: true);
                process.WaitForExit(1500);
            }
            var stopped = process.HasExited;
            RememberTaskResult(taskId, new
            {
                success = stopped,
                taskId,
                status = stopped ? "stopped" : "stop_failed",
                output = new { processId },
                completedAt = DateTimeOffset.UtcNow.ToString("O")
            });
            return new { success = stopped, output = "Tracked task stop requested.", taskId, stopped };
        }
        catch (Exception ex)
        {
            return Failure("TASK_STOP_FAILED", ex.GetType().Name);
        }
        finally
        {
            process.Dispose();
        }
    }

    private static object EmergencyStop()
    {
        var stopped = new List<string>();
        var failed = new List<string>();
        foreach (var pair in TrackedProcesses.ToArray())
        {
            if (!TrackedProcesses.TryRemove(pair.Key, out var process)) continue;
            var processId = SafeProcessId(process);
            try
            {
                if (!process.HasExited)
                {
                    try { process.CloseMainWindow(); } catch { }
                    if (!process.WaitForExit(1000))
                        process.Kill(entireProcessTree: true);
                    process.WaitForExit(1500);
                }
                var didStop = process.HasExited;
                RememberTaskResult(pair.Key, new
                {
                    success = didStop,
                    taskId = pair.Key,
                    status = didStop ? "stopped" : "stop_failed",
                    output = new { processId },
                    completedAt = DateTimeOffset.UtcNow.ToString("O")
                });
                if (didStop) stopped.Add(pair.Key);
                else failed.Add(pair.Key);
            }
            catch
            {
                failed.Add(pair.Key);
            }
            finally
            {
                process.Dispose();
            }
        }

        var workstationLocked = NativeMethods.LockWorkStation();
        return new
        {
            success = failed.Count == 0 && workstationLocked,
            status = failed.Count == 0 && workstationLocked ? "EMERGENCY_STOP_ENGAGED" : "EMERGENCY_STOP_PARTIAL",
            stoppedTaskIds = stopped,
            failedTaskIds = failed,
            workstationLocked
        };
    }

    private static int? SafeProcessId(Process process)
    {
        try { return process.HasExited ? null : process.Id; } catch { return null; }
    }

    private static string SafeProcessName(Process process)
    {
        try { return process.ProcessName; } catch { return "unknown"; }
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

        var percent = (int)Math.Round(Math.Clamp(requested, 0d, 100d));
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
        var directory = ResolveSharedPath(FirstString(payload, "path", "directory", "folder", "subDir"));
        Directory.CreateDirectory(directory);
        var entries = Directory.EnumerateFileSystemEntries(directory)
            .Where(path => !IsReparsePoint(path))
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

    private static object FindSharedFile(JsonElement payload)
    {
        var query = FirstString(payload, "query", "fileName", "name");
        if (string.IsNullOrWhiteSpace(query) || query.Length > 128)
            return Failure("FILE_QUERY_REQUIRED", "Provide a file name or search term of at most 128 characters.");

        var directory = ResolveSharedPath(FirstString(payload, "subDir", "folder"));
        if (!Directory.Exists(directory))
            return Failure("DIRECTORY_NOT_FOUND", "The requested folder does not exist in ULTRON Shared.");

        var matches = Directory.EnumerateFileSystemEntries(directory)
            .Where(entry => !IsReparsePoint(entry))
            .Select(Path.GetFileName)
            .Where(name => !string.IsNullOrWhiteSpace(name) && name.Contains(query, StringComparison.OrdinalIgnoreCase))
            .Take(100)
            .ToArray();
        return new { success = true, query, matches, totalMatches = matches.Length, root = "Documents/ULTRON Shared" };
    }

    private static object ReadSharedFile(JsonElement payload)
    {
        var relativePath = FirstString(payload, "path", "file");
        var file = ResolveSharedPath(relativePath);
        var extension = Path.GetExtension(file);
        if (!new[] { ".txt", ".md", ".json", ".log", ".csv" }.Contains(extension, StringComparer.OrdinalIgnoreCase))
            return Failure("FILE_TYPE_NOT_ALLOWED", "Only text, Markdown, JSON, log, and CSV files can be read.");
        if (IsReparsePoint(file))
            return Failure("FILE_LINK_NOT_ALLOWED", "Symbolic links and reparse-point files are not allowed in the ULTRON Shared folder.");
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
        var relative = Path.GetRelativePath(root, full);
        var current = root;
        foreach (var segment in relative.Split(new[] { Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar }, StringSplitOptions.RemoveEmptyEntries))
        {
            if (segment == ".") continue;
            current = Path.Combine(current, segment);
            if ((File.Exists(current) || Directory.Exists(current)) && IsReparsePoint(current))
                throw new InvalidOperationException("Symbolic links and reparse points are not allowed in the ULTRON Shared folder.");
        }
        var prefix = root.EndsWith(Path.DirectorySeparatorChar) ? root : root + Path.DirectorySeparatorChar;
        if (!full.Equals(root, StringComparison.OrdinalIgnoreCase) &&
            !full.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("The requested path is outside the ULTRON Shared folder.");
        return full;
    }

    private static bool IsReparsePoint(string path)
    {
        try { return (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0; }
        catch { return true; }
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
