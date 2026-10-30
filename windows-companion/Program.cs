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
        ApplicationConfiguration.Initialize();
        var backgroundLaunch = args.Any(arg => arg.Equals("--background-listen", StringComparison.OrdinalIgnoreCase));
        Application.Run(new CompanionContext(backgroundLaunch));
    }
}

internal sealed class CompanionContext : ApplicationContext
{
    private const string StartupRegistryPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private string _assistantUrl;
    private bool _assistantUrlConfigurationInvalid;
    private const string StartupRegistryValue = "ULTRONWakeCompanion";
    private readonly Form _window;
    private readonly Label _status;
    private readonly NotifyIcon _tray;
    private readonly ToolStripMenuItem _startItem;
    private readonly ToolStripMenuItem _stopItem;
    private readonly Button _startButton;
    private readonly Button _stopButton;
    private readonly CheckBox _autoStartCheckBox;
    private readonly Button _pairDeviceButton;
    private readonly Button _startPresenceButton;
    private readonly Button _stopPresenceButton;
    private readonly Button _startActionsButton;
    private readonly Button _stopActionsButton;
    private readonly CloudPresenceClient _cloudPresence = new();
    private CancellationTokenSource? _presenceCancellation;
    private CancellationTokenSource? _actionsCancellation;
    private bool _suppressAutoStartChange;
    private SpeechRecognitionEngine? _recognizer;
    private bool _allowExit;
    private DateTime _lastWakeUtc = DateTime.MinValue;
    private readonly object _wakeLock = new();

    public CompanionContext(bool backgroundLaunch = false)
    {
        _assistantUrl = AssistantUrlStore.Resolve(out _assistantUrlConfigurationInvalid);

        _window = new Form
        {
            Text = "ULTRON Wake Companion",
            Width = 520,
            Height = 385,
            StartPosition = FormStartPosition.CenterScreen,
            MinimumSize = new System.Drawing.Size(490, 350)
        };

        var layout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            RowCount = 5,
            Padding = new Padding(16)
        };
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 14));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 18));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 25));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 28));
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
        var serverSettingsButton = new Button { Text = "Server settings", AutoSize = true };
        serverSettingsButton.Click += (_, _) => ConfigureAssistantUrl();
        buttons.Controls.Add(serverSettingsButton);

        layout.Controls.Add(title, 0, 0);
        layout.Controls.Add(_status, 0, 1);
        layout.Controls.Add(buttons, 0, 2);

        var cloudButtons = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill,
            FlowDirection = FlowDirection.LeftToRight,
            WrapContents = true
        };
        _pairDeviceButton = new Button { Text = "Pair this PC", AutoSize = true };
        _startPresenceButton = new Button { Text = "Start cloud presence", AutoSize = true };
        _stopPresenceButton = new Button { Text = "Stop cloud presence", AutoSize = true, Enabled = false };
        _startActionsButton = new Button { Text = "Enable local action approvals", AutoSize = true, Enabled = false };
        _stopActionsButton = new Button { Text = "Stop action approvals", AutoSize = true, Enabled = false };
        _pairDeviceButton.Click += async (_, _) => await PairCloudCompanionAsync();
        _startPresenceButton.Click += async (_, _) => await StartCloudPresenceAsync();
        _stopPresenceButton.Click += (_, _) => StopCloudPresence();
        _startActionsButton.Click += async (_, _) => await StartRemoteActionApprovalsAsync();
        _stopActionsButton.Click += (_, _) => StopRemoteActionApprovals();
        cloudButtons.Controls.Add(_pairDeviceButton);
        cloudButtons.Controls.Add(_startPresenceButton);
        cloudButtons.Controls.Add(_stopPresenceButton);
        cloudButtons.Controls.Add(_startActionsButton);
        cloudButtons.Controls.Add(_stopActionsButton);

        layout.Controls.Add(cloudButtons, 0, 3);
        layout.Controls.Add(_autoStartCheckBox, 0, 4);
        _window.Controls.Add(layout);

        _startItem = new ToolStripMenuItem("Start wake word", null, (_, _) => StartListening());
        _stopItem = new ToolStripMenuItem("Pause listening", null, (_, _) => StopListening()) { Enabled = false };
        var menu = new ContextMenuStrip();
        menu.Items.Add(_startItem);
        menu.Items.Add(_stopItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Open ULTRON", null, (_, _) => OpenAssistant());
        menu.Items.Add("Server settings", null, (_, _) => ConfigureAssistantUrl());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Pair this PC with ULTRON", null, async (_, _) => await PairCloudCompanionAsync());
        menu.Items.Add("Start cloud presence", null, async (_, _) => await StartCloudPresenceAsync());
        menu.Items.Add("Stop cloud presence", null, (_, _) => StopCloudPresence());
        menu.Items.Add("Enable local action approvals", null, async (_, _) => await StartRemoteActionApprovalsAsync());
        menu.Items.Add("Stop action approvals", null, (_, _) => StopRemoteActionApprovals());
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

    private void ConfigureAssistantUrl()
    {
        using var dialog = new Form
        {
            Text = "ULTRON server settings",
            Width = 520,
            Height = 220,
            StartPosition = FormStartPosition.CenterParent,
            FormBorderStyle = FormBorderStyle.FixedDialog,
            MaximizeBox = false,
            MinimizeBox = false
        };
        var prompt = new Label
        {
            Text = "Use the same public HTTPS origin shown in the ULTRON browser app. This setting is saved for the current Windows user.",
            Dock = DockStyle.Top,
            Height = 58,
            Padding = new Padding(12)
        };
        var address = new TextBox
        {
            Text = _assistantUrl,
            Dock = DockStyle.Top,
            Margin = new Padding(12),
            MaxLength = 2048
        };
        var buttons = new FlowLayoutPanel
        {
            Dock = DockStyle.Bottom,
            Height = 48,
            FlowDirection = FlowDirection.RightToLeft,
            Padding = new Padding(8)
        };
        var save = new Button { Text = "Save server", DialogResult = DialogResult.None, AutoSize = true };
        var cancel = new Button { Text = "Cancel", DialogResult = DialogResult.Cancel, AutoSize = true };
        save.Click += (_, _) =>
        {
            if (!AssistantUrlStore.TrySave(address.Text, out var validated, out var error))
            {
                MessageBox.Show(dialog, error, "ULTRON server address rejected",
                    MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            _assistantUrl = validated;
            _assistantUrlConfigurationInvalid = false;
            dialog.DialogResult = DialogResult.OK;
            dialog.Close();
        };
        buttons.Controls.Add(save);
        buttons.Controls.Add(cancel);
        dialog.Controls.Add(buttons);
        dialog.Controls.Add(address);
        dialog.Controls.Add(prompt);
        dialog.AcceptButton = save;
        dialog.CancelButton = cancel;

        if (dialog.ShowDialog(_window) == DialogResult.OK)
        {
            ShowStatus("ULTRON server address saved. Open ULTRON and future new pairings will use this origin. Existing paired heartbeats remain bound to their original server.");
            MessageBox.Show(_window,
                "Server address saved. New pairings will use this origin. Existing device heartbeat credentials remain tied to the deployment where they were paired; revoke and pair again to move a device to another deployment.",
                "ULTRON server updated", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
    }

    private async Task PairCloudCompanionAsync()
    {
        using var dialog = new Form
        {
            Text = "Pair this PC with ULTRON",
            Width = 430,
            Height = 190,
            StartPosition = FormStartPosition.CenterParent,
            FormBorderStyle = FormBorderStyle.FixedDialog,
            MaximizeBox = false,
            MinimizeBox = false
        };
        var prompt = new Label
        {
            Text = "Paste the one-time pairing code from ULTRON → PC and mobile devices. It expires after five minutes.",
            Dock = DockStyle.Top,
            Height = 52,
            Padding = new Padding(12)
        };
        var code = new TextBox
        {
            Dock = DockStyle.Top,
            Margin = new Padding(12),
            UseSystemPasswordChar = true,
            MaxLength = 32
        };
        var buttons = new FlowLayoutPanel
        {
            Dock = DockStyle.Bottom,
            Height = 48,
            FlowDirection = FlowDirection.RightToLeft,
            Padding = new Padding(8)
        };
        var pair = new Button { Text = "Pair securely", DialogResult = DialogResult.OK, AutoSize = true };
        var cancel = new Button { Text = "Cancel", DialogResult = DialogResult.Cancel, AutoSize = true };
        buttons.Controls.Add(pair);
        buttons.Controls.Add(cancel);
        dialog.Controls.Add(buttons);
        dialog.Controls.Add(code);
        dialog.Controls.Add(prompt);
        dialog.AcceptButton = pair;
        dialog.CancelButton = cancel;
        if (dialog.ShowDialog(_window) != DialogResult.OK) return;

        _pairDeviceButton.Enabled = false;
        ShowStatus("Pairing with ULTRON…");
        try
        {
            var pairing = await _cloudPresence.PairAsync(_assistantUrl, code.Text);
            ShowStatus($"Paired {pairing.DeviceName} with ULTRON. Cloud presence is still off until you start it.");
            MessageBox.Show(_window,
                "This PC is paired. Its credential is stored in Windows Credential Manager. Start cloud presence to show this PC as online. Fixed remote shortcuts remain disabled until you separately enable local action approvals; every shortcut then requires a fresh Yes/No confirmation on this PC.",
                "ULTRON pairing complete", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
        catch (Exception error)
        {
            ShowStatus("ULTRON pairing failed. Check the server address and one-time code.");
            MessageBox.Show(_window, error.Message, "ULTRON pairing failed",
                MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
        finally
        {
            _pairDeviceButton.Enabled = true;
        }
    }

    private async Task StartCloudPresenceAsync()
    {
        if (_presenceCancellation is not null) return;
        if (!_cloudPresence.HasPairing)
        {
            MessageBox.Show(_window, "Pair this PC from the ULTRON devices page first. The one-time code is required.",
                "Pairing required", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }

        var consent = MessageBox.Show(_window,
            "Allow this PC to send an outbound HTTPS online-status heartbeat to your ULTRON account every 30 seconds while the companion is running?\n\nOnly device name/ID and online presence are reported. ULTRON cannot run commands, inspect files, capture screenshots, or control this PC through this connection.",
            "Start ULTRON cloud presence", MessageBoxButtons.YesNo, MessageBoxIcon.Question);
        if (consent != DialogResult.Yes) return;

        var cancellation = new CancellationTokenSource();
        _presenceCancellation = cancellation;
        _startPresenceButton.Enabled = false;
        _pairDeviceButton.Enabled = false;
        _stopPresenceButton.Enabled = true;
        ShowStatus("Starting ULTRON cloud presence…");
        try
        {
            await _cloudPresence.RunHeartbeatLoopAsync(ShowStatus, cancellation.Token);
        }
        catch (OperationCanceledException) when (cancellation.IsCancellationRequested)
        {
            // User stopped presence or closed the companion.
        }
        catch (Exception error)
        {
            ShowStatus("ULTRON cloud presence stopped: " + error.GetType().Name);
        }
        finally
        {
            if (ReferenceEquals(_presenceCancellation, cancellation))
            {
                _presenceCancellation = null;
                cancellation.Dispose();
                if (!_window.IsDisposed)
                {
                    _startPresenceButton.Enabled = true;
                    _pairDeviceButton.Enabled = true;
                    _stopPresenceButton.Enabled = false;
                    _startActionsButton.Enabled = false;
                    StopRemoteActionApprovals();
                    if (!_allowExit) ShowStatus("ULTRON cloud presence is stopped.");
                }
            }
        }
    }

    private async Task StartRemoteActionApprovalsAsync()
    {
        if (_actionsCancellation is not null) return;
        if (!_cloudPresence.HasPairing)
        {
            MessageBox.Show(_window, "Pair this PC with ULTRON before enabling local action approvals.",
                "Pairing required", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }
        if (_presenceCancellation is null)
        {
            MessageBox.Show(_window, "Start cloud presence first. Local action approvals use the same paired outbound connection.",
                "Cloud presence required", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }

        var consent = MessageBox.Show(_window,
            "Enable requests for six fixed shortcuts on this PC? ULTRON may ask to open Notepad, File Explorer, Calculator, or the standard Desktop, Documents or Downloads folder.\n\nEvery request is shown here as a separate Yes/No prompt. Nothing runs without your local approval. This does not enable shell commands, arbitrary files, screenshots, clipboard, keyboard or mouse control.",
            "Enable ULTRON local action approvals", MessageBoxButtons.YesNo, MessageBoxIcon.Warning);
        if (consent != DialogResult.Yes) return;

        var cancellation = new CancellationTokenSource();
        _actionsCancellation = cancellation;
        _startActionsButton.Enabled = false;
        _stopActionsButton.Enabled = true;
        ShowStatus("ULTRON local action approvals are starting…");
        try
        {
            await _cloudPresence.RunRemoteActionPollingLoopAsync(
                ApproveRemoteCommandAsync,
                ExecuteRemoteCommandAsync,
                ShowStatus,
                cancellation.Token);
        }
        catch (OperationCanceledException) when (cancellation.IsCancellationRequested)
        {
            // The local user stopped action approvals.
        }
        catch (Exception error)
        {
            ShowStatus("ULTRON local action approvals stopped: " + error.GetType().Name);
        }
        finally
        {
            if (ReferenceEquals(_actionsCancellation, cancellation))
            {
                _actionsCancellation = null;
                cancellation.Dispose();
                if (!_window.IsDisposed)
                {
                    _startActionsButton.Enabled = _presenceCancellation is not null && _cloudPresence.HasPairing;
                    _stopActionsButton.Enabled = false;
                    if (!_allowExit) ShowStatus("ULTRON local action approvals are stopped.");
                }
            }
        }
    }

    private Task<bool> ApproveRemoteCommandAsync(RemoteDesktopCommand command, CancellationToken cancellationToken)
    {
        var completion = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        void ShowApproval()
        {
            if (cancellationToken.IsCancellationRequested || _allowExit || _window.IsDisposed)
            {
                completion.TrySetResult(false);
                return;
            }
            var result = MessageBox.Show(
                _window,
                "ULTRON requests permission to " + CloudPresenceClient.DescribeCommand(command) + ".\n\nThis is a one-time fixed shortcut. It cannot run commands or access arbitrary files.\n\nAllow this action on this PC?",
                "ULTRON action approval required",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Warning,
                MessageBoxDefaultButton.Button2);
            completion.TrySetResult(result == DialogResult.Yes && !cancellationToken.IsCancellationRequested);
        }

        if (_window.IsDisposed) return Task.FromResult(false);
        try
        {
            if (_window.InvokeRequired) _window.BeginInvoke((Action)ShowApproval);
            else ShowApproval();
        }
        catch
        {
            completion.TrySetResult(false);
        }
        return completion.Task;
    }

    private static Task<string> ExecuteRemoteCommandAsync(RemoteDesktopCommand command, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(RemoteDesktopActionExecutor.Execute(command));
    }

    private void StopRemoteActionApprovals()
    {
        _actionsCancellation?.Cancel();
        if (!_window.IsDisposed)
        {
            _startActionsButton.Enabled = false;
            _stopActionsButton.Enabled = _actionsCancellation is not null;
        }
        ShowStatus("Stopping ULTRON local action approvals…");
    }

    private void StopCloudPresence()
    {
        StopRemoteActionApprovals();
        _presenceCancellation?.Cancel();
        ShowStatus("Stopping ULTRON cloud presence…");
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
            Process.Start(new ProcessStartInfo(_assistantUrl) { UseShellExecute = true });
            if (_assistantUrlConfigurationInvalid)
                ShowStatus("ULTRON_ASSISTANT_URL was invalid; opened the built-in HTTPS destination instead.");
            else
                ShowStatus("ULTRON opened in your default browser.");
        }
        catch
        {
            ShowStatus("Could not open the browser. Use the Open ULTRON button to retry.");
            MessageBox.Show(_window,
                "Windows could not open the default browser. Visit " + _assistantUrl,
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
        StopRemoteActionApprovals();
        StopCloudPresence();
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
            StopRemoteActionApprovals();
            StopCloudPresence();
            StopListening();
            _cloudPresence.Dispose();
            _tray.Visible = false;
            _tray.Dispose();
            _window.Dispose();
        }
        base.Dispose(disposing);
    }
}
