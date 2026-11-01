using System.Diagnostics;
using Microsoft.Win32;
using System.Speech.Recognition;
using System.Speech.Synthesis;
using System.Windows.Forms;
using System.Runtime.InteropServices;
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
    private bool _suppressAutoStartChange;
    private SpeechRecognitionEngine? _recognizer;
    private bool _allowExit;
    private DateTime _lastWakeUtc = DateTime.MinValue;
    private DateTime _lastSnapUtc = DateTime.MinValue;
    private int _prevAudioLevel = 0;
    private uint _savedVolume = 0xFFFFFFFF;
    private bool _isDucked = false;
    private readonly object _wakeLock = new();
    private readonly FloatingCoreOverlayForm _floatingCore;
    private static readonly HttpClient s_httpClient = new() { Timeout = TimeSpan.FromSeconds(10) };

    public CompanionContext(bool backgroundLaunch = false)
    {
        _window = new Form
        {
            Text = "ULTRON Wake Companion",
            Width = 480,
            Height = 255,
            StartPosition = FormStartPosition.CenterScreen,
            MinimumSize = new System.Drawing.Size(430, 230)
        };

        var layout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            RowCount = 4,
            Padding = new Padding(16)
        };
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 28));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 24));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 30));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 18));

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
            if ((now - _lastWakeUtc).TotalSeconds < 8) return;
            _lastWakeUtc = now;
        }

        if (_window.IsDisposed || !_window.IsHandleCreated) return;
        _window.BeginInvoke((Action)(async () =>
        {
            _floatingCore?.SetVisualState("LISTENING");
            ShowStatus($"{reason} Processing voice command...");
            EngageMediaDucking();
            try
            {
                _tray.BalloonTipTitle = "ULTRON activated";
                _tray.BalloonTipText = $"{reason} Processing voice command.";
                _tray.BalloonTipIcon = ToolTipIcon.Info;
                _tray.ShowBalloonTip(2500);
            }
            catch { /* Toast notifications can be disabled by Windows. */ }
            await DispatchVoiceCommandAsync("Ultron, status report");
        }));
    }

    private async Task DispatchVoiceCommandAsync(string commandText)
    {
        try
        {
            _floatingCore?.SetVisualState("THINKING");
            ShowStatus("ULTRON thinking...");

            var backendUrl = Environment.GetEnvironmentVariable("ULTRON_BACKEND_URL") ?? "http://127.0.0.1:3000";
            var requestUrl = $"{backendUrl.TrimEnd('/')}/api/jarvis/voice/process-command";

            var payload = System.Text.Json.JsonSerializer.Serialize(new
            {
                command = commandText,
                language = "en",
                source = "windows-companion"
            });

            using var request = new HttpRequestMessage(HttpMethod.Post, requestUrl)
            {
                Content = new StringContent(payload, System.Text.Encoding.UTF8, "application/json")
            };

            var deviceToken = Environment.GetEnvironmentVariable("ULTRON_DEVICE_TOKEN");
            if (!string.IsNullOrEmpty(deviceToken))
            {
                request.Headers.Add("x-device-token", deviceToken);
            }

            var response = await s_httpClient.SendAsync(request);
            if (response.IsSuccessStatusCode)
            {
                var responseJson = await response.Content.ReadAsStringAsync();
                using var doc = System.Text.Json.JsonDocument.Parse(responseJson);
                var textResponse = doc.RootElement.TryGetProperty("textResponse", out var prop) ? prop.GetString() : "Command processed.";

                _floatingCore?.SetVisualState("SPEAKING");
                ShowStatus($"ULTRON: {textResponse}");

                try
                {
                    using var synth = new SpeechSynthesizer();
                    synth.Speak(textResponse);
                }
                catch { /* Speech synthesis fallback */ }
            }
        }
        catch (Exception ex)
        {
            ShowStatus($"ULTRON dispatch error: {ex.Message}");
        }
        finally
        {
            RestoreMediaDucking();
            _floatingCore?.SetVisualState("STANDBY");
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
