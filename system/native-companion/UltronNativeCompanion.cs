using System;
using System.IO;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;
using System.Runtime.InteropServices;
using System.Threading;

namespace Ultron.NativeCompanion
{
    internal static class Program
    {
        private const string MutexName = "Global\\UltronNativeDesktopCompanionMutex";

        [STAThread]
        private static void Main(string[] args)
        {
            bool createdNew;
            using (Mutex mutex = new Mutex(true, MutexName, out createdNew))
            {
                if (!createdNew)
                {
                    // Already running - emit notification and exit gracefully
                    Console.WriteLine("{\"event\":\"already_running\",\"status\":\"duplicate_prevented\"}");
                    return;
                }

                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new CompanionApplicationContext());
            }
        }
    }

    internal sealed class CompanionApplicationContext : ApplicationContext
    {
        private readonly OrbWindow _orbWindow;
        private readonly NotifyIcon _trayIcon;
        private readonly ContextMenuStrip _trayMenu;
        private readonly Thread _ipcThread;
        private volatile bool _isRunning = true;

        public CompanionApplicationContext()
        {
            _orbWindow = new OrbWindow(this);

            // Setup Context Menu for System Tray
            _trayMenu = new ContextMenuStrip();
            ToolStripMenuItem toggleItem = new ToolStripMenuItem("Show / Hide Orb", null, OnToggleVisibility);
            ToolStripMenuItem clickThroughItem = new ToolStripMenuItem("Toggle Click-Through", null, OnToggleClickThrough);
            ToolStripMenuItem centerItem = new ToolStripMenuItem("Center on Screen", null, OnCenterOrb);
            ToolStripMenuItem emergencyItem = new ToolStripMenuItem("Emergency Stop", null, OnEmergencyStop)
            {
                ForeColor = Color.Red
            };
            ToolStripMenuItem exitItem = new ToolStripMenuItem("Exit Companion", null, OnExit);

            _trayMenu.Items.Add(toggleItem);
            _trayMenu.Items.Add(clickThroughItem);
            _trayMenu.Items.Add(centerItem);
            _trayMenu.Items.Add(new ToolStripSeparator());
            _trayMenu.Items.Add(emergencyItem);
            _trayMenu.Items.Add(new ToolStripSeparator());
            _trayMenu.Items.Add(exitItem);

            // Setup Native System Tray Icon
            _trayIcon = new NotifyIcon
            {
                Text = "ULTRON AI — Desktop Companion",
                Icon = CreateOrbIcon(Color.Cyan),
                ContextMenuStrip = _trayMenu,
                Visible = true
            };
            _trayIcon.DoubleClick += OnToggleVisibility;

            // Start background IPC reader thread
            _ipcThread = new Thread(IpcReaderLoop)
            {
                IsBackground = true,
                Name = "UltronIpcReader"
            };
            _ipcThread.Start();

            _orbWindow.Show();

            // Emit initial ready event
            Console.WriteLine(string.Format(
                "{{\"event\":\"ready\",\"pid\":{0},\"x\":{1},\"y\":{2},\"size\":{3},\"visible\":{4}}}",
                System.Diagnostics.Process.GetCurrentProcess().Id,
                _orbWindow.Left,
                _orbWindow.Top,
                _orbWindow.Width,
                _orbWindow.Visible ? "true" : "false"
            ));
        }

        private Icon CreateOrbIcon(Color coreColor)
        {
            using (Bitmap bmp = new Bitmap(32, 32))
            using (Graphics g = Graphics.FromImage(bmp))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.Clear(Color.Transparent);

                using (Brush outerGlow = new SolidBrush(Color.FromArgb(80, 0, 180, 255)))
                {
                    g.FillEllipse(outerGlow, 2, 2, 28, 28);
                }
                using (Brush midGlow = new SolidBrush(Color.FromArgb(160, coreColor)))
                {
                    g.FillEllipse(midGlow, 6, 6, 20, 20);
                }
                using (Brush core = new SolidBrush(Color.White))
                {
                    g.FillEllipse(core, 11, 11, 10, 10);
                }

                IntPtr hIcon = bmp.GetHicon();
                return Icon.FromHandle(hIcon);
            }
        }

        private void OnToggleVisibility(object sender, EventArgs e)
        {
            _orbWindow.ToggleVisibility();
        }

        private void OnToggleClickThrough(object sender, EventArgs e)
        {
            _orbWindow.ToggleClickThrough();
        }

        private void OnCenterOrb(object sender, EventArgs e)
        {
            _orbWindow.CenterOnScreen();
        }

        private void OnEmergencyStop(object sender, EventArgs e)
        {
            _orbWindow.SetState("HALTED");
            Console.WriteLine("{\"event\":\"tray_action\",\"action\":\"emergency_stop\"}");
        }

        private void OnExit(object sender, EventArgs e)
        {
            Shutdown();
        }

        public void Shutdown()
        {
            _isRunning = false;
            Console.WriteLine("{\"event\":\"shutdown\"}");

            if (_trayIcon != null)
            {
                _trayIcon.Visible = false;
                _trayIcon.Dispose();
            }

            if (_orbWindow != null && !_orbWindow.IsDisposed)
            {
                _orbWindow.Close();
                _orbWindow.Dispose();
            }

            ExitThread();
        }

        private void IpcReaderLoop()
        {
            try
            {
                string line;
                while (_isRunning && (line = Console.ReadLine()) != null)
                {
                    line = line.Trim();
                    if (string.IsNullOrEmpty(line)) continue;

                    // Handle simple JSON commands
                    try
                    {
                        ProcessIpcCommand(line);
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine("{\"event\":\"ipc_error\",\"message\":\"" + Escape(ex.Message) + "\"}");
                    }
                }
            }
            catch
            {
                // Stdin closed
            }
            finally
            {
                if (_isRunning)
                {
                    _orbWindow.BeginInvoke((MethodInvoker)Shutdown);
                }
            }
        }

        private void ProcessIpcCommand(string json)
        {
            // Lightweight zero-dependency parser for IPC commands
            if (json.Contains("\"action\":\"quit\"") || json.Contains("\"action\":\"exit\""))
            {
                _orbWindow.BeginInvoke((MethodInvoker)Shutdown);
            }
            else if (json.Contains("\"action\":\"setPosition\""))
            {
                int x = ExtractInt(json, "\"x\":", _orbWindow.Left);
                int y = ExtractInt(json, "\"y\":", _orbWindow.Top);
                _orbWindow.BeginInvoke((MethodInvoker)delegate { _orbWindow.SetPosition(x, y); });
            }
            else if (json.Contains("\"action\":\"setVisibility\""))
            {
                bool visible = json.Contains("\"visible\":true");
                _orbWindow.BeginInvoke((MethodInvoker)delegate { _orbWindow.SetVisibility(visible); });
            }
            else if (json.Contains("\"action\":\"setState\""))
            {
                string state = ExtractString(json, "\"state\":\"", "STANDBY");
                _orbWindow.BeginInvoke((MethodInvoker)delegate { _orbWindow.SetState(state); });
            }
            else if (json.Contains("\"action\":\"setOpacity\""))
            {
                double op = ExtractDouble(json, "\"opacity\":", 1.0);
                _orbWindow.BeginInvoke((MethodInvoker)delegate { _orbWindow.SetOrbOpacity(op); });
            }
            else if (json.Contains("\"action\":\"setClickThrough\""))
            {
                bool ct = json.Contains("\"enabled\":true");
                _orbWindow.BeginInvoke((MethodInvoker)delegate { _orbWindow.SetClickThrough(ct); });
            }
            else if (json.Contains("\"action\":\"ping\""))
            {
                Console.WriteLine("{\"event\":\"pong\",\"state\":\"" + _orbWindow.State + "\"}");
            }
        }

        internal static int ExtractInt(string json, string key, int fallback)
        {
            int idx = json.IndexOf(key);
            if (idx == -1) return fallback;
            int start = idx + key.Length;
            int end = start;
            while (end < json.Length && (char.IsDigit(json[end]) || json[end] == '-')) end++;
            int val;
            return int.TryParse(json.Substring(start, end - start), out val) ? val : fallback;
        }

        internal static double ExtractDouble(string json, string key, double fallback)
        {
            int idx = json.IndexOf(key);
            if (idx == -1) return fallback;
            int start = idx + key.Length;
            int end = start;
            while (end < json.Length && (char.IsDigit(json[end]) || json[end] == '.' || json[end] == '-')) end++;
            double val;
            return double.TryParse(json.Substring(start, end - start), System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out val) ? val : fallback;
        }

        internal static string ExtractString(string json, string key, string fallback)
        {
            int idx = json.IndexOf(key);
            if (idx == -1) return fallback;
            int start = idx + key.Length;
            int end = json.IndexOf('"', start);
            return end == -1 ? fallback : json.Substring(start, end - start);
        }

        internal static string Escape(string s)
        {
            if (string.IsNullOrEmpty(s)) return "";
            return s.Replace("\\", "\\\\").Replace("\"", "\\\"");
        }
    }

    internal sealed class OrbWindow : Form
    {
        private const int WM_NCLBUTTONDOWN = 0xA1;
        private const int HT_CAPTION = 0x2;
        private const int WS_EX_LAYERED = 0x80000;
        private const int WS_EX_TRANSPARENT = 0x20;
        private const int WS_EX_TOOLWINDOW = 0x80;
        private const int WS_EX_TOPMOST = 0x8;

        [DllImport("user32.dll")]
        private static extern int SendMessage(IntPtr hWnd, int Msg, int wParam, int lParam);

        [DllImport("user32.dll")]
        private static extern bool ReleaseCapture();

        [DllImport("user32.dll", SetLastError = true)]
        private static extern int GetWindowLong(IntPtr hWnd, int nIndex);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);

        private readonly CompanionApplicationContext _context;
        private readonly System.Windows.Forms.Timer _pulseTimer;
        private readonly int _orbSize = 120;
        private float _pulseAngle = 0f;
        private string _state = "STANDBY";
        private bool _clickThrough = false;
        private readonly string _configPath;

        public string State { get { return _state; } }

        public OrbWindow(CompanionApplicationContext context)
        {
            _context = context;

            string home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            _configPath = Path.Combine(Path.Combine(home, ".ultron"), "companion_config.json");

            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.Manual;
            ShowInTaskbar = false;
            TopMost = true;
            DoubleBuffered = true;
            Size = new Size(_orbSize, _orbSize);

            // Layered transparency key
            Color transparentColor = Color.FromArgb(1, 2, 3);
            BackColor = transparentColor;
            TransparencyKey = transparentColor;

            LoadPosition();

            // Animation timer for living energy core pulsing
            _pulseTimer = new System.Windows.Forms.Timer { Interval = 33 }; // ~30 fps
            _pulseTimer.Tick += OnPulseTick;
            _pulseTimer.Start();

            MouseDown += OnOrbMouseDown;
            LocationChanged += OnOrbLocationChanged;
        }

        protected override CreateParams CreateParams
        {
            get
            {
                CreateParams cp = base.CreateParams;
                cp.ExStyle |= WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_TOPMOST;
                if (_clickThrough)
                {
                    cp.ExStyle |= WS_EX_TRANSPARENT;
                }
                return cp;
            }
        }

        private void OnPulseTick(object sender, EventArgs e)
        {
            _pulseAngle += 0.05f;
            if (_pulseAngle > 6.283f) _pulseAngle = 0f;
            Invalidate();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;

            int w = ClientSize.Width;
            int h = ClientSize.Height;
            float cx = w / 2f;
            float cy = h / 2f;
            float radius = (w / 2f) - 8f;

            Color themeColor;
            switch (_state)
            {
                case "LISTENING": themeColor = Color.FromArgb(0, 255, 128); break;
                case "THINKING": themeColor = Color.FromArgb(180, 0, 255); break;
                case "SPEAKING": themeColor = Color.FromArgb(0, 220, 255); break;
                case "EXECUTING": themeColor = Color.FromArgb(255, 160, 0); break;
                case "HALTED": themeColor = Color.FromArgb(255, 40, 40); break;
                default: themeColor = Color.FromArgb(0, 200, 255); break;
            }

            float pulse = (float)(Math.Sin(_pulseAngle) * 0.15) + 0.85f;

            // Outer Soft Halo
            using (GraphicsPath haloPath = new GraphicsPath())
            {
                haloPath.AddEllipse(cx - radius * pulse, cy - radius * pulse, radius * 2 * pulse, radius * 2 * pulse);
                using (PathGradientBrush pgb = new PathGradientBrush(haloPath))
                {
                    pgb.CenterColor = Color.FromArgb((int)(110 * pulse), themeColor);
                    pgb.SurroundColors = new Color[] { Color.FromArgb(0, themeColor) };
                    g.FillPath(pgb, haloPath);
                }
            }

            // Energy Core Ring
            float ringRadius = radius * 0.72f;
            using (Pen ringPen = new Pen(Color.FromArgb(180, themeColor), 2.5f))
            {
                g.DrawEllipse(ringPen, cx - ringRadius, cy - ringRadius, ringRadius * 2, ringRadius * 2);
            }

            // Orbiting Node Arcs
            float arcSpan = 70f;
            float startAngle = (_pulseAngle * 57.2958f); // radians to degrees
            using (Pen arcPen = new Pen(Color.FromArgb(240, Color.White), 3f))
            {
                g.DrawArc(arcPen, cx - ringRadius, cy - ringRadius, ringRadius * 2, ringRadius * 2, startAngle, arcSpan);
                g.DrawArc(arcPen, cx - ringRadius, cy - ringRadius, ringRadius * 2, ringRadius * 2, startAngle + 180f, arcSpan);
            }

            // Central Pulsing Nucleus
            float nucRadius = ringRadius * 0.42f * pulse;
            using (Brush nucBrush = new SolidBrush(Color.FromArgb(245, Color.White)))
            {
                g.FillEllipse(nucBrush, cx - nucRadius, cy - nucRadius, nucRadius * 2, nucRadius * 2);
            }
        }

        private void OnOrbMouseDown(object sender, MouseEventArgs e)
        {
            if (e.Button == MouseButtons.Left)
            {
                ReleaseCapture();
                SendMessage(Handle, WM_NCLBUTTONDOWN, HT_CAPTION, 0);
            }
        }

        private void OnOrbLocationChanged(object sender, EventArgs e)
        {
            SavePosition();
            Console.WriteLine(string.Format("{{\"event\":\"position_changed\",\"x\":{0},\"y\":{1}}}", Left, Top));
        }

        public void SetPosition(int x, int y)
        {
            Location = new Point(x, y);
            SavePosition();
        }

        public void SetVisibility(bool visible)
        {
            Visible = visible;
            Console.WriteLine(string.Format("{{\"event\":\"visibility_changed\",\"visible\":{0}}}", visible ? "true" : "false"));
        }

        public void ToggleVisibility()
        {
            SetVisibility(!Visible);
        }

        public void SetState(string newState)
        {
            _state = newState;
            Invalidate();
            Console.WriteLine(string.Format("{{\"event\":\"state_changed\",\"state\":\"{0}\"}}", newState));
        }

        public void SetOrbOpacity(double op)
        {
            Opacity = Math.Max(0.1, Math.Min(1.0, op));
        }

        public void SetClickThrough(bool enabled)
        {
            _clickThrough = enabled;
            RecreateHandle();
            Console.WriteLine(string.Format("{{\"event\":\"click_through_changed\",\"enabled\":{0}}}", enabled ? "true" : "false"));
        }

        public void ToggleClickThrough()
        {
            SetClickThrough(!_clickThrough);
        }

        public void CenterOnScreen()
        {
            Rectangle bounds = Screen.PrimaryScreen.WorkingArea;
            int x = bounds.X + (bounds.Width - Width) / 2;
            int y = bounds.Y + (bounds.Height - Height) / 2;
            SetPosition(x, y);
        }

        private void LoadPosition()
        {
            try
            {
                if (File.Exists(_configPath))
                {
                    string content = File.ReadAllText(_configPath);
                    int x = CompanionApplicationContext.ExtractInt(content, "\"x\":", -1);
                    int y = CompanionApplicationContext.ExtractInt(content, "\"y\":", -1);
                    if (x != -1 && y != -1)
                    {
                        Location = new Point(x, y);
                        return;
                    }
                }
            }
            catch { }

            // Default: bottom-right above taskbar
            Rectangle area = Screen.PrimaryScreen.WorkingArea;
            Location = new Point(area.Right - _orbSize - 32, area.Bottom - _orbSize - 32);
        }

        private void SavePosition()
        {
            try
            {
                string dir = Path.GetDirectoryName(_configPath);
                if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);

                string json = string.Format(
                    "{{\n  \"orbPosition\": {{\n    \"x\": {0},\n    \"y\": {1}\n  }},\n  \"orbSize\": {2},\n  \"lastUpdated\": \"{3}\"\n}}",
                    Left,
                    Top,
                    _orbSize,
                    DateTime.UtcNow.ToString("o")
                );
                File.WriteAllText(_configPath, json);
            }
            catch { }
        }
    }
}
