using System.Diagnostics;
using Microsoft.Win32;
using System.Speech.Recognition;
using System.Windows.Forms;

namespace Ultron.Companion;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        if (args.Any(arg => arg.Equals("--verify-network-policy", StringComparison.OrdinalIgnoreCase)))
        {
            Environment.ExitCode = DesktopActionBridge.RunNetworkAddressPolicySelfTest();
            return;
        }

        ApplicationConfiguration.Initialize();
        var backgroundLaunch = args.Any(arg => arg.Equals("--background-listen", StringComparison.OrdinalIgnoreCase));
        Application.Run(new CompanionContext(backgroundLaunch));
    }
}

internal sealed class CompanionContext : ApplicationContext
{
    private const string AssistantUrl = "https://ultron-ai-zvd7.onrender.com/";
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
    private readonly CheckBox _desktopBridgeCheckBox;
    private bool _suppressAutoStartChange;
    private bool _suppressDesktopBridgeChange;
    private DesktopActionBridge? _desktopActionBridge;
    private CancellationTokenSource? _desktopBridgeCancellation;
    private Task? _desktopBridgeTask;
    private SpeechRecognitionEngine? _recognizer;
    private bool _allowExit;
    private DateTime _lastWakeUtc = DateTime.MinValue;
    private readonly object _wakeLock = new();

    public CompanionContext(bool backgroundLaunch = false)
    {
        _window = new Form
        {
            Text = "ULTRON Wake Companion",
            Width = 520,
            Height = 310,
            StartPosition = FormStartPosition.CenterScreen,
            MinimumSize = new System.Drawing.Size(460, 280)
        };

        var layout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            RowCount = 5,
            Padding = new Padding(16)
        };
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 22));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 22));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 25));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 14));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 17));

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

        _desktopBridgeCheckBox = new CheckBox
        {
            Text = "Enable approved PC actions (token + per-action approval required)",
            AutoSize = true,
            Checked = false
        };
        _desktopBridgeCheckBox.CheckedChanged += (_, _) => HandleDesktopBridgeChanged();

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
        layout.Controls.Add(_autoStartCheckBox, 0, 3);
        layout.Controls.Add(_desktopBridgeCheckBox, 0, 4);
        _window.Controls.Add(layout);

        _startItem = new ToolStripMenuItem("Start wake word", null, (_, _) => StartListening());
        _stopItem = new ToolStripMenuItem("Pause listening", null, (_, _) => StopListening()) { Enabled = false };
        var menu = new ContextMenuStrip();
        menu.Items.Add(_startItem);
        menu.Items.Add(_stopItem);
        menu.Items.Add(new ToolStripSeparator());
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

        // A background launch is permitted only when the user previously enabled
        // the visible "Start with Windows and listen" option in this app.
        // Create the hidden window handle so recognition callbacks can safely marshal
        // to the UI thread even when the app starts directly into the tray.
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

    private void HandleAutoStartChanged()
    {
        if (_suppressAutoStartChange) return;
        if (_autoStartCheckBox.Checked)
        {
            // Enabling sign-in listening always starts with an explicit consent prompt.
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

    private void HandleDesktopBridgeChanged()
    {
        if (_suppressDesktopBridgeChange) return;
        if (!_desktopBridgeCheckBox.Checked)
        {
            StopDesktopActionBridge();
            ShowStatus("PC action bridge paused. No remote PC actions will be polled.");
            return;
        }

        var token = Environment.GetEnvironmentVariable("ULTRON_DESKTOP_BRIDGE_TOKEN") ?? "";
        var baseUrl = Environment.GetEnvironmentVariable("ULTRON_API_BASE_URL");
        if (string.IsNullOrWhiteSpace(baseUrl)) baseUrl = AssistantUrl.TrimEnd('/');
        if (!DesktopActionBridge.HasValidConfiguration(baseUrl, token))
        {
            SetDesktopBridgeChecked(false);
            ShowStatus("PC action bridge is not configured. Set ULTRON_DESKTOP_BRIDGE_TOKEN (32+ characters) and an HTTPS ULTRON_API_BASE_URL.");
            MessageBox.Show(_window,
                "The approved-action bridge needs a high-entropy ULTRON_DESKTOP_BRIDGE_TOKEN configured both on the server and in this Windows user's environment. The URL must be HTTPS. No token is stored by this app.",
                "PC action bridge not configured",
                MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }

        var consent = MessageBox.Show(
            _window,
            "Enable the ULTRON PC action bridge?\n\nThe companion will poll ULTRON for actions that you separately approve in ULTRON. It can only open an approved public HTTPS URL, launch Notepad/Calculator/Explorer, or return limited Windows system information. It will not run shell commands, read/write files, take screenshots, upload files, or delete data.\n\nKeep this checkbox off when you do not want the PC to receive approved actions.",
            "PC action bridge consent",
            MessageBoxButtons.YesNo,
            MessageBoxIcon.Warning);
        if (consent != DialogResult.Yes)
        {
            SetDesktopBridgeChecked(false);
            ShowStatus("PC action bridge remains paused; consent was not granted.");
            return;
        }

        StopDesktopActionBridge();
        var bridge = new DesktopActionBridge();
        var cancellation = new CancellationTokenSource();
        _desktopActionBridge = bridge;
        _desktopBridgeCancellation = cancellation;
        _desktopBridgeTask = Task.Run(() => bridge.RunAsync(baseUrl, token, ShowStatus, cancellation.Token));
        ShowStatus("PC action bridge enabled. Only actions explicitly approved for this owner are polled.");
    }

    private void SetDesktopBridgeChecked(bool value)
    {
        _suppressDesktopBridgeChange = true;
        _desktopBridgeCheckBox.Checked = value;
        _suppressDesktopBridgeChange = false;
    }

    private void StopDesktopActionBridge()
    {
        var cancellation = _desktopBridgeCancellation;
        var bridge = _desktopActionBridge;
        var task = _desktopBridgeTask;
        _desktopBridgeCancellation = null;
        _desktopActionBridge = null;
        _desktopBridgeTask = null;
        if (cancellation is null)
        {
            bridge?.Dispose();
            return;
        }

        cancellation.Cancel();
        if (task is null)
        {
            bridge?.Dispose();
            cancellation.Dispose();
            return;
        }
        _ = task.ContinueWith(_ =>
        {
            bridge?.Dispose();
            cancellation.Dispose();
        }, CancellationToken.None, TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);
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
        ShowStatus("Wake word paused. Microphone listener is off.");
    }

    private void OnWakeWordRecognized()
    {
        lock (_wakeLock)
        {
            var now = DateTime.UtcNow;
            if ((now - _lastWakeUtc).TotalSeconds < 8) return;
            _lastWakeUtc = now;
        }

        if (_window.IsDisposed || !_window.IsHandleCreated) return;
        _window.BeginInvoke((Action)(() =>
        {
            ShowStatus("“Ultron” detected. Opening the ULTRON assistant.");
            try
            {
                _tray.BalloonTipTitle = "ULTRON activated";
                _tray.BalloonTipText = "Wake word detected. Opening ULTRON in your browser.";
                _tray.BalloonTipIcon = ToolTipIcon.Info;
                _tray.ShowBalloonTip(2500);
            }
            catch { /* Toast notifications can be disabled by Windows. */ }
            OpenAssistant();
        }));
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
        StopDesktopActionBridge();
        StopListening();
        _tray.Visible = false;
        _tray.Dispose();
        _window.Close();
        ExitThread();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            StopDesktopActionBridge();
            StopListening();
            _tray.Visible = false;
            _tray.Dispose();
            _window.Dispose();
        }
        base.Dispose(disposing);
    }
}
