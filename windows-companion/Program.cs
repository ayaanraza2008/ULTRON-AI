using System.Diagnostics;
using System.Speech.Recognition;
using System.Windows.Forms;

namespace Ultron.Companion;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new CompanionContext());
    }
}

internal sealed class CompanionContext : ApplicationContext
{
    private const string AssistantUrl = "https://ultron-ai-zvd7.onrender.com/";
    private readonly Form _window;
    private readonly Label _status;
    private readonly NotifyIcon _tray;
    private readonly ToolStripMenuItem _startItem;
    private readonly ToolStripMenuItem _stopItem;
    private SpeechRecognitionEngine? _recognizer;
    private bool _allowExit;
    private DateTime _lastWakeUtc = DateTime.MinValue;
    private readonly object _wakeLock = new();

    public CompanionContext()
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
            RowCount = 3,
            Padding = new Padding(16)
        };
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 36));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 28));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 36));

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

        var buttons = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill,
            FlowDirection = FlowDirection.LeftToRight,
            WrapContents = true
        };
        var startButton = new Button { Text = "Start wake word", AutoSize = true };
        var stopButton = new Button { Text = "Pause listening", AutoSize = true, Enabled = false };
        var openButton = new Button { Text = "Open ULTRON", AutoSize = true };
        startButton.Click += (_, _) => StartListening();
        stopButton.Click += (_, _) => StopListening();
        openButton.Click += (_, _) => OpenAssistant();
        buttons.Controls.Add(startButton);
        buttons.Controls.Add(stopButton);
        buttons.Controls.Add(openButton);

        layout.Controls.Add(title, 0, 0);
        layout.Controls.Add(_status, 0, 1);
        layout.Controls.Add(buttons, 0, 2);
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

        _window.Show();
    }

    private void StartListening()
    {
        if (_recognizer is not null)
        {
            ShowStatus("Wake-word listener is already running.");
            return;
        }

        var consent = MessageBox.Show(
            _window,
            "Enable the ULTRON wake word?\n\nThe default microphone will remain active while this companion runs. It uses an installed Windows speech recognizer to listen for the exact word “Ultron” and does not upload microphone audio to the ULTRON server. Windows may display its own microphone indicator.\n\nThis does not unlock Windows or work while the PC is powered off or asleep.",
            "Microphone consent",
            MessageBoxButtons.YesNo,
            MessageBoxIcon.Information);
        if (consent != DialogResult.Yes)
        {
            ShowStatus("Wake word paused. Microphone permission was not enabled.");
            return;
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
                MessageBox.Show(_window,
                    "No compatible installed English speech recognizer was found. ULTRON will remain paused; this app will not download a speech model automatically.",
                    "Speech recognizer unavailable", MessageBoxButtons.OK, MessageBoxIcon.Warning);
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
            ShowStatus("Listening locally for “Ultron”. Use the tray menu to pause or exit.");
        }
        catch (Exception)
        {
            StopListening();
            var detail = "Windows could not start the speech recognizer. Check microphone permission and install a compatible English speech-recognition language.";
            ShowStatus("Unavailable: microphone or speech recognition could not start.");
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
            StopListening();
            _tray.Visible = false;
            _tray.Dispose();
            _window.Dispose();
        }
        base.Dispose(disposing);
    }
}
