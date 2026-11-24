using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal static class Launcher
{
    private const string Title = "PALLCOM MCR Agent";
    private static readonly string AppDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Pallcom", "McrAgent");
    private static readonly string Credentials = Path.Combine(AppDir, "credentials.json");
    private static readonly string Receipt = Path.Combine(AppDir, "station-receipt");
    private static readonly string Worker = Path.Combine(AppDir, "worker");

    public sealed class Station
    {
        public string serverUrl { get; set; }
        public string pairingCode { get; set; }
        public DateTimeOffset Expiry
        {
            get
            {
                DateTimeOffset value;
                if (!DateTimeOffset.TryParse(expiresAt, out value)) throw new InvalidDataException("The station file has an invalid expiry date.");
                return value;
            }
        }
        public string expiresAt { get; set; }
    }

    [STAThread]
    private static void Main()
    {
        bool created;
        using (var mutex = new Mutex(false, @"Local\PallcomMcrPortableAgent"))
        using (var showRequest = new EventWaitHandle(false, EventResetMode.AutoReset, @"Local\PallcomMcrPortableAgentShow", out created))
        {
            try
            {
                if (!Acquire(mutex))
                {
                    if (created) MessageBox.Show("An older Agent is running. Open it from the Windows notification area, or close it before upgrading.", Title);
                    else showRequest.Set();
                    return;
                }
                try
                {
                    Application.EnableVisualStyles();
                    Application.SetCompatibleTextRenderingDefault(false);
                    using (var window = new AgentWindow(showRequest)) Application.Run(window);
                }
                finally { mutex.ReleaseMutex(); }
            }
            catch (Exception error)
            {
                MessageBox.Show(error.Message, Title, MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }
    }

    private static bool Acquire(Mutex mutex)
    {
        try { return mutex.WaitOne(0); }
        catch (AbandonedMutexException) { return true; }
    }

    private sealed class AgentWindow : Form
    {
        private readonly Label status = new Label();
        private readonly Button start = new Button();
        private readonly Button stop = new Button();
        private readonly Button pair = new Button();
        private readonly NotifyIcon tray = new NotifyIcon();
        private readonly ContextMenuStrip menu = new ContextMenuStrip();
        private readonly ToolStripMenuItem stopMenu = new ToolStripMenuItem("Stop agent");
        private readonly ToolStripMenuItem exitMenu = new ToolStripMenuItem("Exit");
        private readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer();
        private Process worker;
        private bool ownsInput;
        private bool busy;
        private bool exiting;

        public AgentWindow(EventWaitHandle showRequest)
        {
            Text = Title;
            AutoScaleMode = AutoScaleMode.Font;
            ClientSize = new Size(455, 142);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            Icon = SystemIcons.Application;

            var content = new TableLayoutPanel
            {
                Dock = DockStyle.Fill, Padding = new Padding(16), ColumnCount = 1, RowCount = 2
            };
            content.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            content.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            status.Dock = DockStyle.Fill;
            status.TextAlign = ContentAlignment.MiddleLeft;
            content.Controls.Add(status, 0, 0);
            var buttons = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill, WrapContents = false };
            start.Text = "Start";
            stop.Text = "Stop";
            pair.Text = "Pair...";
            var hide = new Button { Text = "Hide" };
            buttons.Controls.AddRange(new Control[] { start, stop, pair, hide });
            content.Controls.Add(buttons, 0, 1);
            Controls.Add(content);

            menu.Items.Add("Show window", null, delegate { ShowWindow(); });
            menu.Items.Add("Hide window", null, delegate { Hide(); });
            menu.Items.Add(stopMenu);
            menu.Items.Add(exitMenu);
            tray.Icon = Icon;
            tray.Text = Title;
            tray.ContextMenuStrip = menu;
            tray.Visible = true;
            tray.DoubleClick += delegate { ShowWindow(); };

            start.Click += async delegate { await StartAgent(); };
            pair.Click += async delegate
            {
                string profile = SelectStationFile();
                if (profile != null) await StartAgent(profile);
            };
            stop.Click += async delegate { await StopAgent(false); };
            stopMenu.Click += async delegate { await StopAgent(false); };
            exitMenu.Click += async delegate { await StopAgent(true); };
            hide.Click += delegate { Hide(); };
            Resize += delegate { if (WindowState == FormWindowState.Minimized) Hide(); };
            FormClosing += delegate(object sender, FormClosingEventArgs args)
            {
                if (!exiting && args.CloseReason == CloseReason.UserClosing)
                {
                    args.Cancel = true;
                    Hide();
                }
            };
            timer.Interval = 750;
            timer.Tick += delegate
            {
                if (showRequest.WaitOne(0)) ShowWindow();
                if (busy || worker == null || !worker.HasExited) return;
                ReleaseWorker();
                SetStatus("The agent stopped. Click Start to try again.");
            };
            timer.Start();
            SetStatus("Stopped.");
            Shown += async delegate { await StartAgent(); };
        }

        private void ShowWindow()
        {
            WindowState = FormWindowState.Normal;
            Show();
            Activate();
        }

        private void SetStatus(string text)
        {
            status.Text = text;
            start.Enabled = !busy && worker == null;
            pair.Enabled = !busy;
            stop.Enabled = stopMenu.Enabled = !busy && worker != null;
            exitMenu.Enabled = !busy;
        }

        private string SelectStationFile()
        {
            using (var dialog = new OpenFileDialog { Title = "Select your MCR station file", Filter = "MCR station (*.json)|*.json" })
            {
                return dialog.ShowDialog(this) == DialogResult.OK ? dialog.FileName : null;
            }
        }

        private async Task StartAgent(string profile = null)
        {
            if (busy || (worker != null && profile == null)) return;
            busy = true;
            SetStatus("Starting the agent...");
            try
            {
                if (profile == null && !File.Exists(Credentials))
                {
                    var defaultProfile = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "MCR-Station.json");
                    profile = File.Exists(defaultProfile) ? defaultProfile : SelectStationFile();
                    if (profile == null) return;
                }
                if (profile != null && !File.Exists(profile))
                    throw new FileNotFoundException("The selected station file is no longer available.");
                var result = await Task.Run(() => OpenWorker(profile));
                if (worker != null && worker.Id == result.Item1.Id && !result.Item2)
                {
                    result.Item1.Dispose();
                }
                else
                {
                    if (worker != null) worker.Dispose();
                    worker = result.Item1;
                    ownsInput = result.Item2;
                }
            }
            catch (Exception error)
            {
                MessageBox.Show(this, error.Message, Title, MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            finally
            {
                busy = false;
                SetStatus(worker == null ? "Stopped." : "Agent running. Check the station connection in the dashboard.");
            }
        }

        private async Task StopAgent(bool close)
        {
            if (busy) return;
            busy = true;
            SetStatus("Stopping the agent...");
            try
            {
                if (worker != null)
                {
                    await Task.Run(() => StopWorker(worker, ownsInput));
                    ReleaseWorker();
                }
                if (close)
                {
                    exiting = true;
                    Close();
                }
            }
            catch (Exception error)
            {
                MessageBox.Show(this, error.Message, Title, MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            finally
            {
                busy = false;
                if (!exiting) SetStatus(worker == null ? "Stopped." : "Agent still running.");
            }
        }

        private void ReleaseWorker()
        {
            worker.Dispose();
            worker = null;
            ownsInput = false;
            try { File.Delete(Worker); }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                timer.Dispose();
                tray.Dispose();
                menu.Dispose();
                if (worker != null) worker.Dispose();
            }
            base.Dispose(disposing);
        }
    }

    private static Tuple<Process, bool> OpenWorker(string profile)
    {
        string runtime = UnpackRuntime();
        Process running = FindWorker();
        try
        {
            if (File.Exists(profile))
            {
                string json = File.ReadAllText(profile);
                string hash;
                using (var sha = SHA256.Create())
                    hash = Convert.ToBase64String(sha.ComputeHash(System.Text.Encoding.UTF8.GetBytes(json)));

                if (!File.Exists(Credentials) || !File.Exists(Receipt) || File.ReadAllText(Receipt) != hash)
                {
                    Pair(runtime, json);
                    File.WriteAllText(Receipt, hash);
                    if (running != null && !running.WaitForExit(5000)) StopWorker(running, false);
                }
            }

            if (running != null && !running.HasExited)
            {
                Process existing = running;
                running = null;
                return Tuple.Create(existing, false);
            }

            var info = Node(runtime, "start");
            info.RedirectStandardInput = true;
            info.EnvironmentVariables["MCR_AGENT_DESKTOP"] = "1";
            Process process = Process.Start(info);
            try
            {
                if (process.WaitForExit(1000)) throw new InvalidOperationException("The agent stopped. Ask your administrator for a fresh station file.");
                File.WriteAllText(Worker, process.Id + " " + process.StartTime.ToUniversalTime().Ticks);
                return Tuple.Create(process, true);
            }
            catch
            {
                StopWorker(process, true);
                process.Dispose();
                throw;
            }
        }
        finally
        {
            if (running != null) running.Dispose();
        }
    }

    private static void StopWorker(Process process, bool closeInput)
    {
        if (process.HasExited) return;
        if (closeInput)
        {
            process.StandardInput.Close();
            if (process.WaitForExit(4000)) return;
        }
        try { process.Kill(); }
        catch (InvalidOperationException) { if (!process.HasExited) throw; }
        if (!process.WaitForExit(5000)) throw new InvalidOperationException("Windows did not stop the agent.");
    }

    private static void Pair(string runtime, string json)
    {
        var station = new JavaScriptSerializer().Deserialize<Station>(json);
        Uri server;
        if (station == null || !Uri.TryCreate(station.serverUrl, UriKind.Absolute, out server) ||
            (server.Scheme != "https" && !(server.Scheme == "http" && server.IsLoopback)) ||
            server.UserInfo != "" || server.PathAndQuery != "/" || server.Fragment != "" ||
            !Regex.IsMatch(station.pairingCode ?? "", @"\AMCR-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}\z"))
            throw new InvalidDataException("Ask your administrator for a valid MCR station file.");
        if (station.Expiry <= DateTimeOffset.UtcNow)
            throw new InvalidDataException("This station file has expired. Ask your administrator for a fresh file.");

        string origin = server.GetLeftPart(UriPartial.Authority);
        var info = Node(runtime, "pair --code " + station.pairingCode + " --server \"" + origin + "\"");
        info.RedirectStandardError = true;
        using (var process = Process.Start(info))
        {
            var error = process.StandardError.ReadToEndAsync();
            if (!process.WaitForExit(30000))
            {
                process.Kill();
                throw new InvalidOperationException("The dashboard did not respond. Check your internet connection and try again.");
            }
            if (process.ExitCode != 0) throw new InvalidOperationException(error.GetAwaiter().GetResult().Trim());
        }
    }

    private static ProcessStartInfo Node(string runtime, string args)
    {
        var info = new ProcessStartInfo
        {
            FileName = Path.Combine(runtime, "node.exe"),
            Arguments = "\"backend/agent/src/agent.mjs\" " + args,
            WorkingDirectory = runtime,
            UseShellExecute = false,
            CreateNoWindow = true
        };
        info.EnvironmentVariables["MCR_AGENT_CONFIG_DIR"] = AppDir;
        info.EnvironmentVariables["FFPROBE_PATH"] = Path.Combine(runtime, "ffprobe.exe");
        return info;
    }

    private static Process FindWorker()
    {
        if (!File.Exists(Worker)) return null;
        string[] record = File.ReadAllText(Worker).Split(' ');
        int id;
        long ticks;
        if (record.Length != 2 || !int.TryParse(record[0], out id) || !long.TryParse(record[1], out ticks)) return null;
        Process process;
        try { process = Process.GetProcessById(id); }
        catch (ArgumentException) { return null; }
        try
        {
            if (process.StartTime.ToUniversalTime().Ticks == ticks) return process;
        }
        catch (InvalidOperationException) { }
        process.Dispose();
        return null;
    }

    private static string UnpackRuntime()
    {
        Directory.CreateDirectory(AppDir);
        using (Stream payload = Assembly.GetExecutingAssembly().GetManifestResourceStream("AgentPayload.zip"))
        {
            string version;
            using (var sha = SHA256.Create())
                version = BitConverter.ToString(sha.ComputeHash(payload)).Replace("-", "");
            string destination = Path.Combine(AppDir, version);
            if (Directory.Exists(destination)) return destination;
            payload.Position = 0;
            string pending = Path.Combine(AppDir, Guid.NewGuid().ToString("N"));
            try
            {
                using (var archive = new ZipArchive(payload)) archive.ExtractToDirectory(pending);
                Directory.Move(pending, destination);
            }
            finally
            {
                if (Directory.Exists(pending)) Directory.Delete(pending, true);
            }
            return destination;
        }
    }
}
