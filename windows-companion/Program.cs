using System.Diagnostics;
using Microsoft.Win32;
using System.Speech.Recognition;
using System.Speech.Synthesis;
using System.Windows.Forms;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Drawing;
using System.Drawing.Drawing2D;

namespace Ultron.Companion;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        var backgroundLaunch = args.Any(arg => arg.Equals("--background-listen", StringComparison.OrdinalIgnoreCase));
        Application.Run(new CompanionContext(backgroundLaunch));
    }
}

internal sealed class CompanionContext : ApplicationContext
{
    private const string AssistantUrl = "https://ultron-core-interface.onrender.com/";
    private const string StartupRegistryPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string StartupRegistryValue = "ULTRONWakeCompanion";
    private readonly Form _window;
    private readonly Label _status;
    private readonly NotifyIcon _tray;
    private readonly ToolStripMenuItem _startItem;
    private readonly ToolStripMenuItem _stopItem;
    private readonly Button _startButton;
    private readonly Button _stopButton;
    private readonly CheckBox _autoStartCheckBox;
    private readonly CheckBox _remoteCommandsCheckBox;
    private readonly TextBox _pairingCodeBox;
    private readonly Button _pairButton;
    private readonly System.Windows.Forms.Timer _commandPollTimer;
    private int _commandPollInProgress;
    private DateTime _lastHeartbeatUtc = DateTime.MinValue;
    private bool _suppressAutoStartChange;
    private bool _suppressRemoteCommandsChange;
    private SpeechRecognitionEngine? _recognizer;
    private SpeechRecognitionEngine? _commandRecognizer;
    private bool _commandCaptureActive;
    private bool _cancelCommandCapture;
    private bool _allowExit;
    private DateTime _lastWakeUtc = DateTime.MinValue;
    private DateTime _lastSnapUtc = DateTime.MinValue;
    private int _prevAudioLevel = 0;
    private uint _savedVolume = 0xFFFFFFFF;
    private bool _isDucked = false;
    private readonly object _wakeLock = new();
    private readonly object _voiceHistoryLock = new();
    private readonly List<(string Role, string Content)> _voiceHistory = new();
    private readonly FloatingCoreOverlayForm _floatingCore;
    private static readonly HttpClient s_httpClient = new() { Timeout = TimeSpan.FromSeconds(10) };
    private static readonly SemaphoreSlim s_sharedStateLock = new(1, 1);

    public CompanionContext(bool backgroundLaunch = false)
    {
        _window = new Form
        {
            Text = "ULTRON Wake Companion",
            Width = 540,
            Height = 370,
            StartPosition = FormStartPosition.CenterScreen,
            MinimumSize = new System.Drawing.Size(470, 340)
        };

        var layout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            RowCount = 6,
            Padding = new Padding(16)
        };
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 16));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 17));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 19));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 17));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 16));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 15));

        var title = new Label
        {
            Text = "ULTRON Wake Companion",
            Dock = DockStyle.Fill,
            TextAlign = System.Drawing.ContentAlignment.MiddleLeft,
            Font = new System.Drawing.Font(System.Drawing.FontFamily.GenericSansSerif, 14, System.Drawing.FontStyle.Bold)
        };
        _status = new Label
        {
            Text = "Wake word paused. Click Start to grant microphone consent.",
            Dock = DockStyle.Fill,
            TextAlign = System.Drawing.ContentAlignment.MiddleLeft,
            AutoEllipsis = true
        };

        _autoStartCheckBox = new CheckBox
        {
            Text = "Start with Windows and listen",
            AutoSize = true,
            Checked = IsAutoStartEnabled()
        };
        _autoStartCheckBox.CheckedChanged += (_, _) => HandleAutoStartChanged();

        _remoteCommandsCheckBox = new CheckBox
        {
            Text = "Allow allowlisted remote commands from paired devices",
            AutoSize = true,
            Checked = IsRemoteCommandsEnabled()
        };
        _remoteCommandsCheckBox.CheckedChanged += (_, _) => HandleRemoteCommandsChanged();

        var pairingPanel = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill,
            FlowDirection = FlowDirection.LeftToRight,
            WrapContents = false,
            Padding = new Padding(0, 4, 0, 0)
        };
        _pairingCodeBox = new TextBox
        {
            Width = 220,
            MaxLength = 80,
            PlaceholderText = "6-digit code or rotated device token"
        };
        _pairButton = new Button { Text = "Pair / update token", AutoSize = true };
        _pairButton.Click += async (_, _) => await PairDeviceAsync();
        pairingPanel.Controls.Add(_pairingCodeBox);
        pairingPanel.Controls.Add(_pairButton);

        var buttons = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill,
            FlowDirection = FlowDirection.LeftToRight,
            WrapContents = true
        };
        _startButton = new Button { Text = "Start wake word", AutoSize = true };
        _stopButton = new Button { Text = "Pause listening", AutoSize = true, Enabled = false };
        var openButton = new Button { Text = "Open ULTRON", AutoSize = true };
        _startButton.Click += (_, _) => StartListening();
        _stopButton.Click += (_, _) => StopListening();
        openButton.Click += (_, _) => OpenAssistant();
        buttons.Controls.Add(_startButton);
        buttons.Controls.Add(_stopButton);
        buttons.Controls.Add(openButton);

        layout.Controls.Add(title, 0, 0);
        layout.Controls.Add(_status, 0, 1);
        layout.Controls.Add(buttons, 0, 2);
        layout.Controls.Add(pairingPanel, 0, 3);
        layout.Controls.Add(_autoStartCheckBox, 0, 4);
        layout.Controls.Add(_remoteCommandsCheckBox, 0, 5);
        _window.Controls.Add(layout);

        _floatingCore = new FloatingCoreOverlayForm(this);
        _floatingCore.Show();

        _startItem = new ToolStripMenuItem("Start wake word", null, (_, _) => StartListening());
        _stopItem = new ToolStripMenuItem("Pause listening", null, (_, _) => StopListening()) { Enabled = false };
        var menu = new ContextMenuStrip();
        menu.Items.Add(_startItem);
        menu.Items.Add(_stopItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Toggle Living Energy Core", null, (_, _) => _floatingCore.ToggleVisibility());
        menu.Items.Add("Open ULTRON", null, (_, _) => OpenAssistant());
        menu.Items.Add("Show window", null, (_, _) => ShowWindow());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Exit", null, (_, _) => ExitApplication());

        _tray = new NotifyIcon
        {
            Icon = System.Drawing.SystemIcons.Application,
            Text = "ULTRON Wake Companion — paused",
            ContextMenuStrip = menu,
            Visible = true
        };
        _tray.DoubleClick += (_, _) => ShowWindow();

        _commandPollTimer = new System.Windows.Forms.Timer { Interval = 3000 };
        _commandPollTimer.Tick += async (_, _) => await PollPendingCommandsAsync();
        if (_remoteCommandsCheckBox.Checked)
        {
            if (string.IsNullOrWhiteSpace(LoadDeviceId()) || string.IsNullOrWhiteSpace(LoadDeviceToken()))
                ShowStatus("Remote commands are enabled, but this companion must be paired before it can receive tasks.");
            _commandPollTimer.Start();
        }

        _window.FormClosing += (_, e) =>
        {
            if (_allowExit) return;
            e.Cancel = true;
            _window.Hide();
        };
        _window.Resize += (_, _) =>
        {
            if (_window.WindowState == FormWindowState.Minimized) _window.Hide();
        };

        // Hidden handle creation for recognition callbacks
        _ = _window.Handle;
        var autoListenEnabled = IsAutoStartEnabled();
        if (autoListenEnabled)
        {
            if (!backgroundLaunch) _window.Show();
            StartListening(previouslyConsented: true);
        }
        else
        {
            _window.Show();
            if (backgroundLaunch)
                ShowStatus("Automatic listening is disabled. Enable it from this window to use wake word at sign-in.");
        }
    }

    public void ToggleListeningMode()
    {
        if (_recognizer is null) StartListening();
        else StopListening();
    }

    private void HandleAutoStartChanged()
    {
        if (_suppressAutoStartChange) return;
        if (_autoStartCheckBox.Checked)
        {
            StartListening();
            if (_recognizer is null)
            {
                SetAutoStartChecked(false);
                return;
            }
            try
            {
                WriteAutoStartRegistration(true);
                ShowStatus("Listening locally now; ULTRON will listen after future Windows sign-ins while this option remains enabled.");
            }
            catch
            {
                SetAutoStartChecked(false);
                ShowStatus("Listening locally now, but Windows startup registration failed. Run as your normal user and retry.");
            }
        }
        else
        {
            try
            {
                WriteAutoStartRegistration(false);
                ShowStatus(_recognizer is null
                    ? "Automatic listening at Windows sign-in is disabled."
                    : "Listening locally now; automatic listening at the next sign-in is disabled.");
            }
            catch
            {
                SetAutoStartChecked(true);
                ShowStatus("Could not update the Windows startup setting.");
            }
        }
    }

    private void HandleRemoteCommandsChanged()
    {
        if (_suppressRemoteCommandsChange) return;
        try
        {
            using var key = Registry.CurrentUser.CreateSubKey(@"Software\ULTRON\Companion", writable: true)
                ?? throw new InvalidOperationException("Could not open ULTRON companion settings.");
            key.SetValue("AllowRemoteCommands", _remoteCommandsCheckBox.Checked ? 1 : 0, RegistryValueKind.DWord);
            if (_remoteCommandsCheckBox.Checked)
            {
                if (string.IsNullOrWhiteSpace(LoadDeviceId()) || string.IsNullOrWhiteSpace(LoadDeviceToken()))
                {
                    ShowStatus("Remote commands are enabled. Pair this Windows device before it can receive tasks.");
                    return;
                }
                _commandPollTimer.Start();
                ShowStatus("Allowlisted remote commands enabled. ULTRON will show each completed task here.");
            }
            else
            {
                _commandPollTimer.Stop();
                ShowStatus("Remote command polling disabled. Voice commands to ULTRON remain available.");
            }
        }
        catch
        {
            _suppressRemoteCommandsChange = true;
            _remoteCommandsCheckBox.Checked = false;
            _suppressRemoteCommandsChange = false;
            _commandPollTimer.Stop();
            ShowStatus("Could not save the remote-command permission. Remote command polling remains disabled.");
        }
    }

    private bool IsRemoteCommandsEnabled()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(@"Software\ULTRON\Companion", writable: false);
            return key?.GetValue("AllowRemoteCommands") is int value && value == 1;
        }
        catch { return false; }
    }

    private void SetAutoStartChecked(bool value)
    {
        _suppressAutoStartChange = true;
        _autoStartCheckBox.Checked = value;
        _suppressAutoStartChange = false;
    }

    private bool IsAutoStartEnabled()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(StartupRegistryPath, writable: false);
            var value = key?.GetValue(StartupRegistryValue) as string;
            var expected = $"\"{Application.ExecutablePath}\" --background-listen";
            return string.Equals(value, expected, StringComparison.OrdinalIgnoreCase);
        }
        catch
        {
            return false;
        }
    }

    private static void WriteAutoStartRegistration(bool enabled)
    {
        using var key = Registry.CurrentUser.CreateSubKey(StartupRegistryPath, writable: true)
            ?? throw new InvalidOperationException("Could not open the current-user startup registry key.");
        if (enabled)
            key.SetValue(StartupRegistryValue, $"\"{Application.ExecutablePath}\" --background-listen", RegistryValueKind.String);
        else
            key.DeleteValue(StartupRegistryValue, throwOnMissingValue: false);
    }

    private void StartListening(bool previouslyConsented = false)
    {
        if (_recognizer is not null)
        {
            ShowStatus("Wake-word listener is already running.");
            return;
        }

        if (!previouslyConsented)
        {
            var consent = MessageBox.Show(
                _window,
                "Enable the ULTRON wake word?\n\nThe default microphone will remain active while this companion runs. It uses an installed Windows speech recognizer to listen for the exact word “Ultron” and does not upload microphone audio to the ULTRON server. Windows may display its own microphone indicator.\n\nThis does not unlock Windows or work while the PC is powered off or asleep. Automatic listening at Windows sign-in is a separate opt-in.",
                "Microphone consent",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Information);
            if (consent != DialogResult.Yes)
            {
                ShowStatus("Wake word paused. Microphone permission was not enabled.");
                return;
            }
        }

        try
        {
            var available = SpeechRecognitionEngine.InstalledRecognizers()
                .Where(item => item.Culture.TwoLetterISOLanguageName.Equals("en", StringComparison.OrdinalIgnoreCase))
                .OrderBy(item => item.Culture.Name.Equals("en-IN", StringComparison.OrdinalIgnoreCase) ? 0
                    : item.Culture.Name.Equals("en-US", StringComparison.OrdinalIgnoreCase) ? 1
                    : item.Culture.Name.Equals("en-GB", StringComparison.OrdinalIgnoreCase) ? 2 : 3)
                .ToArray();
            if (available.Length == 0)
            {
                ShowStatus("Unavailable: install an English Windows speech recognition language.");
                if (!previouslyConsented)
                {
                    MessageBox.Show(_window,
                        "No compatible installed English speech recognizer was found. ULTRON will remain paused; this app will not download a speech model automatically.",
                        "Speech recognizer unavailable", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                }
                return;
            }

            var recognizer = new SpeechRecognitionEngine(available[0]);
            var choices = new Choices("Ultron");
            var grammarBuilder = new GrammarBuilder(choices) { Culture = recognizer.RecognizerInfo.Culture };
            recognizer.LoadGrammar(new Grammar(grammarBuilder) { Name = "ULTRON wake word" });
            recognizer.SetInputToDefaultAudioDevice();
            recognizer.AudioLevelUpdated += (_, e) =>
            {
                var level = e.AudioLevel;
                // Acoustic transient snap detection: rapid energy rise from baseline
                if (level >= 65 && (level - _prevAudioLevel) >= 35)
                {
                    var now = DateTime.UtcNow;
                    if ((now - _lastSnapUtc).TotalMilliseconds > 1200)
                    {
                        _lastSnapUtc = now;
                        OnSnapDetected();
                    }
                }
                _prevAudioLevel = level;
            };
            recognizer.SpeechRecognized += (_, e) =>
            {
                if (e.Result.Confidence < 0.68) return;
                var phrase = new string((e.Result.Text ?? string.Empty).Where(char.IsLetterOrDigit).ToArray());
                if (!phrase.Equals("ultron", StringComparison.OrdinalIgnoreCase)) return;
                OnWakeWordRecognized();
            };
            recognizer.RecognizeCompleted += (_, e) =>
            {
                if (_recognizer is not null && e.Error is not null)
                    ShowStatus("Listener stopped: " + e.Error.GetType().Name);
            };

            _recognizer = recognizer;
            _recognizer.RecognizeAsync(RecognizeMode.Multiple);
            _startItem.Enabled = false;
            _stopItem.Enabled = true;
            _startButton.Enabled = false;
            _stopButton.Enabled = true;
            _floatingCore?.SetVisualState("LISTENING");
            ShowStatus("Listening locally for “Ultron”. Use the tray menu to pause or exit.");
        }
        catch (Exception)
        {
            StopListening();
            var detail = "Windows could not start the speech recognizer. Check microphone permission and install a compatible English speech-recognition language.";
            ShowStatus("Unavailable: microphone or speech recognition could not start.");
            if (!previouslyConsented)
                MessageBox.Show(_window, detail, "ULTRON wake word unavailable",
                    MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }

    private void StopListening()
    {
        if (_commandCaptureActive)
        {
            _cancelCommandCapture = true;
            try { _commandRecognizer?.RecognizeAsyncCancel(); } catch { /* Capture may already have completed. */ }
            ShowStatus("Command capture cancelled. Wake-word listening will remain paused.");
            return;
        }

        var recognizer = _recognizer;
        _recognizer = null;
        if (recognizer is not null)
        {
            try { recognizer.RecognizeAsyncCancel(); } catch { /* It may already be stopped. */ }
            try { recognizer.RecognizeAsyncStop(); } catch { /* It may already be stopped. */ }
            recognizer.Dispose();
        }
        _startItem.Enabled = true;
        _stopItem.Enabled = false;
        _startButton.Enabled = true;
        _stopButton.Enabled = false;
        _floatingCore?.SetVisualState("STANDBY");
        ShowStatus("Wake word paused. Microphone listener is off.");
    }

    private void EngageMediaDucking()
    {
        try
        {
            if (!_isDucked)
            {
                NativeMethods.waveOutGetVolume(IntPtr.Zero, out _savedVolume);
                // Attenuate volume to ~20% during voice capture/synthesis
                NativeMethods.waveOutSetVolume(IntPtr.Zero, 0x33333333);
                _isDucked = true;
            }
        }
        catch { /* Fallback */ }
    }

    private void RestoreMediaDucking()
    {
        try
        {
            if (_isDucked)
            {
                NativeMethods.waveOutSetVolume(IntPtr.Zero, _savedVolume);
                _isDucked = false;
            }
        }
        catch { /* Fallback */ }
    }

    private void OnWakeWordRecognized()
    {
        ProcessActivationTrigger("“Ultron” wake word detected.");
    }

    private void OnSnapDetected()
    {
        ProcessActivationTrigger("Acoustic finger-snap detected.");
    }

    private void ProcessActivationTrigger(string reason)
    {
        lock (_wakeLock)
        {
            var now = DateTime.UtcNow;
            if (_commandCaptureActive || (now - _lastWakeUtc).TotalSeconds < 8) return;
            _lastWakeUtc = now;
        }

        if (_window.IsDisposed || !_window.IsHandleCreated) return;
        _window.BeginInvoke((Action)(async () => await CaptureAndDispatchVoiceCommandAsync(reason)));
    }

    private void PauseWakeRecognizerForCapture()
    {
        var recognizer = _recognizer;
        _recognizer = null;
        if (recognizer is not null)
        {
            try { recognizer.RecognizeAsyncCancel(); } catch { /* It may already have stopped. */ }
            try { recognizer.RecognizeAsyncStop(); } catch { /* It may already have stopped. */ }
            recognizer.Dispose();
        }
        _startItem.Enabled = false;
        _stopItem.Enabled = true;
        _startButton.Enabled = false;
        _stopButton.Enabled = true;
    }

    private (RecognizerInfo? Recognizer, string Language) SelectCommandRecognizer()
    {
        var preference = (Environment.GetEnvironmentVariable("ULTRON_VOICE_LANGUAGE") ?? "hinglish").Trim().ToLowerInvariant();
        var installed = SpeechRecognitionEngine.InstalledRecognizers();
        if (preference is "hindi" or "hi" or "hi-in")
        {
            var hindi = installed.FirstOrDefault(item => item.Culture.Name.Equals("hi-IN", StringComparison.OrdinalIgnoreCase));
            return (hindi, "hindi");
        }

        var english = installed
            .Where(item => item.Culture.TwoLetterISOLanguageName.Equals("en", StringComparison.OrdinalIgnoreCase))
            .OrderBy(item => item.Culture.Name.Equals("en-IN", StringComparison.OrdinalIgnoreCase) ? 0
                : item.Culture.Name.Equals("en-US", StringComparison.OrdinalIgnoreCase) ? 1
                : item.Culture.Name.Equals("en-GB", StringComparison.OrdinalIgnoreCase) ? 2 : 3)
            .FirstOrDefault();

        var language = preference is "english" or "en" or "en-in" ? "en" : "hinglish";
        return (english, language);
    }

    private async Task<string?> CaptureNextCommandAsync()
    {
        var (recognizerInfo, language) = SelectCommandRecognizer();
        if (recognizerInfo is null)
        {
            ShowStatus(language == "hindi"
                ? "Hindi speech recognition is not installed. Set ULTRON_VOICE_LANGUAGE to hinglish or install a Hindi recognizer."
                : "No compatible English speech recognizer is installed. Install en-IN/en-US speech recognition.");
            return null;
        }

        using var capture = new SpeechRecognitionEngine(recognizerInfo);
        capture.LoadGrammar(new DictationGrammar());
        capture.InitialSilenceTimeout = TimeSpan.FromSeconds(8);
        capture.BabbleTimeout = TimeSpan.FromSeconds(8);
        capture.EndSilenceTimeout = TimeSpan.FromSeconds(1);
        capture.EndSilenceTimeoutAmbiguous = TimeSpan.FromSeconds(1.5);
        capture.SetInputToDefaultAudioDevice();

        var completion = new TaskCompletionSource<string?>(TaskCreationOptions.RunContinuationsAsynchronously);
        capture.SpeechRecognized += (_, eventArgs) =>
        {
            var text = (eventArgs.Result.Text ?? string.Empty).Trim();
            if (eventArgs.Result.Confidence >= 0.55 && text.Length > 1)
                completion.TrySetResult(text);
        };
        capture.RecognizeCompleted += (_, eventArgs) =>
        {
            if (eventArgs.Error is not null || eventArgs.Cancelled)
                completion.TrySetResult(null);
            else
                completion.TrySetResult(null);
        };

        _commandRecognizer = capture;
        System.Media.SystemSounds.Beep.Play();
        ShowStatus(language == "hindi" ? "Ab apna command boliye..." : "Speak your command now...");
        _floatingCore?.SetVisualState("LISTENING");
        capture.RecognizeAsync(RecognizeMode.Single);

        var completed = await Task.WhenAny(completion.Task, Task.Delay(TimeSpan.FromSeconds(12)));
        if (completed != completion.Task)
        {
            try { capture.RecognizeAsyncCancel(); } catch { /* Capture timed out. */ }
            return null;
        }
        return await completion.Task;
    }

    private async Task CaptureAndDispatchVoiceCommandAsync(string reason)
    {
        if (_commandCaptureActive || _allowExit || _window.IsDisposed) return;
        _commandCaptureActive = true;
        _cancelCommandCapture = false;
        var shouldResumeWakeWord = true;

        try
        {
            PauseWakeRecognizerForCapture();
            _floatingCore?.SetVisualState("LISTENING");
            ShowStatus($"{reason} ULTRON is ready. Speak your command.");
            EngageMediaDucking();
            try
            {
                _tray.BalloonTipTitle = "ULTRON activated";
                _tray.BalloonTipText = "Speak your command. Press Pause listening to cancel.";
                _tray.BalloonTipIcon = ToolTipIcon.Info;
                _tray.ShowBalloonTip(2500);
            }
            catch { /* Toast notifications can be disabled by Windows. */ }

            var commandText = await CaptureNextCommandAsync();
            if (_cancelCommandCapture) { shouldResumeWakeWord = false; return; }
            if (string.IsNullOrWhiteSpace(commandText))
            {
                ShowStatus("No clear command was recognised. Nothing was sent to ULTRON.");
                return;
            }

            var language = SelectCommandRecognizer().Language;
            await DispatchVoiceCommandAsync(commandText, language);
        }
        catch (Exception ex)
        {
            ShowStatus("Voice capture unavailable: " + ex.GetType().Name);
        }
        finally
        {
            _commandRecognizer = null;
            _commandCaptureActive = false;
            RestoreMediaDucking();
            _floatingCore?.SetVisualState("STANDBY");
            if (shouldResumeWakeWord && !_allowExit)
                StartListening(previouslyConsented: true);
            else
            {
                _startItem.Enabled = true;
                _stopItem.Enabled = false;
                _startButton.Enabled = true;
                _stopButton.Enabled = false;
                ShowStatus("Wake word paused. Microphone listener is off.");
            }
        }
    }

    private async Task PairDeviceAsync()
    {
        if (_pairButton.Enabled == false) return;
        var entered = _pairingCodeBox.Text.Trim();
        if (Regex.IsMatch(entered, @"^ultron_dev_[a-f0-9]{64}$", RegexOptions.IgnoreCase))
        {
            try
            {
                var existingDeviceId = LoadDeviceId();
                if (string.IsNullOrWhiteSpace(existingDeviceId))
                    existingDeviceId = await ResolveDeviceIdAsync(entered);

                if (!string.IsNullOrWhiteSpace(existingDeviceId))
                {
                    SaveDeviceIdentity(existingDeviceId, entered);
                    if (_remoteCommandsCheckBox.Checked) _commandPollTimer.Start();
                    ShowStatus("Updated the paired device identity securely in this Windows user's profile.");
                }
                else
                {
                    SaveDeviceToken(entered);
                    _commandPollTimer.Stop();
                    ShowStatus("Token protected with Windows DPAPI. Pair this device with a six-digit code to enable remote-task routing.");
                }
                _pairingCodeBox.Clear();
            }
            catch
            {
                ShowStatus("Could not protect the new device token with Windows user encryption.");
            }
            return;
        }

        if (!Regex.IsMatch(entered, @"^\d{6}$"))
        {
            ShowStatus("Enter the six-digit code shown by ULTRON, or paste a newly rotated device token.");
            return;
        }

        _pairButton.Enabled = false;
        _pairButton.Text = "Pairing…";
        try
        {
            var backendUrl = Environment.GetEnvironmentVariable("ULTRON_BACKEND_URL");
            if (string.IsNullOrWhiteSpace(backendUrl))
                backendUrl = "https://ultron-ai-core.onrender.com";

            if (!Uri.TryCreate(backendUrl.TrimEnd('/'), UriKind.Absolute, out var backendUri) ||
                !string.IsNullOrEmpty(backendUri.UserInfo) ||
                !string.IsNullOrEmpty(backendUri.Query) ||
                !string.IsNullOrEmpty(backendUri.Fragment) ||
                !(backendUri.Scheme == Uri.UriSchemeHttps ||
                  (backendUri.Scheme == Uri.UriSchemeHttp && backendUri.IsLoopback)))
            {
                ShowStatus("ULTRON backend URL rejected. Use HTTPS (HTTP is allowed only for localhost development).");
                return;
            }

            var requestUrl = new Uri(backendUri, "/api/devices/pairings/claim");
            var payload = System.Text.Json.JsonSerializer.Serialize(new { code = entered });
            using var request = new HttpRequestMessage(HttpMethod.Post, requestUrl)
            {
                Content = new StringContent(payload, Encoding.UTF8, "application/json")
            };
            using var response = await s_httpClient.SendAsync(request);
            var responseJson = await ReadBoundedContentAsync(response.Content, 256 * 1024);
            if (responseJson is null)
            {
                ShowStatus("Pairing response was too large to read safely.");
                return;
            }
            using var doc = System.Text.Json.JsonDocument.Parse(string.IsNullOrWhiteSpace(responseJson) ? "{}" : responseJson);
            if (!response.IsSuccessStatusCode)
            {
                var errorMessage = doc.RootElement.TryGetProperty("error", out var errorNode) &&
                    errorNode.TryGetProperty("message", out var messageNode)
                    ? messageNode.GetString()
                    : null;
                ShowStatus(string.IsNullOrWhiteSpace(errorMessage)
                    ? $"Pairing failed (HTTP {(int)response.StatusCode}). Check the code and backend."
                    : errorMessage);
                return;
            }

            var token = doc.RootElement.TryGetProperty("deviceToken", out var tokenNode) ? tokenNode.GetString() : null;
            var deviceId = doc.RootElement.TryGetProperty("deviceId", out var idNode) ? idNode.GetString() : null;
            var deviceName = doc.RootElement.TryGetProperty("deviceName", out var nameNode) ? nameNode.GetString() : null;
            if (string.IsNullOrWhiteSpace(token) ||
                !Regex.IsMatch(token, @"^ultron_dev_[a-f0-9]{64}$", RegexOptions.IgnoreCase) ||
                string.IsNullOrWhiteSpace(deviceId) ||
                !Regex.IsMatch(deviceId, @"^[A-Za-z0-9-]{1,128}$"))
            {
                ShowStatus("ULTRON returned an invalid device identity. Pairing was not saved.");
                return;
            }

            SaveDeviceIdentity(deviceId, token);
            if (_remoteCommandsCheckBox.Checked) _commandPollTimer.Start();
            _pairingCodeBox.Clear();
            ShowStatus("Paired securely" + (string.IsNullOrWhiteSpace(deviceName) ? "." : " as " + deviceName + ".") + " Token protected with Windows DPAPI.");
        }
        catch (TaskCanceledException)
        {
            ShowStatus("Device pairing timed out. Request a new code if the current one expired.");
        }
        catch
        {
            ShowStatus("Device pairing failed. Check the backend connection and try again.");
        }
        finally
        {
            _pairButton.Enabled = true;
            _pairButton.Text = "Pair / update token";
        }
    }

    private async Task<string?> ResolveDeviceIdAsync(string token)
    {
        try
        {
            var backendUrl = Environment.GetEnvironmentVariable("ULTRON_BACKEND_URL");
            if (string.IsNullOrWhiteSpace(backendUrl))
                backendUrl = "https://ultron-ai-core.onrender.com";
            if (!Uri.TryCreate(backendUrl.TrimEnd('/'), UriKind.Absolute, out var backendUri) ||
                !string.IsNullOrEmpty(backendUri.UserInfo) ||
                !string.IsNullOrEmpty(backendUri.Query) ||
                !string.IsNullOrEmpty(backendUri.Fragment) ||
                !(backendUri.Scheme == Uri.UriSchemeHttps ||
                  (backendUri.Scheme == Uri.UriSchemeHttp && backendUri.IsLoopback)))
                return null;

            using var request = new HttpRequestMessage(HttpMethod.Get, new Uri(backendUri, "/api/devices/me"));
            request.Headers.Add("x-device-token", token);
            using var response = await s_httpClient.SendAsync(request);
            if (!response.IsSuccessStatusCode) return null;
            var raw = await ReadBoundedContentAsync(response.Content, 256 * 1024);
            if (raw is null) return null;
            using var doc = System.Text.Json.JsonDocument.Parse(string.IsNullOrWhiteSpace(raw) ? "{}" : raw);
            var deviceId = doc.RootElement.TryGetProperty("deviceId", out var node) ? node.GetString() : null;
            return !string.IsNullOrWhiteSpace(deviceId) &&
                Regex.IsMatch(deviceId, @"^[A-Za-z0-9-]{1,128}$")
                ? deviceId
                : null;
        }
        catch { return null; }
    }

    private static string DeviceTokenPath()
    {
        var root = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        return Path.Combine(root, "ULTRON", "device-token.bin");
    }

    private static string DeviceIdentityPath()
    {
        var root = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        return Path.Combine(root, "ULTRON", "device-identity.bin");
    }

    private static void SaveDeviceIdentity(string deviceId, string token)
    {
        if (!Regex.IsMatch(deviceId ?? "", @"^[A-Za-z0-9-]{1,128}$") ||
            !Regex.IsMatch(token ?? "", @"^ultron_dev_[a-f0-9]{64}$", RegexOptions.IgnoreCase))
            throw new ArgumentException("Invalid ULTRON device identity.");

        var identity = System.Text.Json.JsonSerializer.Serialize(new { deviceId, deviceToken = token });
        var entropy = Encoding.UTF8.GetBytes("ULTRON.WindowsCompanion.DeviceIdentity.v1");
        var clear = Encoding.UTF8.GetBytes(identity);
        var protectedBytes = ProtectedData.Protect(clear, entropy, DataProtectionScope.CurrentUser);
        var path = DeviceIdentityPath();
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var temporaryPath = path + ".tmp";
        try
        {
            File.WriteAllBytes(temporaryPath, protectedBytes);
            File.Move(temporaryPath, path, overwrite: true);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(clear);
            try { if (File.Exists(temporaryPath)) File.Delete(temporaryPath); } catch { }
        }
        Environment.SetEnvironmentVariable("ULTRON_DEVICE_ID", deviceId);
        Environment.SetEnvironmentVariable("ULTRON_DEVICE_TOKEN", token);
    }

    private static (string? DeviceId, string? Token) LoadDeviceIdentity()
    {
        try
        {
            var fromEnvironmentId = Environment.GetEnvironmentVariable("ULTRON_DEVICE_ID");
            var fromEnvironmentToken = Environment.GetEnvironmentVariable("ULTRON_DEVICE_TOKEN");
            if (!string.IsNullOrWhiteSpace(fromEnvironmentId) &&
                Regex.IsMatch(fromEnvironmentId, @"^[A-Za-z0-9-]{1,128}$") &&
                !string.IsNullOrWhiteSpace(fromEnvironmentToken) &&
                Regex.IsMatch(fromEnvironmentToken, @"^ultron_dev_[a-f0-9]{64}$", RegexOptions.IgnoreCase))
                return (fromEnvironmentId, fromEnvironmentToken);

            var path = DeviceIdentityPath();
            if (!File.Exists(path)) return (null, null);
            var protectedBytes = File.ReadAllBytes(path);
            var entropy = Encoding.UTF8.GetBytes("ULTRON.WindowsCompanion.DeviceIdentity.v1");
            var clear = ProtectedData.Unprotect(protectedBytes, entropy, DataProtectionScope.CurrentUser);
            try
            {
                using var doc = System.Text.Json.JsonDocument.Parse(clear);
                var root = doc.RootElement;
                var id = root.TryGetProperty("deviceId", out var idNode) ? idNode.GetString() : null;
                var token = root.TryGetProperty("deviceToken", out var tokenNode) ? tokenNode.GetString() : null;
                if (string.IsNullOrWhiteSpace(id) || !Regex.IsMatch(id, @"^[A-Za-z0-9-]{1,128}$") ||
                    string.IsNullOrWhiteSpace(token) || !Regex.IsMatch(token, @"^ultron_dev_[a-f0-9]{64}$", RegexOptions.IgnoreCase))
                    return (null, null);
                return (id, token);
            }
            finally { CryptographicOperations.ZeroMemory(clear); }
        }
        catch { return (null, null); }
    }

    private static string? LoadDeviceId() => LoadDeviceIdentity().DeviceId;

    private static void SaveDeviceToken(string token)
    {
        var entropy = Encoding.UTF8.GetBytes("ULTRON.WindowsCompanion.DeviceToken.v1");
        var clear = Encoding.UTF8.GetBytes(token);
        var protectedBytes = ProtectedData.Protect(clear, entropy, DataProtectionScope.CurrentUser);
        var path = DeviceTokenPath();
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var temporaryPath = path + ".tmp";
        File.WriteAllBytes(temporaryPath, protectedBytes);
        File.Move(temporaryPath, path, overwrite: true);
        CryptographicOperations.ZeroMemory(clear);
        Environment.SetEnvironmentVariable("ULTRON_DEVICE_TOKEN", token);
    }

    private static string? LoadDeviceToken()
    {
        var identity = LoadDeviceIdentity();
        if (!string.IsNullOrWhiteSpace(identity.Token)) return identity.Token;
        var fromEnvironment = Environment.GetEnvironmentVariable("ULTRON_DEVICE_TOKEN");
        if (!string.IsNullOrWhiteSpace(fromEnvironment)) return fromEnvironment;
        try
        {
            var path = DeviceTokenPath();
            if (!File.Exists(path)) return null;
            var protectedBytes = File.ReadAllBytes(path);
            var entropy = Encoding.UTF8.GetBytes("ULTRON.WindowsCompanion.DeviceToken.v1");
            var clear = ProtectedData.Unprotect(protectedBytes, entropy, DataProtectionScope.CurrentUser);
            try { return Encoding.UTF8.GetString(clear); }
            finally { CryptographicOperations.ZeroMemory(clear); }
        }
        catch { return null; }
    }

    private async Task DispatchVoiceCommandAsync(string commandText, string language)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(commandText) || commandText.Length > 4000)
            {
                ShowStatus("Command is empty or exceeds the 4,000-character safety limit.");
                return;
            }

            var backendUrl = Environment.GetEnvironmentVariable("ULTRON_BACKEND_URL");
            if (string.IsNullOrWhiteSpace(backendUrl))
                backendUrl = "https://ultron-ai-core.onrender.com";

            if (!Uri.TryCreate(backendUrl.TrimEnd('/'), UriKind.Absolute, out var backendUri) ||
                !string.IsNullOrEmpty(backendUri.UserInfo) ||
                !string.IsNullOrEmpty(backendUri.Query) ||
                !string.IsNullOrEmpty(backendUri.Fragment) ||
                !(backendUri.Scheme == Uri.UriSchemeHttps ||
                  (backendUri.Scheme == Uri.UriSchemeHttp && backendUri.IsLoopback)))
            {
                ShowStatus("ULTRON backend URL rejected. Use HTTPS (HTTP is allowed only for localhost development).");
                return;
            }

            var deviceToken = LoadDeviceToken();
            if (string.IsNullOrWhiteSpace(deviceToken))
                deviceToken = Environment.GetEnvironmentVariable("ULTRON_DESKTOP_AGENT_TOKEN");
            if (string.IsNullOrWhiteSpace(deviceToken))
            {
                ShowStatus("Pair this Windows companion with ULTRON first. A valid device token is required.");
                return;
            }

            var requestUrl = new Uri(backendUri, "/api/jarvis/voice/process-command");
            var messages = BuildVoiceHistoryPayload(commandText);
            var payload = System.Text.Json.JsonSerializer.Serialize(new
            {
                command = commandText,
                language,
                source = "windows-companion",
                messages
            });

            using var request = new HttpRequestMessage(HttpMethod.Post, requestUrl)
            {
                Content = new StringContent(payload, System.Text.Encoding.UTF8, "application/json")
            };
            request.Headers.Add("x-device-token", deviceToken);

            using var response = await s_httpClient.SendAsync(request);
            if (!response.IsSuccessStatusCode)
            {
                ShowStatus(response.StatusCode == System.Net.HttpStatusCode.Unauthorized
                    ? "Device authentication failed. Re-pair this Windows companion."
                    : $"ULTRON backend request failed (HTTP {(int)response.StatusCode}).");
                return;
            }

            var responseJson = await ReadBoundedContentAsync(response.Content, 256 * 1024);
            if (responseJson is null)
            {
                ShowStatus("ULTRON response was too large to read safely.");
                return;
            }
            using var doc = System.Text.Json.JsonDocument.Parse(responseJson);
            var textResponse = doc.RootElement.TryGetProperty("textResponse", out var prop)
                ? prop.GetString()?.Trim() : null;
            if (string.IsNullOrWhiteSpace(textResponse))
            {
                ShowStatus("ULTRON returned no spoken response.");
                return;
            }
            if (textResponse.Length > 2000) textResponse = textResponse[..2000];

            lock (_voiceHistoryLock)
            {
                _voiceHistory.Add(("user", commandText));
                _voiceHistory.Add(("assistant", textResponse));
                if (_voiceHistory.Count > 24)
                    _voiceHistory.RemoveRange(0, _voiceHistory.Count - 24);
            }

            _floatingCore?.SetVisualState("SPEAKING");
            ShowStatus($"ULTRON: {textResponse}");
            try
            {
                using var synth = new SpeechSynthesizer();
                var spoken = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
                synth.SpeakCompleted += (_, eventArgs) =>
                {
                    if (eventArgs.Error is not null) spoken.TrySetException(eventArgs.Error);
                    else if (eventArgs.Cancelled) spoken.TrySetCanceled();
                    else spoken.TrySetResult(true);
                };
                synth.SpeakAsync(textResponse);
                await spoken.Task.WaitAsync(TimeSpan.FromSeconds(30));
            }
            catch
            {
                ShowStatus($"ULTRON: {textResponse} (spoken output unavailable)");
            }
        }
        catch (TaskCanceledException)
        {
            ShowStatus("ULTRON request timed out. Your command was not confirmed.");
        }
        catch
        {
            ShowStatus("ULTRON voice dispatch failed. Check network, pairing and backend availability.");
        }
        finally
        {
            RestoreMediaDucking();
            _floatingCore?.SetVisualState("STANDBY");
        }
    }

    private async Task PollPendingCommandsAsync()
    {
        if (_allowExit || !_remoteCommandsCheckBox.Checked || Interlocked.Exchange(ref _commandPollInProgress, 1) != 0) return;
        try
        {
            var identity = LoadDeviceIdentity();
            if (string.IsNullOrWhiteSpace(identity.DeviceId) || string.IsNullOrWhiteSpace(identity.Token))
                return;

            var backendUrl = Environment.GetEnvironmentVariable("ULTRON_BACKEND_URL");
            if (string.IsNullOrWhiteSpace(backendUrl))
                backendUrl = "https://ultron-ai-core.onrender.com";

            if (!Uri.TryCreate(backendUrl.TrimEnd('/'), UriKind.Absolute, out var backendUri) ||
                !string.IsNullOrEmpty(backendUri.UserInfo) ||
                !string.IsNullOrEmpty(backendUri.Query) ||
                !string.IsNullOrEmpty(backendUri.Fragment) ||
                !(backendUri.Scheme == Uri.UriSchemeHttps ||
                  (backendUri.Scheme == Uri.UriSchemeHttp && backendUri.IsLoopback)))
                return;

            // The paired-device API considers a Windows companion online only
            // after it sends a real authenticated heartbeat. Do this at a
            // bounded cadence rather than writing presence on every 3-second poll.
            if (DateTime.UtcNow - _lastHeartbeatUtc >= TimeSpan.FromSeconds(25))
            {
                using var heartbeat = new HttpRequestMessage(
                    HttpMethod.Post,
                    new Uri(backendUri, "/api/devices/me/heartbeat"))
                {
                    Content = new StringContent("{}", Encoding.UTF8, "application/json")
                };
                heartbeat.Headers.Add("x-device-token", identity.Token);
                using var heartbeatResponse = await s_httpClient.SendAsync(heartbeat);
                if (heartbeatResponse.StatusCode == System.Net.HttpStatusCode.Unauthorized)
                {
                    ShowStatus("Windows companion authentication expired. Re-pair this device to resume remote commands.");
                    return;
                }
                if (!heartbeatResponse.IsSuccessStatusCode) return;
                _lastHeartbeatUtc = DateTime.UtcNow;
            }

            var route = $"/api/jarvis/devices/{Uri.EscapeDataString(identity.DeviceId)}/commands/pending";
            using var request = new HttpRequestMessage(HttpMethod.Get, new Uri(backendUri, route));
            request.Headers.Add("x-device-token", identity.Token);
            using var response = await s_httpClient.SendAsync(request);
            if (response.StatusCode == System.Net.HttpStatusCode.Unauthorized)
            {
                ShowStatus("Windows companion authentication expired. Re-pair this device to resume remote commands.");
                return;
            }
            if (!response.IsSuccessStatusCode) return;

            var json = await ReadBoundedContentAsync(response.Content, 512 * 1024);
            if (json is null) return;
            using var doc = System.Text.Json.JsonDocument.Parse(string.IsNullOrWhiteSpace(json) ? "{}" : json);
            if (!doc.RootElement.TryGetProperty("commands", out var commands) ||
                commands.ValueKind != System.Text.Json.JsonValueKind.Array)
                return;

            foreach (var command in commands.EnumerateArray())
            {
                if (_allowExit) break;
                var commandId = command.TryGetProperty("id", out var idNode) ? idNode.GetString() : null;
                if (string.IsNullOrWhiteSpace(commandId) ||
                    !Regex.IsMatch(commandId, @"^[A-Za-z0-9-]{1,128}$"))
                    continue;

                object result;
                if (!RemoteCommandExecutor.VerifySignature(identity.Token, command, identity.DeviceId))
                {
                    result = new { success = false, error = "COMMAND_SIGNATURE_INVALID", output = "The command signature could not be verified. No action was executed." };
                }
                else
                {
                    result = RemoteCommandExecutor.Execute(command, _tray);
                }

                var completionPath = $"/api/jarvis/devices/{Uri.EscapeDataString(identity.DeviceId)}/commands/{Uri.EscapeDataString(commandId)}/complete";
                using var completion = new HttpRequestMessage(HttpMethod.Post, new Uri(backendUri, completionPath))
                {
                    Content = new StringContent(
                        System.Text.Json.JsonSerializer.Serialize(result),
                        Encoding.UTF8,
                        "application/json")
                };
                completion.Headers.Add("x-device-token", identity.Token);
                using var completionResponse = await s_httpClient.SendAsync(completion);
                if (!completionResponse.IsSuccessStatusCode)
                {
                    ShowStatus("A Windows task ran, but ULTRON could not record its result. Check the connection.");
                    continue;
                }

                ShowStatus("ULTRON remote task: " + commandId + " processed.");
            }

            // Shared ecosystem state is stored locally before the delivery is ACKed.
            // If local persistence or the ACK fails, the server retains the event for retry.
            await PollPendingStateEventsAsync(backendUri, (identity.DeviceId!, identity.Token!));
        }
        catch (TaskCanceledException) { }
        catch (Exception ex)
        {
            ShowStatus("Remote command sync is unavailable: " + ex.GetType().Name);
        }
        finally
        {
            Interlocked.Exchange(ref _commandPollInProgress, 0);
        }
    }

    private async Task PollPendingStateEventsAsync(Uri backendUri, (string DeviceId, string Token) identity)
    {
        var route = "/api/jarvis/devices/my/state/events";
        using var request = new HttpRequestMessage(HttpMethod.Get, new Uri(backendUri, route));
        request.Headers.Add("x-device-token", identity.Token);
        using var response = await s_httpClient.SendAsync(request);
        if (response.StatusCode == System.Net.HttpStatusCode.Unauthorized)
        {
            ShowStatus("Windows companion state sync authentication expired. Re-pair this device.");
            return;
        }
        if (!response.IsSuccessStatusCode) return;
        var json = await ReadBoundedContentAsync(response.Content, 512 * 1024);
        if (json is null) return;

        using var document = System.Text.Json.JsonDocument.Parse(string.IsNullOrWhiteSpace(json) ? "{}" : json);
        if (!document.RootElement.TryGetProperty("events", out var events) ||
            events.ValueKind != System.Text.Json.JsonValueKind.Array)
            return;

        foreach (var stateEvent in events.EnumerateArray())
        {
            if (!stateEvent.TryGetProperty("deliveryId", out var deliveryNode) ||
                deliveryNode.ValueKind != System.Text.Json.JsonValueKind.String)
                continue;
            var deliveryId = deliveryNode.GetString() ?? "";
            if (!Regex.IsMatch(deliveryId, @"^[A-Za-z0-9_-]{1,128}$")) continue;
            if (!TryApplySharedStateEvent(stateEvent)) continue;

            var ackRoute = $"/api/jarvis/devices/my/state/events/{Uri.EscapeDataString(deliveryId)}/ack";
            using var ack = new HttpRequestMessage(HttpMethod.Post, new Uri(backendUri, ackRoute))
            {
                Content = new StringContent("{}", Encoding.UTF8, "application/json")
            };
            ack.Headers.Add("x-device-token", identity.Token);
            using var ackResponse = await s_httpClient.SendAsync(ack);
            if (!ackResponse.IsSuccessStatusCode) continue;
        }
    }

    private static bool TryApplySharedStateEvent(System.Text.Json.JsonElement stateEvent)
    {
        try
        {
            if (!stateEvent.TryGetProperty("stateKey", out var keyNode) ||
                keyNode.ValueKind != System.Text.Json.JsonValueKind.String ||
                !stateEvent.TryGetProperty("version", out var versionNode) ||
                !versionNode.TryGetInt64(out var incomingVersion) || incomingVersion < 1 ||
                !stateEvent.TryGetProperty("payload", out var payload))
                return false;

            var stateKey = keyNode.GetString() ?? "";
            if (string.IsNullOrWhiteSpace(stateKey) || stateKey.Length > 160) return false;

            var localRoot = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "ULTRON");
            Directory.CreateDirectory(localRoot);
            var statePath = Path.Combine(localRoot, "shared-state.json");
            s_sharedStateLock.Wait();
            try
            {
                var states = new Dictionary<string, System.Text.Json.JsonElement>(StringComparer.Ordinal);
                if (File.Exists(statePath))
                {
                    using var existingDocument = System.Text.Json.JsonDocument.Parse(File.ReadAllText(statePath));
                    if (existingDocument.RootElement.TryGetProperty("states", out var existingStates) &&
                        existingStates.ValueKind == System.Text.Json.JsonValueKind.Object)
                    {
                        foreach (var property in existingStates.EnumerateObject())
                            states[property.Name] = property.Value.Clone();
                    }
                }

                if (states.TryGetValue(stateKey, out var currentState))
                {
                    var currentVersion = currentState.TryGetProperty("version", out var currentVersionNode)
                        ? currentVersionNode.GetInt64() : 0L;
                    if (incomingVersion <= currentVersion) return true; // duplicate or stale: safe to ACK
                }

                var entryJson = System.Text.Json.JsonSerializer.Serialize(new
                {
                    version = incomingVersion,
                    payload = payload.Clone(),
                    timestamp = stateEvent.TryGetProperty("timestamp", out var ts) ? ts.GetString() : null
                });
                using var entryDocument = System.Text.Json.JsonDocument.Parse(entryJson);
                states[stateKey] = entryDocument.RootElement.Clone();

                var envelope = System.Text.Json.JsonSerializer.Serialize(new
                {
                    schemaVersion = 1,
                    updatedAt = DateTime.UtcNow,
                    states
                });
                var tempPath = statePath + "." + Guid.NewGuid().ToString("N") + ".tmp";
                File.WriteAllText(tempPath, envelope, new UTF8Encoding(false));
                File.Move(tempPath, statePath, true);
                return true;
            }
            finally
            {
                s_sharedStateLock.Release();
            }
        }
        catch
        {
            return false;
        }
    }

    private void OpenAssistant()
    {
        try
        {
            Process.Start(new ProcessStartInfo(AssistantUrl) { UseShellExecute = true });
            ShowStatus("ULTRON opened in your default browser.");
        }
        catch
        {
            ShowStatus("Could not open the browser. Use the Open ULTRON button to retry.");
            MessageBox.Show(_window,
                "Windows could not open the default browser. Visit " + AssistantUrl,
                "Could not open ULTRON", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }

    private static async Task<string?> ReadBoundedContentAsync(HttpContent content, int maxBytes)
    {
        if (content.Headers.ContentLength is long declaredLength && declaredLength > maxBytes)
            return null;

        await using var stream = await content.ReadAsStreamAsync();
        using var output = new MemoryStream();
        var chunk = new byte[8192];
        while (true)
        {
            var read = await stream.ReadAsync(chunk.AsMemory(0, chunk.Length));
            if (read == 0) break;
            if (output.Length + read > maxBytes) return null;
            await output.WriteAsync(chunk.AsMemory(0, read));
        }

        return Encoding.UTF8.GetString(output.ToArray());
    }

    private List<object> BuildVoiceHistoryPayload(string currentCommand)
    {
        var recent = new List<(string Role, string Content)>();
        lock (_voiceHistoryLock)
            recent.AddRange(_voiceHistory.TakeLast(12));

        var selected = new List<(string Role, string Content)>();
        var totalChars = 0;
        for (var index = recent.Count - 1; index >= 0; index--)
        {
            var item = recent[index];
            if (totalChars + item.Content.Length > 12_000) break;
            selected.Insert(0, item);
            totalChars += item.Content.Length;
        }

        selected.Add(("user", currentCommand));
        return selected.Select(item => (object)new { role = item.Role, content = item.Content }).ToList();
    }

    private void ShowStatus(string message)
    {
        if (_window.IsDisposed) return;
        if (_window.InvokeRequired)
        {
            try { _window.BeginInvoke((Action)(() => ShowStatus(message))); } catch { }
            return;
        }

        _status.Text = message;
        _tray.Text = message.Length > 60 ? message[..60] : message;
    }

    private void ShowWindow()
    {
        _window.Show();
        _window.WindowState = FormWindowState.Normal;
        _window.Activate();
    }

    private void ExitApplication()
    {
        _allowExit = true;
        _commandPollTimer.Stop();
        _commandPollTimer.Dispose();
        StopListening();
        _tray.Visible = false;
        _tray.Dispose();
        _floatingCore?.Dispose();
        _window.Close();
        ExitThread();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _commandPollTimer.Stop();
            _commandPollTimer.Dispose();
            StopListening();
            _tray.Visible = false;
            _tray.Dispose();
            _floatingCore?.Dispose();
            _window.Dispose();
        }
        base.Dispose(disposing);
    }
}

internal static class NativeMethods
{
    public const uint WDA_NONE = 0x00000000;
    public const uint WDA_MONITOR = 0x00000001;
    public const uint WDA_EXCLUDEFROMCAPTURE = 0x00000011;

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetWindowDisplayAffinity(IntPtr hWnd, uint dwAffinity);

    [DllImport("winmm.dll", SetLastError = true)]
    public static extern int waveOutGetVolume(IntPtr hwo, out uint dwVolume);

    [DllImport("winmm.dll", SetLastError = true)]
    public static extern int waveOutSetVolume(IntPtr hwo, uint dwVolume);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool LockWorkStation();

    [DllImport("user32.dll", SetLastError = true)]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
}

internal sealed class FloatingCoreOverlayForm : Form
{
    private const int WS_EX_NOACTIVATE = 0x08000000;
    private const int WS_EX_TOOLWINDOW = 0x00000080;
    private readonly CompanionContext _context;
    private readonly int _coreSize = 120;
    private string _state = "STANDBY";
    private bool _isDragging;
    private Point _dragStart;
    private readonly System.Windows.Forms.Timer _animTimer;
    private float _angle;
    private bool _captureShieldActive;

    public bool IsCaptureShieldActive => _captureShieldActive;

    public FloatingCoreOverlayForm(CompanionContext context)
    {
        _context = context;
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.Manual;
        ShowInTaskbar = false;
        TopMost = true;
        DoubleBuffered = true;
        Size = new Size(_coreSize, _coreSize);
        BackColor = Color.FromArgb(10, 15, 29);

        // Position bottom-right with 24px padding
        var screen = Screen.PrimaryScreen?.WorkingArea ?? new Rectangle(0, 0, 1920, 1080);
        Location = new Point(screen.Right - _coreSize - 24, screen.Bottom - _coreSize - 24);

        _animTimer = new System.Windows.Forms.Timer { Interval = 33 };
        _animTimer.Tick += (_, _) =>
        {
            _angle = (_angle + 3f) % 360f;
            Invalidate();
        };
        _animTimer.Start();

        MouseDown += OnMouseDown;
        MouseMove += OnMouseMove;
        MouseUp += OnMouseUp;
        MouseDoubleClick += (_, _) => _context.ToggleListeningMode();
    }

    protected override CreateParams CreateParams
    {
        get
        {
            var cp = base.CreateParams;
            cp.ExStyle |= WS_EX_NOACTIVATE;
            cp.ExStyle |= WS_EX_TOOLWINDOW;
            return cp;
        }
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        try
        {
            // Apply Win32 display capture exclusion (WDA_EXCLUDEFROMCAPTURE = 0x11)
            _captureShieldActive = NativeMethods.SetWindowDisplayAffinity(Handle, NativeMethods.WDA_EXCLUDEFROMCAPTURE);
        }
        catch
        {
            _captureShieldActive = false;
        }
    }

    public void SetVisualState(string state)
    {
        _state = state;
        Invalidate();
    }

    public void ToggleVisibility()
    {
        if (Visible) Hide();
        else Show();
    }

    private void OnMouseDown(object? sender, MouseEventArgs e)
    {
        if (e.Button == MouseButtons.Left)
        {
            _isDragging = true;
            _dragStart = e.Location;
        }
    }

    private void OnMouseMove(object? sender, MouseEventArgs e)
    {
        if (_isDragging)
        {
            var newX = Location.X + (e.X - _dragStart.X);
            var newY = Location.Y + (e.Y - _dragStart.Y);
            var screen = Screen.PrimaryScreen?.WorkingArea ?? new Rectangle(0, 0, 1920, 1080);

            // Screen boundary clamping
            newX = Math.Max(screen.Left + 8, Math.Min(screen.Right - Width - 8, newX));
            newY = Math.Max(screen.Top + 8, Math.Min(screen.Bottom - Height - 8, newY));
            Location = new Point(newX, newY);
        }
    }

    private void OnMouseUp(object? sender, MouseEventArgs e)
    {
        _isDragging = false;
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;

        var bounds = new Rectangle(6, 6, Width - 12, Height - 12);
        var stateColor = _state switch
        {
            "LISTENING" => Color.FromArgb(255, 179, 0),
            "THINKING" => Color.FromArgb(138, 43, 226),
            "SPEAKING" => Color.FromArgb(56, 189, 248),
            "EXECUTING" => Color.FromArgb(37, 99, 235),
            "SELF_UPGRADING" => Color.FromArgb(16, 185, 129),
            "VISION_ACTIVE" => Color.FromArgb(168, 85, 247),
            "ERROR" => Color.FromArgb(239, 68, 68),
            "OFFLINE" => Color.FromArgb(100, 116, 139),
            "MUTED" => Color.FromArgb(245, 158, 11),
            _ => Color.FromArgb(0, 210, 255)
        };

        // Outer ring
        using var penOuter = new Pen(Color.FromArgb(120, stateColor), 2f) { DashStyle = DashStyle.Dash };
        g.DrawEllipse(penOuter, bounds);

        // Middle rotating ring
        var midBounds = new Rectangle(bounds.X + 14, bounds.Y + 14, bounds.Width - 28, bounds.Height - 28);
        using var penMid = new Pen(stateColor, 2f);
        g.DrawArc(penMid, midBounds, _angle, 120);
        g.DrawArc(penMid, midBounds, _angle + 180, 120);

        // Core nucleus
        var nucBounds = new Rectangle(bounds.X + (bounds.Width / 2) - 12, bounds.Y + (bounds.Height / 2) - 12, 24, 24);
        using var brushCore = new SolidBrush(stateColor);
        g.FillEllipse(brushCore, nucBounds);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _animTimer.Stop();
            _animTimer.Dispose();
        }
        base.Dispose(disposing);
    }
}
