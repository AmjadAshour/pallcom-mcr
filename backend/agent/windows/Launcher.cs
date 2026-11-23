using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using System.Threading;
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
        using (var mutex = new Mutex(false, @"Local\PallcomMcrPortableAgent"))
        {
            try
            {
                if (!Acquire(mutex)) return;
                try { Run(); }
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

    private static void Run()
    {
        string profile = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "MCR-Station.json");
        if (!File.Exists(profile) && !File.Exists(Credentials))
        {
            using (var dialog = new OpenFileDialog { Title = "Open the station file supplied by your administrator", Filter = "MCR station (*.json)|*.json" })
            {
                if (dialog.ShowDialog() != DialogResult.OK) return;
                profile = dialog.FileName;
            }
        }

        string runtime = UnpackRuntime();
        using (Process running = FindWorker())
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
                    if (running != null && !running.HasExited) running.WaitForExit(5000);
                }
            }

            if (running == null || running.HasExited)
            {
                using (var process = Process.Start(Node(runtime, "start")))
                {
                    if (process.WaitForExit(1000)) throw new InvalidOperationException("The agent stopped. Ask your administrator for a fresh station file.");
                    File.WriteAllText(Worker, process.Id + " " + process.StartTime.ToUniversalTime().Ticks);
                }
            }
        }
        MessageBox.Show("The agent is running in the background. Check the station status in the dashboard.", Title);
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
